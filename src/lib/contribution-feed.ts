import { contributionCells, contributionPalettes, contributionWeeks, isCurrentContributionCalendar, normalizeContributions } from './github-contributions.ts'
import type { ContributionCalendar } from './github-contributions.ts'

export const PROFILE_REF = 'https://api.github.com/repos/Cyril-Fan/Cyril-Fan/git/ref/heads/main'
export const MAX_SOURCE_AGE_MS = 36 * 60 * 60 * 1000
export const REFRESH_INTERVAL_MS = 2 * 60 * 1000
export const RENDERER = 'Platane/snk-profile'
export const PUBLISHED_CONTRIBUTIONS = '/data/contributions.json'

export async function calendarHash(calendar: ContributionCalendar): Promise<string> {
  // Match profile.yml's json.dumps(sort_keys=True, separators=(',', ':')).
  const bytes = new TextEncoder().encode(JSON.stringify(calendar.contributions.map(({ count, date, level }) => ({ count, date, level }))))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Preserve the original SVG. Its cell IDs are not color levels. */
export function validateProfileSnake(svg: string, calendar: ContributionCalendar, theme: 'light' | 'dark') {
  if (svg.length > 1_500_000 || !svg.startsWith('<svg ') || !svg.endsWith('</svg>') ||
    /<!|<\?|\bon\w+\s*=|\bhref\s*=|@import|url\s*\(|javascript:|expression\s*\(/i.test(svg) ||
    [...svg.matchAll(/<\/?([\w:-]+)/g)].some(match => !['svg', 'desc', 'style', 'rect', 'g'].includes(match[1]))) throw new Error('Unsafe or unsupported contribution SVG')
  const width = (contributionWeeks(calendar.contributions).length + 2) * 16
  if (!svg.includes(`viewBox="-16 -32 ${width} 192"`) || !svg.includes('<desc>Generated with https://github.com/Platane/snk</desc>')) throw new Error('Unexpected contribution SVG geometry or generator')
  const palette = contributionPalettes[theme]
  for (const [key, value] of [['ce', palette.colors[0]], ['cb', palette.border], ['cs', palette.snake], ...palette.colors.map((color, level) => [`c${level}`, color])]) {
    if (!new RegExp(`--${key}:${value}(?:;|})`).test(svg)) throw new Error('Contribution theme mismatch')
  }
  // Platane numbers animated cells in base 36 (c0 … c9, ca … cz, c10).
  const levels = new Map([...svg.matchAll(/\.c\.(c[0-9a-z]+)\{fill:var\(--c([1-4])\);/g)].map(match => [match[1], Number(match[2])]))
  const actual = new Map<string, number>()
  for (const match of svg.matchAll(/<rect\b([^>]+)\/>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]))
    if (!/^c(?: c[0-9a-z]+)?$/.test(attrs.class ?? '')) continue
    const key = `${attrs.x},${attrs.y}`
    const level = attrs.class === 'c' ? 0 : levels.get(attrs.class.split(' ')[1])
    if (actual.has(key) || level === undefined) throw new Error('Invalid contribution SVG cells')
    actual.set(key, level)
  }
  const expected = contributionCells(calendar.contributions)
  if (actual.size !== expected.length || expected.some(day => actual.get(`${day.x * 16 + 2},${day.y * 16 + 2}`) !== day.level)) throw new Error('Contribution SVG does not match the calendar')
  const durations = [...svg.matchAll(/animation:[^;}]*?\b(\d+)ms\b/g)].map(match => Number(match[1]))
  const duration = durations[0]
  if (!duration || duration > 3_600_000 || durations.some(value => value !== duration)) throw new Error('Invalid contribution animation duration')
  return { width, height: 192, duration }
}

export interface ContributionBundle {
  sourceCommit: string | null
  fetchedAt: string
  checkedAt: string
  dataHash: string
  dataThrough: string
  calendar: ContributionCalendar
  light: string
  dark: string
  width: number
  height: number
  duration: number
}

interface FeedOptions {
  fetcher?: typeof fetch
  now?: Date
  signal?: AbortSignal
  currentCommit?: string
  token?: string
}

/** Validate the complete same-origin fallback just as strictly as the GitHub files.
 * Its age is visible to readers; an upstream outage must not erase valid history. */
export async function validatePublishedContributionBundle(input: unknown, now = new Date()): Promise<ContributionBundle> {
  const bundle = input as ContributionBundle & { version?: number }
  if (!bundle || bundle.version !== 1 || (bundle.sourceCommit !== null && !/^[a-f0-9]{40}$/.test(bundle.sourceCommit)) ||
      !/^[a-f0-9]{64}$/.test(bundle.dataHash) || typeof bundle.light !== 'string' || typeof bundle.dark !== 'string') throw new Error('Invalid published contribution bundle')
  const calendar = normalizeContributions({ contributions: bundle.calendar?.contributions, total: { lastYear: bundle.calendar?.total } })
  const fetched = Date.parse(bundle.fetchedAt), checked = Date.parse(bundle.checkedAt)
  if (!calendar || !Number.isFinite(fetched) || !Number.isFinite(checked) || fetched > now.getTime() + 300_000 || checked > now.getTime() + 300_000 ||
      bundle.dataThrough !== calendar.contributions.at(-1)?.date || bundle.dataThrough > now.toISOString().slice(0,10) ||
      bundle.dataHash !== await calendarHash(calendar)) throw new Error('Published contribution identity mismatch')
  const light = validateProfileSnake(bundle.light, calendar, 'light')
  const dark = validateProfileSnake(bundle.dark, calendar, 'dark')
  if (light.duration !== dark.duration || light.width !== bundle.width || light.height !== bundle.height || light.duration !== bundle.duration) throw new Error('Published contribution geometry mismatch')
  return { sourceCommit:bundle.sourceCommit, fetchedAt:bundle.fetchedAt, checkedAt:bundle.checkedAt, dataHash:bundle.dataHash,
    dataThrough:bundle.dataThrough, calendar, light:bundle.light, dark:bundle.dark, ...light }
}

export async function fetchPublishedContributionBundle({ fetcher = fetch, now = new Date(), signal, origin = '' }: {
  fetcher?: typeof fetch; now?: Date; signal?: AbortSignal; origin?: string
} = {}): Promise<ContributionBundle> {
  const response = await fetcher(`${origin}${PUBLISHED_CONTRIBUTIONS}?check=${Math.floor(now.getTime()/60_000)}`, {
    cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', redirect:'error',
    signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  })
  if (!response.ok || !response.body) throw new Error('Published contribution bundle unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 3_200_000) throw new Error('Published contribution bundle too large')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return validatePublishedContributionBundle(JSON.parse(new TextDecoder().decode(bytes)), now)
}

/** Prefer one commit; validate all three files together even when the ref API is throttled. */
export async function fetchContributionBundle({ fetcher = fetch, now = new Date(), signal, currentCommit, token }: FeedOptions = {}): Promise<ContributionBundle | null> {
  const timed = AbortSignal.timeout(20_000)
  const requestSignal = signal ? AbortSignal.any([signal, timed]) : timed
  const get = async (url: string) => {
    const requestUrl = url === PROFILE_REF || url.includes('/main/assets/') ? url + '?check=' + Math.floor(now.getTime()/60_000) : url
    const response = await fetcher(requestUrl, { signal: requestSignal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
      ...(token && url === PROFILE_REF ? { headers: { Authorization: `Bearer ${token}` } } : {}) })
    if (!response.ok) throw new Error(`GitHub contribution request failed (${response.status})`)
    const text = await response.text()
    if (text.length > 1_500_000) throw new Error('Contribution response too large')
    return text
  }
  let sourceCommit: string | null = null
  try {
    const head = JSON.parse(await get(PROFILE_REF))
    if (!/^[a-f0-9]{40}$/.test(head?.object?.sha)) throw new Error('Invalid GitHub profile commit')
    sourceCommit = head.object.sha
  } catch {
    if (requestSignal.aborted) throw requestSignal.reason
    // The anonymous API can be throttled while raw files remain available.
    // A branch snapshot is accepted only after hash + both SVG cell validations.
  }
  if (sourceCommit && sourceCommit === currentCommit) return null
  const base = `https://raw.githubusercontent.com/Cyril-Fan/Cyril-Fan/${sourceCommit || 'main'}/assets/`
  const [json, light, dark] = await Promise.all(['profile-data.json', 'github-contribution-grid-snake.svg', 'github-contribution-grid-snake-dark.svg'].map(name => get(base + name)))
  const profile = JSON.parse(json)
  if (profile.login !== 'Cyril-Fan' || typeof profile.updated !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(profile.updated)) throw new Error('Invalid GitHub profile snapshot')
  const calendar = normalizeContributions({ contributions: profile.calendar, total: { lastYear: profile.stats?.find((row: unknown[]) => row[0] === 'Contributions')?.[1] } })
  const fetchedAt = `${profile.updated.replace(' ', 'T')}:00.000Z`
  const age = now.getTime() - Date.parse(fetchedAt)
  if (!calendar || !isCurrentContributionCalendar(calendar, now) || !Number.isFinite(age) || age < -300_000 || age > MAX_SOURCE_AGE_MS) throw new Error('GitHub contribution snapshot is stale or invalid')
  const dataHash = await calendarHash(calendar)
  if (dataHash !== profile.snake_calendar_hash) throw new Error('GitHub profile animation update is incomplete')
  const geometry = validateProfileSnake(light, calendar, 'light')
  const darkGeometry = validateProfileSnake(dark, calendar, 'dark')
  if (geometry.duration !== darkGeometry.duration) throw new Error('Contribution animations belong to different updates')
  return { sourceCommit, fetchedAt, checkedAt: now.toISOString(), dataHash, dataThrough: calendar.contributions.at(-1)!.date, calendar, light, dark, ...geometry }
}

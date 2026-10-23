import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { contributionGeometry, contributionWeeks, isCurrentContributionCalendar, normalizeContributions } from '../src/lib/github-contributions.ts'
import { ANIMATION_VERSION, assertSnakeMatchesCalendar, calendarHash, createContributionAnimations, staticSnake } from './contribution-animation.mjs'

export { staticSnake, validateSnake } from './contribution-animation.mjs'

const defaultRoot = new URL('../', import.meta.url)
const graphUrl = 'https://api.github.com/graphql'
export const publicSnapshotUrl = 'https://raw.githubusercontent.com/Cyril-Fan/Cyril-Fan/main/assets/profile-data.json'
export const MAX_SOURCE_AGE_MS = 36 * 60 * 60 * 1000
const levels = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 }
const query = `query ContributionCalendar($login: String!) {
  user(login: $login) {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`

function requireCurrentCalendar(payload, fetchedAt, now) {
  const calendar = normalizeContributions(payload)
  const age = now.getTime() - Date.parse(fetchedAt)
  if (!calendar || !isCurrentContributionCalendar(calendar, now) || !Number.isFinite(age) || age < -300_000 || age > MAX_SOURCE_AGE_MS) throw new Error('GitHub contribution data is invalid or stale; deployment stopped')
  return calendar
}

/** One validated response feeds the daily calendar and both animation themes. */
export async function fetchContributionSnapshot({ fetcher = fetch, token = process.env.GITHUB_TOKEN, now = new Date(), ci = Boolean(process.env.CI) } = {}) {
  if (ci && !token) throw new Error('GITHUB_TOKEN is required for a fresh CI contribution snapshot')
  let payload
  let fetchedAt
  let source
  if (token) {
    source = graphUrl
    const response = await fetcher(source, {
      method: 'POST', signal: AbortSignal.timeout(20_000), redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'cyril-fan-contributions' },
      body: JSON.stringify({ query, variables: { login: 'Cyril-Fan' } })
    })
    if (!response.ok) throw new Error(`GitHub contribution request failed (${response.status}); deployment stopped`)
    const result = await response.json()
    const user = result?.data?.user
    if (result?.errors?.length || user?.login?.toLowerCase() !== 'cyril-fan') throw new Error('GitHub contribution response is incomplete; deployment stopped')
    const calendar = user.contributionsCollection?.contributionCalendar
    payload = {
      total: { lastYear: calendar?.totalContributions },
      contributions: calendar?.weeks?.flatMap(week => week.contributionDays?.map(day => ({ date: day.date, count: day.contributionCount, level: levels[day.contributionLevel] })))
    }
    fetchedAt = now.toISOString()
  } else {
    // Local builds need no personal token. This is the owner's public, timestamped
    // GraphQL snapshot, never a third-party feed or the checked-in fallback. CI
    // always uses its short-lived GitHub token and the direct API above.
    source = publicSnapshotUrl
    const response = await fetcher(source, { signal: AbortSignal.timeout(20_000), redirect: 'error', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
    if (!response.ok) throw new Error(`Public GitHub snapshot request failed (${response.status}); build stopped`)
    const result = await response.json()
    if (result?.login !== 'Cyril-Fan' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(result.updated)) throw new Error('Invalid public GitHub snapshot')
    fetchedAt = `${result.updated.replace(' ', 'T')}:00.000Z`
    payload = { contributions: result.calendar, total: { lastYear: result.stats?.find(row => row[0] === 'Contributions')?.[1] } }
  }
  const calendar = requireCurrentCalendar(payload, fetchedAt, now)
  return {
    source, username: 'Cyril-Fan', fetchedAt, checkedAt: now.toISOString(),
    dataThrough: calendar.contributions.at(-1).date, dataHash: calendarHash(calendar),
    contributions: calendar.contributions, total: { lastYear: calendar.total }
  }
}

async function writeJson(file, data) {
  const temporary = new URL(`${file.pathname.split('/').at(-1)}.tmp`, file)
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
  await rename(temporary, file)
}

export async function syncContributionSnake({ root = defaultRoot, ...options } = {}) {
  // Do not catch and deploy a repository snapshot: a failed refresh must leave
  // the last successful Pages deployment in place. No files change until data
  // and both complete animations have passed validation.
  const snapshot = await fetchContributionSnapshot(options)
  const { calendar, plan, light, dark } = createContributionAnimations(snapshot)
  const directory = new URL('public/contributions/', root)
  await mkdir(directory, { recursive: true })
  await mkdir(new URL('src/assets/', root), { recursive: true })
  const metadata = {
    source: 'https://github.com/Cyril-Fan', dataSource: snapshot.source,
    fetchedAt: snapshot.fetchedAt, checkedAt: snapshot.checkedAt,
    dataThrough: snapshot.dataThrough, dataHash: snapshot.dataHash,
    rendererVersion: ANIMATION_VERSION, width: (plan.width + 2) * contributionGeometry.pitch, height: contributionGeometry.height,
    cycleDurationMs: plan.duration, routeSteps: plan.route.length - 1
  }
  for (const [variant, svg] of Object.entries({ light, dark })) {
    const version = createHash('sha256').update(svg).digest('hex').slice(0, 12)
    const name = `snake-${variant}-${version}`
    await writeFile(new URL(`${name}.svg`, directory), svg)
    await writeFile(new URL(`${name}-static.svg`, directory), staticSnake(svg))
    metadata[variant] = `/contributions/${name}.svg`
    metadata[`${variant}Static`] = `/contributions/${name}-static.svg`
  }
  await writeJson(new URL('src/assets/contribution-calendar.json', root), snapshot)
  // The manifest is the final commit marker. The next build step verifies its
  // hash, theme files and calendar before Astro can publish anything.
  await writeJson(new URL('src/assets/contributions.json', root), metadata)
  console.log(`[contributions] One GitHub snapshot: ${calendar.total} contributions through ${snapshot.dataThrough}; ${plan.duration}ms continuous snake loop.`)
  return metadata
}

export async function verifyContributionBundle({ root = defaultRoot, now = new Date(), requireFresh = true } = {}) {
  const snapshot = JSON.parse(await readFile(new URL('src/assets/contribution-calendar.json', root), 'utf8'))
  const metadata = JSON.parse(await readFile(new URL('src/assets/contributions.json', root), 'utf8'))
  const calendar = requireFresh ? requireCurrentCalendar(snapshot, snapshot.fetchedAt, now) : normalizeContributions(snapshot)
  if (!calendar || snapshot.dataHash !== calendarHash(calendar) || metadata.dataHash !== snapshot.dataHash || metadata.fetchedAt !== snapshot.fetchedAt || metadata.dataThrough !== calendar.contributions.at(-1).date || metadata.rendererVersion !== ANIMATION_VERSION) throw new Error('Contribution bundle identity mismatch')
  if (metadata.width !== (contributionWeeks(calendar.contributions).length + 2) * contributionGeometry.pitch || metadata.height !== contributionGeometry.height) throw new Error('Contribution bundle canvas mismatch')
  for (const variant of ['light', 'dark']) {
    const path = metadata[variant]
    if (!new RegExp(`^/contributions/snake-${variant}-[a-f0-9]{12}\\.svg$`).test(path)) throw new Error('Invalid contribution asset path')
    const svg = await readFile(new URL(`public${path}`, root), 'utf8')
    if (!path.endsWith(`-${createHash('sha256').update(svg).digest('hex').slice(0, 12)}.svg`)) throw new Error('Contribution asset hash mismatch')
    assertSnakeMatchesCalendar(svg, calendar, variant)
    if (metadata[`${variant}Static`] !== path.replace('.svg', '-static.svg')) throw new Error('Invalid static contribution asset path')
    if (await readFile(new URL(`public${metadata[`${variant}Static`]}`, root), 'utf8') !== staticSnake(svg)) throw new Error('Static contribution asset mismatch')
  }
  return { snapshot, metadata, calendar }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncContributionSnake()

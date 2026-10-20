export interface ContributionDay {
  date: string
  count: number
  level: number
}

export interface ContributionCalendar {
  contributions: ContributionDay[]
  total: number
}

const DAY_MS = 86_400_000
const buildRequests = new Map<string, Promise<ContributionCalendar | null>>()

function validDay(value: unknown): value is ContributionDay {
  if (!value || typeof value !== 'object') return false
  const day = value as Partial<ContributionDay>
  if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return false
  const date = new Date(`${day.date}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day.date &&
    Number.isSafeInteger(day.count) && (day.count ?? -1) >= 0 &&
    Number.isInteger(day.level) && (day.level ?? -1) >= 0 && (day.level ?? 5) <= 4
}

/** Refuse incomplete or contradictory feeds instead of inventing missing activity. */
export function normalizeContributions(value: unknown): ContributionCalendar | null {
  if (!value || typeof value !== 'object') return null
  const data = value as { contributions?: unknown; total?: { lastYear?: unknown } }
  if (!Array.isArray(data.contributions) || data.contributions.length < 350 ||
    data.contributions.length > 400 || !data.contributions.every(validDay)) return null
  const contributions: ContributionDay[] = [...data.contributions].sort((a, b) => a.date.localeCompare(b.date))
  const first = Date.parse(`${contributions[0].date}T00:00:00Z`)
  if (!contributions.every((day, index) => Date.parse(`${day.date}T00:00:00Z`) === first + index * DAY_MS)) return null
  const total = contributions.reduce((sum, day) => sum + day.count, 0)
  if (!Number.isSafeInteger(total) || data.total?.lastYear !== total) return null
  return { contributions, total }
}

/** Sunday is the first row; padding represents dates outside the returned range. */
export function contributionWeeks(days: ContributionDay[]): (ContributionDay | null)[][] {
  if (!days.length) return []
  const weekday = new Date(`${days[0].date}T00:00:00Z`).getUTCDay()
  const padded = [...Array<null>(weekday).fill(null), ...days]
  return Array.from({ length: Math.ceil(padded.length / 7) }, (_, index) =>
    Array.from({ length: 7 }, (_, row) => padded[index * 7 + row] ?? null))
}

export function fetchContributions(username: string): Promise<ContributionCalendar | null> {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) return Promise.resolve(null)
  const cached = buildRequests.get(username)
  if (cached) return cached
  const request = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    try {
      const response = await fetch(
        `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=last`,
        { signal: controller.signal }
      )
      if (!response.ok) return null
      return normalizeContributions(await response.json())
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })()
  buildRequests.set(username, request)
  return request
}

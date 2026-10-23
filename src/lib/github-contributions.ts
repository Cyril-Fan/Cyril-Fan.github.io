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

// Shared by the interactive calendar and the generated animation.
export const contributionGeometry = { pitch: 16, size: 12, inset: 2, rows: 7, height: 192 }
export const contributionPalettes = {
  light: { colors: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'], border: '#1f23280d', snake: '#0969da' },
  dark: { colors: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'], border: '#0104090d', snake: '#4493f8' }
}

function validDay(value: unknown): value is ContributionDay {
  if (!value || typeof value !== 'object') return false
  const day = value as Partial<ContributionDay>
  if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return false
  const date = new Date(`${day.date}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day.date &&
    Number.isSafeInteger(day.count) && (day.count ?? -1) >= 0 &&
    Number.isInteger(day.level) && (day.level ?? -1) >= 0 && (day.level ?? 5) <= 4 &&
    (day.count === 0) === (day.level === 0)
}

/** Refuse incomplete or contradictory feeds instead of inventing missing activity. */
export function normalizeContributions(value: unknown): ContributionCalendar | null {
  if (!value || typeof value !== 'object') return null
  const data = value as { contributions?: unknown; total?: { lastYear?: unknown } }
  if (!Array.isArray(data.contributions) || data.contributions.length < 365 ||
    data.contributions.length > 372 || !data.contributions.every(validDay)) return null
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

export function contributionCells(days: ContributionDay[]) {
  return contributionWeeks(days).flatMap((week, x) => week.flatMap((day, y) => day ? [{ ...day, x, y }] : []))
}

/** GitHub may finish the current UTC day after midnight; never accept an older year. */
export function isCurrentContributionCalendar(calendar: ContributionCalendar, now = new Date()): boolean {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  const last = Date.parse(`${calendar.contributions.at(-1)?.date}T00:00:00Z`)
  return last <= today && last >= today - DAY_MS
}

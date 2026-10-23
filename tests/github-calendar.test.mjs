import assert from 'node:assert/strict'
import test from 'node:test'
import { contributionCells, contributionWeeks, isCurrentContributionCalendar, normalizeContributions } from '../src/lib/github-contributions.ts'
import { siteDaysOnline } from '../src/lib/site-days.ts'
const fixture = (start = '2025-10-19') => {
  const begin = Date.parse(`${start}T00:00:00Z`)
  const contributions = Array.from({ length: 367 }, (_, index) => ({
    date: new Date(begin + index * 86_400_000).toISOString().slice(0, 10),
    count: index % 5,
    level: index % 5
  }))
  return { contributions, total: { lastYear: contributions.reduce((sum, day) => sum + day.count, 0) } }
}

test('a complete real-shaped year is normalized in date order without mutating the feed', () => {
  const input = fixture()
  input.contributions.reverse()
  const result = normalizeContributions(input)
  assert.equal(result.contributions[0].date, '2025-10-19')
  assert.equal(result.contributions.at(-1).date, '2026-10-20')
  assert.equal(result.total, input.total.lastYear)
  assert.equal(input.contributions[0].date, '2026-10-20')
})

test('missing, duplicate, impossible dates and contradictory totals fail closed', () => {
  for (const corrupt of [
    data => data.contributions.splice(20, 1),
    data => { data.contributions[20].date = data.contributions[19].date },
    data => { data.contributions[20].date = '2026-02-30' },
    data => { data.contributions[20].date = '2026-2-01' },
    data => { data.total.lastYear++ },
    data => { data.contributions = [] },
    data => { data.contributions.length = 20 }
  ]) {
    const data = fixture()
    corrupt(data)
    assert.equal(normalizeContributions(data), null)
  }
})

test('untrusted activity fields cannot introduce negative, fractional, oversized or invalid color values', () => {
  for (const [field, value] of [
    ['count', -1], ['count', 0.5], ['count', Number.MAX_SAFE_INTEGER + 1],
    ['count', NaN], ['count', '2'], ['level', -1], ['level', 5], ['level', '1']
  ]) {
    const input = fixture()
    input.contributions[0][field] = value
    assert.equal(normalizeContributions(input), null)
  }
})

test('Sunday-first weeks preserve every day exactly once, including leap day and partial end weeks', () => {
  const input = normalizeContributions(fixture('2023-08-01'))
  const weeks = contributionWeeks(input.contributions)
  assert.equal(weeks[0][0], null)
  assert.equal(weeks[0][1], null)
  assert.equal(weeks[0][2].date, '2023-08-01')
  assert.ok(weeks.every(week => week.length === 7))
  assert.equal(weeks.flat().filter(Boolean).length, 367)
  assert.equal(weeks.flat().filter(day => day?.date === '2024-02-29').length, 1)
  assert.equal(JSON.stringify(weeks.flat().filter(Boolean)), JSON.stringify(input.contributions))
})

test('a complete year can still be stale or from the future; UTC midnight has a one-day allowance', () => {
  const calendar = normalizeContributions(fixture())
  assert.equal(isCurrentContributionCalendar(calendar, new Date('2026-10-20T23:59:59Z')), true)
  assert.equal(isCurrentContributionCalendar(calendar, new Date('2026-10-21T00:00:01Z')), true)
  assert.equal(isCurrentContributionCalendar(calendar, new Date('2026-10-22T00:00:00Z')), false)
  assert.equal(isCurrentContributionCalendar(calendar, new Date('2026-10-19T23:59:59Z')), false)
})

test('zero contribution counts and zero color levels must agree', () => {
  for (const [count, level] of [[0, 1], [3, 0]]) {
    const input = fixture()
    input.contributions[0] = { ...input.contributions[0], count, level }
    input.total.lastYear = input.contributions.reduce((sum, day) => sum + day.count, 0)
    assert.equal(normalizeContributions(input), null)
  }
})

test('render coordinates preserve leap days, partial weeks and each GitHub color level', () => {
  const input = fixture('2023-08-01')
  const cells = contributionCells(input.contributions)
  assert.equal(cells.length, input.contributions.length)
  cells.forEach((cell, index) => {
    assert.equal(cell.date, input.contributions[index].date)
    assert.equal(cell.count, input.contributions[index].count)
    assert.equal(cell.level, input.contributions[index].level)
    assert.equal(cell.y, new Date(`${cell.date}T00:00:00Z`).getUTCDay())
    assert.equal(cell.x, Math.floor((index + 2) / 7))
  })
})

test('site days follow Shanghai midnight, independent of build or visitor time zone',()=>{
  assert.equal(siteDaysOnline('2026-10-18',new Date('2026-10-23T15:59:59Z')),5)
  assert.equal(siteDaysOnline('2026-10-18',new Date('2026-10-23T16:00:00Z')),6)
  assert.equal(siteDaysOnline('2026-10-18',new Date('2026-10-17T15:00:00Z')),0)
  assert.equal(siteDaysOnline('not a date'),null)
})



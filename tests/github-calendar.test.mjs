import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText
const source = readFileSync(new URL('../src/lib/github-contributions.ts', import.meta.url), 'utf8')
const load = fetch => {
  const context = { exports: {}, fetch, setTimeout, clearTimeout, AbortController }
  vm.runInNewContext(compile(source), context)
  return context.exports
}
const { normalizeContributions, contributionWeeks } = load()
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

test('both locales share one build request and malformed user paths never reach the network', async () => {
  let calls = 0
  const api = load(async () => { calls++; return { ok: true, json: async () => fixture() } })
  const [a, b] = await Promise.all([api.fetchContributions('Cyril-Fan'), api.fetchContributions('Cyril-Fan')])
  assert.equal(calls, 1)
  assert.equal(a, b)
  for (const user of ['../other', 'x?y=all', 'name/other', '', 'a'.repeat(40)]) assert.equal(await api.fetchContributions(user), null)
  assert.equal(calls, 1)
})

test('unavailable or invalid upstream data yields an honest empty state', async () => {
  for (const fetch of [
    async () => { throw new Error('Offline') },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ contributions: [], total: { lastYear: 0 } }) })
  ]) assert.equal(await load(fetch).fetchContributions('Cyril-Fan'), null)
})



import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
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

function browser() {
  const markup = `<github-calendar><div data-calendar-scroll><svg>${
    Array.from({ length: 12 }, (_, index) =>
      `<rect data-calendar-day tabindex="${index === 11 ? 0 : -1}" aria-label="day ${index}"></rect>`).join('')
  }</svg></div><output data-day-detail></output></github-calendar>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only', url: 'https://example.org/' })
  const component = readFileSync(new URL('../src/components/home/GitHubActivityCalendar.astro', import.meta.url), 'utf8')
  const script = component.match(/<script>([\s\S]*?)<\/script>/)[1]
  const elements = [...dom.window.document.querySelectorAll('[data-calendar-day]')]
  const focused = []
  for (const [index, element] of elements.entries()) {
    element.focus = () => { focused.push(index); element.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })) }
    element.scrollIntoView = () => {}
  }
  dom.window.eval(compile(script))
  return { dom, elements, focused, calendar: dom.window.document.querySelector('github-calendar'), detail: dom.window.document.querySelector('output') }
}

test('keyboard navigation moves by days and weeks with a single tab stop and readable day detail', () => {
  const { dom, elements, focused, detail } = browser()
  const key = (index, value) => elements[index].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  key(11, 'ArrowLeft')
  assert.equal(focused.at(-1), 4)
  assert.equal(detail.textContent, 'day 4')
  key(4, 'ArrowUp')
  assert.equal(focused.at(-1), 3)
  key(3, 'Home')
  assert.equal(focused.at(-1), 0)
  key(0, 'ArrowUp')
  assert.equal(focused.at(-1), 0)
  key(0, 'End')
  assert.equal(focused.at(-1), 11)
  assert.equal(elements.filter(element => element.getAttribute('tabindex') === '0').length, 1)
  dom.window.close()
})

test('tap displays a day count, and reconnect does not duplicate key handlers', () => {
  const { dom, calendar, elements, focused, detail } = browser()
  elements[4].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert.equal(detail.textContent, 'day 4')
  calendar.remove()
  dom.window.document.body.append(calendar)
  elements[4].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  assert.deepEqual(focused, [11])
  dom.window.close()
})

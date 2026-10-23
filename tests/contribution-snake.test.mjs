import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { fetchContributionSnapshot, syncContributionSnake, validateSnake, staticSnake, verifyContributionBundle } from '../scripts/sync-contribution-snake.mjs'
import { createContributionAnimations, planContributionRoute, STEP_MS, validateRoute } from '../scripts/contribution-animation.mjs'
import { contributionPalettes, normalizeContributions } from '../src/lib/github-contributions.ts'

const metadata = JSON.parse(readFileSync(new URL('../src/assets/contributions.json', import.meta.url), 'utf8'))
const svg = readFileSync(new URL(`../public${metadata.light}`, import.meta.url), 'utf8')
test('checked-in animations and static alternatives match one verified daily calendar', async () => {
  assert.equal(validateSnake(svg), svg)
  const dark = readFileSync(new URL(`../public${metadata.dark}`, import.meta.url), 'utf8')
  assert.notEqual(validateSnake(dark), svg)
  assert.ok(svg.includes('--ce:#eff2f5'))
  assert.ok(dark.includes('--ce:#151b23'))
  assert.equal(readFileSync(new URL(`../public${metadata.lightStatic}`, import.meta.url), 'utf8'), staticSnake(svg))
  await verifyContributionBundle({ requireFresh: false })
})
test('changed remote SVG cannot inject executable tags, handlers, remote resources or entities', () => {
  for (const payload of [
    '<script>alert(1)</script>', '<foreignObject><p>HTML</p></foreignObject>',
    '<image href="https://example.org/tracker"/>', '<g onclick="alert(1)"></g>',
    '<style>@import "https://example.org/style.css";</style>',
    '<style>.x{fill:url(https://example.org/image)}</style>',
    '<!ENTITY test SYSTEM "file:///secret">',
  ]) assert.throws(() => validateSnake(svg.replace('</svg>', payload+'</svg')))
})

const activityFixture = ({ start = '2025-10-19', length = 370, dense = false, empty = false } = {}) => {
  const begin = Date.parse(`${start}T00:00:00Z`)
  const active = new Set([0, 6, 7, 21, 166, length - 3, length - 1])
  const contributions = Array.from({ length }, (_, index) => {
    const level = !empty && (dense || active.has(index)) ? index % 4 + 1 : 0
    return { date: new Date(begin + index * 86_400_000).toISOString().slice(0, 10), count: level * 3, level }
  })
  return { contributions, total: { lastYear: contributions.reduce((sum, day) => sum + day.count, 0) } }
}

function graphResponse(input) {
  const names = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE']
  return { data: { user: { login: 'Cyril-Fan', contributionsCollection: { contributionCalendar: {
    totalContributions: input.total.lastYear,
    weeks: [{ contributionDays: input.contributions.map(day => ({ date: day.date, contributionCount: day.count, contributionLevel: names[day.level] })) }]
  } } } } }
}
const responseFor = value => ({ ok: true, status: 200, json: async () => structuredClone(value) })
const checkTime = new Date('2026-10-23T03:00:00.000Z')

for (const [name, fixture] of [
  ['sparse activity and distant targets', activityFixture()],
  ['a dense year', activityFixture({ dense: true })],
  ['a leap year with partial weeks', activityFixture({ start: '2023-08-01', length: 367 })],
  ['a completely empty year', activityFixture({ empty: true })]
]) test(`snake motion is continuous, collision-free and complete for ${name}`, () => {
  const calendar = normalizeContributions(fixture)
  const plan = planContributionRoute(calendar)
  assert.deepEqual(plan.route.at(-1), plan.route[0], 'The loop must return with the same body pose')
  const visited = new Set()
  for (let index = 0; index < plan.route.length; index++) {
    const pose = plan.route[index]
    assert.equal(new Set(pose.map(point => `${point.x},${point.y}`)).size, 4)
    visited.add(`${pose[0].x},${pose[0].y}`)
    if (index) {
      const before = plan.route[index - 1]
      assert.equal(Math.abs(pose[0].x - before[0].x) + Math.abs(pose[0].y - before[0].y), 1)
      assert.deepEqual(pose.slice(1), before.slice(0, -1))
    }
  }
  for (const cell of plan.cells.filter(cell => cell.count > 0)) assert.ok(visited.has(`${cell.x},${cell.y}`))
  assert.equal(plan.consumed.size, fixture.contributions.filter(day => day.count > 0).length)
  if (name === 'a completely empty year') assert.equal(plan.route.length, 1, 'An empty calendar invents no activity')
})

test('route validation rejects a teleport, self intersection, missed cell and broken loop', () => {
  const plan = planContributionRoute(normalizeContributions(activityFixture()))
  const teleport = structuredClone(plan.route)
  teleport[1][0].x += 3
  assert.throws(() => validateRoute(teleport, plan.cells))
  const collision = structuredClone(plan.route)
  collision[1][0] = { ...collision[1][1] }
  assert.throws(() => validateRoute(collision, plan.cells), /intersects/)
  assert.throws(() => validateRoute([plan.route[0]], plan.cells), /misses/)
  assert.throws(() => validateRoute(plan.route.slice(0, -1), plan.cells), /loop/)
})

test('both SVG themes preserve every date/count/level and actual CSS eats a cell only at head arrival', context => {
  const input = activityFixture({ start: '2023-08-01', length: 367 })
  const { calendar, plan, light, dark } = createContributionAnimations(input)
  for (const [theme, asset] of [['light', light], ['dark', dark]]) {
    const dom = new JSDOM(`<html><head><style>${asset.match(/<style>([\s\S]+?)<\/style>/)[1]}</style></head><body>${asset}</body></html>`)
    context.after(() => dom.window.close())
    const rules = [...dom.window.document.styleSheets[0].cssRules]
    const frames = new Map(rules.filter(rule => rule.name).map(rule => [rule.name, [...rule.cssRules]]))
    const rectangles = [...dom.window.document.querySelectorAll('rect.c')]
    const headFrames = frames.get('s0').map(frame => ({
      fraction: Number.parseFloat(frame.keyText) / 100,
      point: frame.style.getPropertyValue('transform').match(/translate\((-?[\d.]+)px,(-?[\d.]+)px\)/).slice(1).map(Number)
    }))
    const headAt = fraction => {
      const right = headFrames.findIndex(frame => frame.fraction >= fraction)
      const a = headFrames[Math.max(0, right - 1)]
      const b = headFrames[right]
      const progress = b.fraction === a.fraction ? 0 : (fraction - a.fraction) / (b.fraction - a.fraction)
      return a.point.map((value, axis) => value + (b.point[axis] - value) * progress)
    }
    assert.equal(rectangles.length, input.contributions.length)
    rectangles.forEach((rect, index) => {
      const expected = input.contributions[index]
      assert.equal(rect.dataset.date, expected.date)
      assert.equal(Number(rect.dataset.count), expected.count)
      assert.equal(Number(rect.dataset.level), expected.level)
      assert.ok(rect.classList.contains(`level-${expected.level}`))
      const fillRule = rules.find(rule => rule.selectorText === `.level-${expected.level}`)
      assert.equal(fillRule.style.getPropertyValue('fill'), `var(--c${expected.level})`)
      assert.equal(rules[0].style.getPropertyValue(`--c${expected.level}`), contributionPalettes[theme].colors[expected.level])
      if (!expected.count) {
        assert.equal(rect.dataset.consumedAt, undefined)
        return
      }
      const motion = rules.find(rule => rule.selectorText === `.e${index}`)
      assert.match(motion.style.getPropertyValue('animation'), /steps\(1,end\)/)
      const colorFrames = frames.get(`e${index}`)
      assert.equal(colorFrames[0].style.getPropertyValue('fill'), `var(--c${expected.level})`)
      assert.equal(colorFrames[1].style.getPropertyValue('fill'), 'var(--ce)')
      const arrivalFraction = Number.parseFloat(colorFrames[1].keyText) / 100
      const [headX, headY] = headAt(arrivalFraction)
      assert.ok(Math.abs(headX - (Number(rect.getAttribute('x')) - 2)) < 0.001)
      assert.ok(Math.abs(headY - (Number(rect.getAttribute('y')) - 2)) < 0.001)
      assert.ok(Math.abs(arrivalFraction * plan.duration - Number(rect.dataset.consumedAt)) < 0.001)
    })
    // Between arrival times the head must stay on the orthogonal route too.
    plan.route.forEach((pose, step) => {
      const point = headAt((450 + step * STEP_MS) / plan.duration)
      assert.ok(Math.abs(point[0] - pose[0].x * 16) < 0.001)
      assert.ok(Math.abs(point[1] - pose[0].y * 16) < 0.001)
    })
    assert.equal(staticSnake(asset).includes('*{animation:none!important;transition:none!important}'), true)
  }
  assert.equal(calendar.total, input.total.lastYear)
})

test('a new contribution changes the calendar identity and both animated themes together', () => {
  const input = activityFixture()
  const before = createContributionAnimations(input)
  input.contributions[42].count = 2
  input.contributions[42].level = 1
  input.total.lastYear += 2
  const after = createContributionAnimations(input)
  assert.notEqual(before.light, after.light)
  assert.notEqual(before.dark, after.dark)
  assert.equal(after.plan.consumed.size, before.plan.consumed.size + 1)
  assert.equal(after.calendar.total, before.calendar.total + 2)
})

test('one fresh GitHub request publishes a matching bundle; failures never replace its files', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'contribution-tests-'))
  const root = pathToFileURL(directory + sep)
  context.after(async () => {
    const target = resolve(directory)
    assert.equal(dirname(target), resolve(tmpdir()))
    assert.ok(basename(target).startsWith('contribution-tests-'))
    await rm(target, { recursive: true, force: true })
  })
  const input = activityFixture()
  let calls = 0
  const metadata = await syncContributionSnake({ root, now: checkTime, token: 'test-token', ci: true, fetcher: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.github.com/graphql')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    assert.equal(options.cache, 'no-store')
    return responseFor(graphResponse(input))
  } })
  assert.equal(calls, 1)
  const result = await verifyContributionBundle({ root, now: checkTime })
  assert.equal(result.calendar.total, input.total.lastYear)
  assert.equal(metadata.dataHash, result.snapshot.dataHash)
  const manifestFile = new URL('src/assets/contributions.json', root)
  const calendarFile = new URL('src/assets/contribution-calendar.json', root)
  const before = [await readFile(manifestFile, 'utf8'), await readFile(calendarFile, 'utf8')]
  for (const fetcher of [
    async () => { throw new Error('Offline') },
    async () => ({ ok: false, status: 403 }),
    async () => responseFor({ errors: [{ message: 'Unavailable' }] }),
    async () => responseFor(graphResponse(activityFixture({ start: '2025-10-01' }))),
    async () => responseFor(graphResponse({ ...input, total: { lastYear: input.total.lastYear + 1 } }))
  ]) {
    await assert.rejects(syncContributionSnake({ root, now: checkTime, token: 'test-token', ci: true, fetcher }))
    assert.deepEqual([await readFile(manifestFile, 'utf8'), await readFile(calendarFile, 'utf8')], before)
  }
  const tampered = JSON.parse(before[1])
  tampered.contributions[0].count++
  tampered.total.lastYear++
  await writeFile(calendarFile, JSON.stringify(tampered))
  await assert.rejects(verifyContributionBundle({ root, now: checkTime }), /identity mismatch/)
})

test('CI requires direct GitHub data; local public snapshots retain their source time and must be fresh', async () => {
  let calls = 0
  await assert.rejects(fetchContributionSnapshot({ token: '', ci: true, fetcher: async () => { calls++ } }), /GITHUB_TOKEN/)
  assert.equal(calls, 0)
  const input = activityFixture()
  const publicData = { login: 'Cyril-Fan', updated: '2026-10-23 01:57', calendar: input.contributions, stats: [['Contributions', input.total.lastYear]] }
  const snapshot = await fetchContributionSnapshot({ token: '', ci: false, now: checkTime, fetcher: async () => responseFor(publicData) })
  assert.equal(snapshot.fetchedAt, '2026-10-23T01:57:00.000Z')
  assert.equal(snapshot.checkedAt, checkTime.toISOString())
  assert.equal(snapshot.dataThrough, '2026-10-23')
  await assert.rejects(fetchContributionSnapshot({ token: '', ci: false, now: checkTime, fetcher: async () => responseFor({ ...publicData, updated: '2026-10-21 00:00' }) }), /stale/)
})

const component = readFileSync(new URL('../src/components/home/ContributionSnake.astro', import.meta.url), 'utf8')
const script = component.match(/<script>([\s\S]*?)<\/script>/)[1]
const compiled = ts.transpileModule(script, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
for (const en of [true, false]) test(`${en?'en':'zh'}: reduced motion, manual play/pause and reconnect stay consistent`, context => {
  const dom = new JSDOM(`<contribution-snake data-lang="${en?'en':'zh'}"><button data-snake-toggle hidden></button></contribution-snake>`, {runScripts:'outside-only'})
  context.after(() => dom.window.close())
  const media = new dom.window.EventTarget()
  media.matches = true
  dom.window.matchMedia = () => media
  dom.window.eval(compiled)
  const host = dom.window.document.querySelector('contribution-snake')
  const button = host.querySelector('button')
  assert.equal(host.dataset.playing, 'false')
  assert.equal(button.hidden, false)
  button.click()
  assert.equal(host.dataset.playing, 'true')
  assert.equal(button.textContent, en?'Turn off animation':'关闭动画')
  button.click()
  assert.equal(host.dataset.playing, 'false')
  media.matches = false
  media.dispatchEvent(new dom.window.Event('change'))
  assert.equal(host.dataset.playing, 'false', 'An explicit off choice survives a motion preference change')
  host.remove()
  dom.window.document.body.append(host)
  button.click()
  assert.equal(host.dataset.playing, 'true', 'Reconnection must not attach duplicate click handlers')
})

test('calendar reveals real day counts on hover, tap, keyboard and date selection; animation hides its controls', context => {
  const days = Array.from({length:10}, (_, i) => `<rect role="button" data-date="2026-10-${String(i+1).padStart(2,'0')}" data-count="${i}" tabindex="${i===9?0:-1}" aria-label="day ${i}: ${i} contributions"></rect>`).join('')
  const dom = new JSDOM(`<contribution-snake data-lang="en"><div class="snake-animated"></div><div class="contribution-calendar"><svg>${days}</svg></div><input type="date" data-contribution-date><output data-contribution-detail></output><button data-snake-toggle></button></contribution-snake>`, {runScripts:'outside-only'})
  context.after(() => dom.window.close())
  const media = new dom.window.EventTarget()
  media.matches = false
  dom.window.matchMedia = () => media
  dom.window.eval(compiled)
  const host = dom.window.document.querySelector('contribution-snake')
  const input = host.querySelector('input')
  const output = host.querySelector('output')
  const cells = [...host.querySelectorAll('[data-date]')]
  const button = host.querySelector('button')
  assert.equal(host.dataset.playing, 'true')
  assert.equal(input.disabled, true)
  button.click()
  assert.equal(host.querySelector('.contribution-calendar').getAttribute('aria-hidden'), 'false')
  assert.equal(input.disabled, false)
  cells[3].dispatchEvent(new dom.window.Event('pointerenter'))
  assert.equal(output.textContent, 'day 3: 3 contributions')
  assert.equal(input.value, '2026-10-04')
  cells[4].dispatchEvent(new dom.window.MouseEvent('click'))
  assert.equal(output.textContent, 'day 4: 4 contributions')
  const key = (i, value) => cells[i].dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:value, cancelable:true}))
  key(9, 'ArrowLeft')
  assert.equal(output.textContent, 'day 2: 2 contributions')
  key(2, 'Home')
  assert.equal(output.textContent, 'day 0: 0 contributions')
  key(0, 'End')
  assert.equal(cells.filter(c => c.tabIndex === 0).length, 1)
  input.value = '2026-10-06'
  input.dispatchEvent(new dom.window.Event('change'))
  assert.equal(output.textContent, 'day 5: 5 contributions')
  button.click()
  assert.equal(input.disabled, true)
  assert.equal(host.querySelector('.contribution-calendar').getAttribute('aria-hidden'), 'true')
  media.matches = true
  media.dispatchEvent(new dom.window.Event('change'))
  assert.equal(host.dataset.playing, 'false', 'Reduced-motion preference stops the animation')
})

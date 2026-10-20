import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { validateSnake, staticSnake } from '../scripts/sync-contribution-snake.mjs'

const metadata = JSON.parse(readFileSync(new URL('../src/assets/contributions.json', import.meta.url), 'utf8'))
const svg = readFileSync(new URL(`../public${metadata.light}`, import.meta.url), 'utf8')
test('profile animations are real, distinct light/dark assets, with a static alternative', () => {
  assert.equal(validateSnake(svg), svg)
  const dark = readFileSync(new URL(`../public${metadata.dark}`, import.meta.url), 'utf8')
  assert.notEqual(validateSnake(dark), svg)
  assert.ok(svg.includes('--ce:#eff2f5'))
  assert.ok(dark.includes('--ce:#151b23'))
  assert.equal(readFileSync(new URL(`../public${metadata.lightStatic}`, import.meta.url), 'utf8'), staticSnake(svg))
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

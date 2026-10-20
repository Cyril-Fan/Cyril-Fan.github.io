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
  assert.equal(button.textContent, en?'Pause animation':'暂停动画')
  button.click()
  assert.equal(host.dataset.playing, 'false')
  media.matches = false
  media.dispatchEvent(new dom.window.Event('change'))
  assert.equal(host.dataset.playing, 'true')
  host.remove()
  dom.window.document.body.append(host)
  button.click()
  assert.equal(host.dataset.playing, 'false', 'Reconnection must not attach duplicate click handlers')
})

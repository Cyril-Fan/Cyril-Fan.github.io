import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/pages/TOC.astro', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'Exercise the real TOC component script')
const compiled = ts.transpileModule(script, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText

function setup(context, { content = true, reducedMotion = false } = {}) {
  const links = ['first', 'missing', 'second', 'third'].map((id) =>
    `<li><div><span data-toc-progress></span><a href="#${id}">${id}</a></div></li>`
  ).join('')
  const dom = new JSDOM(`<!doctype html><main>
    <aside><toc-heading><ul>${links}</ul></toc-heading></aside>
    <article>${content ? '<div id="content"><h2 id="first">First</h2><h2 id="second">Second</h2><h2 id="third">Third</h2></div>' : ''}</article>
    <section id="comments"><h2 id="comment-title">Comments</h2></section>
  </main>`, { url: 'https://cyril-fan.top/about', runScripts: 'outside-only' })
  context.after(() => dom.window.close())
  const { window } = dom
  const frames = new Map()
  const observers = []
  const scrolled = []
  const geometry = { scrollY: 0, first: 100, second: 1000, third: 1700, bottom: 2100 }
  let nextFrame = 0
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  window.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame }
  window.cancelAnimationFrame = (id) => frames.delete(id)
  window.setInterval = () => { throw new Error('The TOC must not keep polling') }
  window.matchMedia = () => ({ matches: reducedMotion })
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
    observe(element) { this.element = element }
    disconnect() { this.disconnected = true }
  }
  const contentElement = window.document.getElementById('content')
  if (contentElement) {
    contentElement.getBoundingClientRect = () => new window.DOMRect(0, 100 - geometry.scrollY, 700, geometry.bottom - 100)
    for (const id of ['first', 'second', 'third']) {
      const heading = window.document.getElementById(id)
      heading.getBoundingClientRect = () => new window.DOMRect(0, geometry[id] - geometry.scrollY, 700, 30)
      heading.scrollIntoView = (options) => scrolled.push({ id, options })
    }
  }
  window.Function(compiled)()
  const toc = window.document.querySelector('toc-heading')
  const link = (id) => toc.querySelector(`a[href="#${id}"]`)
  const progress = (id) => link(id).previousElementSibling
  const flushFrame = () => {
    const callbacks = Array.from(frames.values())
    frames.clear()
    callbacks.forEach((callback) => callback())
  }
  return { window, toc, link, progress, frames, observers, scrolled, geometry, flushFrame }
}

test('missing headings do not break section highlighting or finite progress', (context) => {
  const { window, toc, link, progress, geometry, flushFrame } = setup(context)
  assert.equal(link('first').getAttribute('aria-current'), 'location')
  assert.equal(link('missing').classList.contains('highlight'), false)
  assert.equal(progress('missing').style.height, '0%')
  assert.equal(toc.headings.some((heading) => heading.id === 'comment-title'), false)

  geometry.scrollY = 1100
  window.dispatchEvent(new window.Event('scroll'))
  flushFrame()
  assert.equal(progress('first').classList.contains('readed'), true)
  assert.equal(link('second').getAttribute('aria-current'), 'location')
  assert.equal(link('second').classList.contains('rounded-t-2xl'), true)
  assert.equal(link('third').classList.contains('rounded-b-2xl'), true)

  geometry.second = geometry.first
  geometry.third = geometry.first
  geometry.bottom = geometry.first
  assert.doesNotThrow(() => toc.updatePositionAndStyle())
  for (const id of ['first', 'missing', 'second', 'third']) {
    const height = Number.parseFloat(progress(id).style.height)
    assert.ok(Number.isFinite(height) && height >= 0 && height <= 90)
  }
})

test('disconnect cancels pending work, releases observers and reconnects clicks once', (context) => {
  const { window, toc, link, frames, observers, scrolled, flushFrame } = setup(context)
  const parent = toc.parentElement
  window.dispatchEvent(new window.Event('scroll'))
  assert.equal(frames.size, 1)
  toc.remove()
  assert.equal(frames.size, 0)
  assert.equal(observers[0].disconnected, true)
  window.dispatchEvent(new window.Event('scroll'))
  window.dispatchEvent(new window.Event('resize'))
  assert.equal(frames.size, 0)

  parent.append(toc)
  assert.equal(observers.length, 2)
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  link('second').dispatchEvent(click)
  assert.equal(click.defaultPrevented, true)
  assert.equal(scrolled.length, 1)
  assert.equal(scrolled[0].id, 'second')
  assert.equal(scrolled[0].options.behavior, 'smooth')
  assert.equal(window.location.hash, '#second')
  flushFrame()
  assert.doesNotThrow(() => window.Function(compiled)(), 'Loading the module twice must not redefine its custom element')
})

test('content reflow updates progress and reduced motion keeps anchor scrolling immediate', (context) => {
  const { window, toc, link, progress, observers, geometry, scrolled, flushFrame } = setup(context, { reducedMotion: true })
  geometry.scrollY = 1500
  toc.updatePositionAndStyle()
  const before = Number.parseFloat(progress('third').style.height)
  geometry.bottom = 4000
  observers[0].callback()
  flushFrame()
  assert.ok(Number.parseFloat(progress('third').style.height) < before)
  link('third').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  assert.equal(scrolled[0].options.behavior, 'auto')
  const modifiedClick = new window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
  link('third').dispatchEvent(modifiedClick)
  assert.equal(modifiedClick.defaultPrevented, false)
  assert.equal(scrolled.length, 1)
})

test('a page without article content remains safe to connect and disconnect', (context) => {
  const { toc } = setup(context, { content: false })
  assert.doesNotThrow(() => toc.updatePositionAndStyle())
  assert.doesNotThrow(() => toc.remove())
})

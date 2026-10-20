import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { commentMarkdownHtml, renderCommentMarkdown } from './helpers/comment-markdown.mjs'

function rendered(source, context, scope) {
  const dom = new JSDOM('<main></main>', { url: 'https://cyril-fan.top/about/' })
  context.after(() => dom.window.close())
  const target = dom.window.document.querySelector('main')
  renderCommentMarkdown(target, source, false, scope)
  return target
}

test('CommonMark and GFM render rich blocks, nested lists, tasks, tables and references', context => {
  const target = rendered('# Heading\n\n**bold** *italic* ~~removed~~ and `code`\n\n> quote\n\n1. first\n   - nested\n\n- [x] checked\n- [ ] unchecked\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = "<img onerror=attack()>";\n```\n\n[reference][site]\n\n[site]: https://example.org\n\nhttps://example.com\n\n---', context)
  for (const selector of ['h1','strong','em','del','code','blockquote','ol','ul','li ul','table','thead','tbody','pre code.language-js','hr']) assert.ok(target.querySelector(selector), selector)
  assert.equal(target.querySelectorAll('input[type=checkbox][disabled]').length, 2)
  assert.equal(target.querySelectorAll('input:checked').length, 1)
  assert.equal(target.querySelector('pre code').textContent, 'const x = "<img onerror=attack()>";\n')
  assert.equal(target.querySelectorAll('img').length, 0)
  for (const link of target.querySelectorAll('a')) {
    assert.equal(link.target, '_blank')
    for (const attribute of ['noopener','noreferrer','nofollow','ugc']) assert.ok(link.relList.contains(attribute))
  }
})

test('raw HTML, SVG, forms, styles and embedded pages remain literal text', context => {
  const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n<svg><foreignObject><iframe srcdoc="<script>alert(3)</script>"></iframe></foreignObject></svg>\n\n<form id=comments><input name=action></form>\n\n<style>body{display:none}</style>\n\n<a id=location name=constructor href="javascript:alert(4)">x</a>'
  const target = rendered(source, context)
  assert.equal(target.querySelectorAll('script,img,svg,iframe,form,style,input').length, 0)
  assert.equal(target.querySelectorAll('[id],[name],[style],[onclick]').length, 0)
  assert.ok(target.textContent.includes('<script>alert(1)</script>'))
})

test('active URL schemes and credential-bearing links cannot become navigation', context => {
  const source = [
    '[a](javascript:alert%281%29)', '[a](JaVaScRiPt:alert%281%29)',
    '[a](data:text/html,attack)', '[a](vbscript:attack)', '[a](file:///etc/passwd)',
    '[a](java&#x73;cript:attack)', '[a](https://name:password@example.com/)',
    '![a](data:image/svg+xml,attack)', '![a](javascript:attack)',
  ].join('\n\n')
  const target = rendered(source, context)
  for (const link of target.querySelectorAll('a')) assert.equal(link.hasAttribute('href'), false)
  assert.equal(target.querySelectorAll('img,[data-markdown-image]').length, 0)
})

test('external images disclose their source and only load after a deliberate click', context => {
  const target = rendered('![a helpful diagram](https://example.org/diagram.png)', context)
  assert.equal(target.querySelector('img'), null)
  const button = target.querySelector('button')
  assert.match(button.textContent, /example.org/)
  button.click()
  const image = target.querySelector('img')
  assert.equal(image.src, 'https://example.org/diagram.png')
  assert.equal(image.alt, 'a helpful diagram')
  assert.equal(image.referrerPolicy, 'no-referrer')
  assert.equal(button.hidden, true)
  image.dispatchEvent(new target.ownerDocument.defaultView.Event('error'))
  assert.equal(target.querySelector('img'), null)
  assert.equal(button.hidden, false)
  assert.match(button.textContent, /失败/)
})

test('images cannot target insecure URLs, local services, inline blobs or embedded credentials', context => {
  const target = rendered([
    'http://example.org/image.png', 'https://localhost/image.png', 'https://127.0.0.1/image.png',
    'https://10.1.2.3/image.png', 'https://192.168.0.1/image.png', 'https://172.16.0.1/image.png',
    'https://[::1]/image.png', 'https://name:pass@example.com/image.png', '/avatar/avatar.png',
    'blob:https://example.org/uuid',
  ].map(url => `![blocked](${url})`).join('\n\n'), context)
  assert.equal(target.querySelectorAll('img,button,[data-markdown-image]').length, 0)
})

test('footnotes have scoped nonclobbering IDs and working references across comments', context => {
  const a = rendered('First[^location]\n\n[^location]: a note', context, 'first')
  const b = rendered('Second[^location]\n\n[^location]: another note', context, 'second')
  const firstIds = [...a.querySelectorAll('[id]')].map(node => node.id)
  const secondIds = [...b.querySelectorAll('[id]')].map(node => node.id)
  assert.ok(firstIds.length >= 3)
  assert.ok(firstIds.every(id => id.startsWith('comment-md-first-') && !secondIds.includes(id)))
  for (const target of [a,b]) {
    for (const link of target.querySelectorAll('a[href^="#"]')) {
      const id = link.getAttribute('href').slice(1)
      assert.ok([...target.querySelectorAll('[id]')].some(node => node.id === id), id)
    }
  }
})

test('TeX renders inline and block math without trusted commands, external images or macros leaking', context => {
  const target = rendered('Euler: $e^{i\\pi}+1=0$.\n\n$$\n\\frac{a}{b} + \\sum_{i=1}^{n} i\n$$\n\n$\\href{javascript:alert(1)}{bad}$\n\n$\\includegraphics{https://tracker.example/image.png}$\n\n$\\htmlClass{evil}{x}$', context)
  assert.ok(target.querySelectorAll('.katex').length >= 2)
  assert.ok(target.querySelector('.katex-display'))
  assert.equal(target.querySelectorAll('a,img,.evil,script,iframe').length, 0)
  const clean = commentMarkdownHtml('$\\testmacro$', false)
  assert.ok(clean.includes('testmacro'))
})

test('pathological or broken math stays bounded and does not break the rest of the comment', context => {
  const target = rendered('$\\def\\a{\\a}\\a$\n\nAfterwards **still readable**.\n\n$\\rule{999999em}{999999em}$', context)
  assert.equal(target.querySelector('strong')?.textContent, 'still readable')
  assert.ok(target.innerHTML.length < 100000)
  assert.ok([...target.querySelectorAll('[style]')].every(node => !node.getAttribute('style').includes('999999em')), 'User dimensions are bounded; original TeX may remain in accessible annotations')
})

test('ordinary Enter preserves a line break as expected in a conversation', context => {
  const target = rendered('First line\nSecond line\n\nNext paragraph', context)
  assert.equal(target.querySelectorAll('br').length, 1)
  assert.equal(target.querySelectorAll('p').length, 2)
})

test('the database-sized parsing limit counts Unicode code points without cutting emoji pairs', context => {
  const source = '🙂'.repeat(1999) + 'X'
  const target = rendered(source + 'discard beyond database limit', context)
  assert.equal(target.textContent, source)
  assert.equal(Array.from(target.textContent).length, 2000)
  assert.equal(target.textContent.includes('\uFFFD'), false)
})

test('negative TeX dimensions cannot escape their comment or create a giant scroll surface', context => {
  for (const command of ['\\raisebox{-999999em}{X}', 'x\\kern-999999em y', '\\hspace{-999999em}x', `\\raisebox{-${'9'.repeat(350)}em}{X}`]) {
    const target = rendered(`$${command}$\n\n**Still readable**`, context)
    assert.equal(target.querySelector('.comment-math-fallback')?.textContent, `$${command}$`)
    assert.equal(target.querySelector('strong')?.textContent, 'Still readable')
    assert.ok([...target.querySelectorAll('[style]')].every(node => !node.getAttribute('style').includes('999999')))
  }
})

test('markup remains escaped when a quote occurs in the image caption or URL', context => {
  const target = rendered('![" onclick="alert(1)](https://example.org/a%22.png)', context)
  const button = target.querySelector('button')
  assert.ok(button)
  assert.equal(target.querySelector('[onclick]'), null)
  assert.equal(target.querySelector('script'), null)
})

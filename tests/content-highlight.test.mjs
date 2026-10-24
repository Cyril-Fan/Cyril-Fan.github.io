import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir,unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
await mkdir('work',{recursive:true})
const path='work/highlight-test-'+randomUUID()+'.mjs'
await build({entryPoints:['src/lib/content-render.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:path})
const {highlightCode,renderArticleDocument}=await import(pathToFileURL(process.cwd()+'/'+path));await unlink(path)

test('C++ aliases and recognizable legacy fences use VS Code dual palettes without altering code',async()=>{
 const source='#include <iostream>\n// A comment\nint main() { std::cout << "Hello"; return 0; }'
 for(const language of ['CPP','c++','cc','cxx','text']){
  const html=await highlightCode(source,language),dom=new JSDOM(html),pre=dom.window.document.querySelector('pre')
  assert.match(pre.className,/light-plus dark-plus/)
  assert.equal(pre.querySelector('code').textContent,source)
  assert.match(pre.getAttribute('style'),/--shiki-dark-bg:#1E1E1E/i)
  assert.ok(pre.querySelectorAll('span[style]').length>12)
  assert.match(html,/--shiki-dark:#569CD6/i,'Keywords use the classic blue')
  assert.match(html,/--shiki-dark:#6A9955/i,'Comments use the classic green')
  assert.match(html,/--shiki-dark:#CE9178/i,'Strings use the classic orange')
  dom.window.close()
 }
})

test('article and preview rendering retains safe code, mathematics and unknown-language fallback',async()=>{
 const {html}=await renderArticleDocument('```python\nprint("<script>unsafe()</script>")\n```\n\n$$x^2$$\n\n```unknown\nplain <b>text</b>\n```')
 const dom=new JSDOM(html),d=dom.window.document
 assert.equal(d.querySelector('script'),null)
 assert.ok(d.querySelector('.katex'))
 assert.equal(d.querySelectorAll('.article-code').length,2)
 assert.match(d.querySelectorAll('code')[1].textContent,/plain <b>text<\/b>/)
 dom.window.close()
})

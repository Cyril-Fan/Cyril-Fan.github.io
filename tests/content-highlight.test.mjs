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


test('popular language fences share the classic palettes and preserve the original source',async()=>{
 const samples={python:'def square(x):\n    return x * x # note',javascript:'const value = "hello"; // note',typescript:'const count: number = 42;',jsx:'const App = () => <button>Hi</button>;',tsx:'const App = (p: Props) => <b>{p.name}</b>;',java:'public class App { int count = 2; }',c:'int main(void) { return 0; }',csharp:'public class App { string name = "Hello"; }',php:'<?php echo "hello"; ?>',rust:'fn main() { let x = 42; }',go:'package main\nfunc main() { println("hi") }',kotlin:'fun main() { println("Hi") }',swift:'let name: String = "Hi"',powershell:'$name = "Hi"; Write-Host $name',bash:'echo "$HOME" # note',sql:'SELECT name FROM users WHERE id = 1;',html:'<div class="card">Hello</div>',css:'.card { color: red; }',json:'{"name": "Hello", "count": 1}',yaml:'name: Hello\ncount: 1',r:'square <- function(x) { x * x }',dockerfile:'FROM node:24\nRUN npm ci',toml:'name = "site"',diff:'-before\n+after',markdown:'# Heading\n**bold**',latex:'\\frac{1}{2}',xml:'<node id="1">text</node>'}
 for(const [language,source]of Object.entries(samples)){
  const html=await highlightCode(source,language),dom=new JSDOM(html),pre=dom.window.document.querySelector('pre')
  assert.equal(pre.querySelector('code').textContent,source,language)
  assert.match(pre.className,/light-plus dark-plus/,language)
  assert.equal(dom.window.document.querySelector('[data-code-language]').dataset.codeLanguage,language,language)
  assert.ok(pre.querySelectorAll('span[style]').length>1,language+' should receive token colors')
  dom.window.close()
 }
})

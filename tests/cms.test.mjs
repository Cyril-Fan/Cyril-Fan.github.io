import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { schemas, emptyPayload, validatePayload, validateDocuments, publicFiles, allowedPath, safeUrl, validateWebp, referencedMedia } from '../supabase/functions/_shared/cms.ts'
import { articleMarkdown } from '../src/lib/article-markdown.ts'
const baseline=JSON.parse(await readFile(new URL('../src/data/cms-published.json',import.meta.url)))
const validPost=()=>({...emptyPayload('post'),slug:'my-note',publishDate:'2026-10-18',zh:{title:'Note',description:'A note',body:'# Hello\n\n$x^2$'}})
test('existing public content survives canonical round-trip without draft leakage',()=>{
  const docs=validateDocuments(baseline.documents),files=publicFiles(docs,'initial')
  assert.equal(JSON.parse(files.get('src/data/cms-published.json')).documents.length,6)
  assert.equal(JSON.parse(files.get('public/links.json')).friends[0].link_list.length,4)
  assert.ok([...files.keys()].every(allowedPath));assert.ok(!files.has('.github/workflows/deploy.yml'))
})
test('incomplete content is a private draft, but cannot publish',()=>{
  assert.doesNotThrow(()=>validatePayload('post',emptyPayload('post')))
  assert.throws(()=>validatePayload('post',emptyPayload('post'),true))
  assert.doesNotThrow(()=>validatePayload('post',validPost(),true))
})
test('publishing validates whole bilingual article and immutable safe slugs',()=>{
  for(const slug of ['../secret','a/b','hello.md','UPPER','a?x','-bad','a--b'])assert.throws(()=>validatePayload('post',{...validPost(),slug},true))
  const p=validPost();p.en.title='English only';assert.throws(()=>validatePayload('post',p,true))
  p.en={title:'English',description:'Summary',body:'Body'};assert.doesNotThrow(()=>validatePayload('post',p,true))
  const files=publicFiles([...baseline.documents,{id:'82000000-0000-4000-8000-000000000001',kind:'post',revision:1,payload:p}],'release')
  assert.ok(files.has('src/content/blogs/my-note/index.md'));assert.ok(files.has('src/content/blogs/my-note/index-en.md'))
})
test('frontmatter cannot escape into arbitrary YAML or paths',()=>{
  const p=validPost();p.zh.title='Title\n---\nmalicious: true';p.zh.description='quote: "hello"'
  const file=publicFiles([...baseline.documents,{id:'82000000-0000-4000-8000-000000000001',kind:'post',revision:1,payload:p}],'release').get('src/content/blogs/my-note/index.md')
  assert.equal(file.split('\n').filter(x=>x==='---').length,2)
  assert.match(file,/title: "Title\\n---\\nmalicious: true"/)
})
test('publishing allowlist excludes credentials, workflows, templates and traversals',()=>{
  for(const p of ['.env','.github/workflows/deploy.yml','src/pages/index.astro','public/../.env','public/media/evil.svg','src/content/blogs/../index.md','src/content/blogs/x/index.mdx'])assert.equal(allowedPath(p),false)
})
test('public URLs reject network-local, credentials and non-HTTPS addresses',()=>{
  for(const value of ['http://example.com','javascript:alert(1)','https://localhost/','https://127.1/','https://0x7f000001/','https://[::1]/','https://private.internal/','https://user:password@example.com','https://example.com:3000'])assert.equal(safeUrl(value),false,value)
  assert.equal(safeUrl('https://royzhao.cn/rss.xml'),true)
})
test('unknown fields and duplicated identities are rejected before publication',()=>{
  assert.throws(()=>validatePayload('post',{...validPost(),path:'.github/workflows/a.yml'},true))
  assert.throws(()=>validateDocuments([...baseline.documents,baseline.documents[0]]))
  assert.throws(()=>publicFiles(baseline.documents.filter(d=>d.kind!=='profile'),'x'))
})
test('media references are deduplicated across forms and Markdown',()=>{
  const id='82000000-0000-4000-8000-000000000001';assert.deepEqual(referencedMedia({image:`/media/${id}.webp`,body:`![x](/media/${id}.webp)`}),[id])
})
test('malformed or metadata-bearing image payloads never enter public history',async()=>{
  const img=await readFile(new URL('../public/links/royzhao.webp',import.meta.url));assert.doesNotThrow(()=>validateWebp(img))
  assert.throws(()=>validateWebp(new TextEncoder().encode('<svg onload="alert(1)"></svg>')))
  const truncated=img.subarray(0,img.length-1);assert.throws(()=>validateWebp(truncated))
  const extra=new Uint8Array(img.length+8);extra.set(img);extra.set(new TextEncoder().encode('EXIF'),img.length);new DataView(extra.buffer).setUint32(4,extra.length-8,true);assert.throws(()=>validateWebp(extra))
})
test('article preview renders standard Markdown, tables, tasks, notes and TeX without executing HTML',()=>{
  const html=articleMarkdown('# Heading\n\n**Bold** *italic* ~~removed~~\n\n- [x] Task\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n$x^2$\n\n$$\n\\frac{a}{b}\n$$\n\nNote[^1]\n\n[^1]: Footnote\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))')
  for(const expected of ['<h1>','<strong>','<em>','<del>','<table>','type="checkbox"','katex','footnote'])assert.ok(html.includes(expected),expected)
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'))
})

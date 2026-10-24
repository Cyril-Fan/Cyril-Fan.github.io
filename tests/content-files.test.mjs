import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathKind,readArticle,writeArticle,validateMarkdown,validateText,validateImage,safeUrl,fileReferences,gitBlobHash,newArticle,imageRepositoryPath,replaceImageReferences,publicImage } from '../supabase/functions/_shared/git-content.ts'
import { articleMarkdown,prepareThemeSource } from '../src/lib/article-markdown.ts'
import { JSDOM } from 'jsdom'
const profile=JSON.parse(await readFile(new URL('../src/data/profile.json',import.meta.url)))
const academic=JSON.parse(await readFile(new URL('../src/data/academic.json',import.meta.url)))
test('content paths never reach application, credentials or workflow files',()=>{
  for(const p of ['.env','.github/workflows/deploy.yml','src/pages/index.astro','supabase/config.toml','public/media/a.svg','src/content/blogs/../../package.json','public/media/a.webp.js'])assert.equal(pathKind(p),null,p)
  for(const p of ['src/data/profile.json','src/data/academic.json','public/links.json','src/content/blogs/demo/index-en.mdx','src/content/collection/demo.md','public/media/test.gif'])assert.ok(pathKind(p),p)
})
test('editing body preserves unknown fields, frontmatter comments and image metadata',()=>{
  const source='---\n# keep this\ntitle: Example\ndescription: Test\npublishDate: 2026-10-24\ncustom: [a, b]\nheroImage:\n  src: ./photo.png\n  width: 900\n---\nOriginal'
  const next=writeArticle(source,{title:'Changed'},'New body')
  assert.match(next,/# keep this/);assert.deepEqual(readArticle(next).data.custom,['a','b']);assert.equal(readArticle(next).data.heroImage.width,900);assert.equal(readArticle(next).body,'New body')
})
test('server validates file schemas before writes',()=>{
  validateText('src/data/profile.json',JSON.stringify(profile));validateText('src/data/academic.json',JSON.stringify(academic))
  const p=structuredClone(profile);p.zh.intro={script:'bad'};assert.throws(()=>validateText('src/data/profile.json',JSON.stringify(p)))
  const a=structuredClone(academic);a.zh.projects.push({title:'Missing links'});assert.throws(()=>validateText('src/data/academic.json',JSON.stringify(a)))
  const post=writeArticle(newArticle(),{title:'Actual title',pixivLink:'123',source:'https://example.org'})
  validateText('src/content/blogs/example/index.md',post)
  for(const data of [{publishDate:'bad'},{comment:'yes'},{source:'javascript:alert(1)'},{heroImage:{src:'https://example.org/p.png',width:-1}}])assert.throws(()=>validateText('src/content/blogs/example/index.md',writeArticle(post,data)))
})
test('MDX only permits static theme blocks, never programs or event attributes',()=>{
  validateMarkdown('<Aside type="tip" title="Note">\nText\n</Aside>\n\n$x^{2}$',true)
  for(const source of ['import x from "./secret"','export const x=1','{fetch("/secret")}','<Aside onClick="bad()">','<script>alert(1)</script>'])assert.throws(()=>validateMarkdown(source,true),source)
})
test('full article syntax renders safe GFM, math, nested blocks, and stable heading anchors',()=>{
  const src='# Title\n\n## Repeat\n\n## Repeat\n\n:::note Note\n\n**Bold** and *italic*, ~~strike~~.\n\n:::details More\n\n- [x] Task\n\n:::\n\n:::\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nFootnote[^n]\n\n[^n]: Test\n\n$$\nx^2 = 4\n$$\n\n'+String.fromCharCode(96).repeat(3)+'js\nconst x = "<script>";\n'+String.fromCharCode(96).repeat(3)+'\n\n<script>bad()</script>\n\n[bad](javascript:alert(1))'
  const doc=new JSDOM(articleMarkdown(src)).window.document
  for(const selector of ['h1#title','h2#repeat','h2#repeat-1','aside.theme-note','details.theme-details','table','input[type=checkbox]','section[data-footnotes]','.katex','code.language-js'])assert.ok(doc.querySelector(selector),selector)
  assert.equal(doc.querySelector('script'),null);assert.equal(doc.querySelector('a[href^="javascript"]'),null)
  for(const a of doc.querySelectorAll('a[href^="#"]'))assert.ok(doc.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))),a.outerHTML)
  assert.match(articleMarkdown('```python title="example.py"\nprint(1)\n```'),/data-meta="title=&#x22;example.py&#x22;"/)
  assert.match(prepareThemeSource('$$x^2$$\n<Collapse title="X">'),/:::details X/)
})
test('image checks preserve real WebP bytes and reject mismatched/script formats',async()=>{
  const bytes=await readFile(new URL('../public/links/royzhao.webp',import.meta.url));validateImage('public/media/test.webp',bytes)
  assert.throws(()=>validateImage('public/media/test.png',bytes));assert.throws(()=>validateImage('public/media/test.svg',bytes))
  assert.ok(safeUrl('/src/assets/avatar.png',true));assert.ok(!safeUrl('javascript:bad()',true))
  assert.ok(fileReferences('import x from "@/assets/avatar.png"','src/assets/avatar.png','src/example.ts'))
  assert.ok(fileReferences('![x](./photo.gif)','src/content/blogs/demo/photo.gif','src/content/blogs/demo/index.md'))
  assert.equal((await gitBlobHash(bytes)).length,40)
})

test('relative, shared and source image paths resolve and replace without broken prefixes',()=>{
  const path='src/content/blogs/demo/photo.gif',source='src/content/blogs/demo/index.md',replacement='/media/image-abcd.webp'
  assert.equal(imageRepositoryPath('./photo.gif',source),path)
  assert.equal(publicImage(path),'/'+path)
  assert.ok(safeUrl('/'+path,true))
  assert.equal(replaceImageReferences('![x](./photo.gif)\nheroImage:\n  src: photo.gif',path,source,replacement),'![x]('+replacement+')\nheroImage:\n  src: '+replacement)
  assert.ok(fileReferences('![x](../demo/photo.gif)',path,'src/content/blogs/other/index.md'))
  assert.equal(fileReferences(String.raw`const escaped = '\\/';`,path,'src/components/Search.astro'),false)
  assert.equal(replaceImageReferences('![x](/links/roy.webp) ![y](/links/roy.webp.backup.png)','public/links/roy.webp',source,replacement),'![x]('+replacement+') ![y](/links/roy.webp.backup.png)')
})


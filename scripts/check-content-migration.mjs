/** Local integration check. Temporary content is always removed and is never published. */
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, unlink, rmdir, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve, sep } from 'node:path'
import { parse } from 'node-html-parser'
import { publicFiles, emptyPayload } from '../supabase/functions/_shared/cms.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const astroPackage = JSON.parse(await readFile(join(root,'node_modules/astro/package.json'),'utf8'))
const astroCli = join(root,'node_modules/astro',astroPackage.bin.astro)
const output = resolve(root, '.content-check-dist')
assert.ok(output.startsWith(root), 'Keep test output inside this repository')
const directories = ['migration-check', 'migration-fallback', 'migration-draft', 'migration-cms'].map(name => join(root,'src/content/blogs',name))
const collection = join(root,'src/content/collection/migration-check.md')
const createdFiles = [], createdDirectories = []
const article = (title, extra = '') => `---\ntitle: "${title}"\ndescription: "Local migration validation"\npublishDate: 2026-10-18\ntags: [Migration]\ncategory: technical\n${extra}---\n\n`
try {
  for (const dir of directories) {
    assert.ok(dir.startsWith(join(root,'src/content/blogs') + sep))
    await mkdir(dir)
    createdDirectories.push(dir)
  }
  const body = `
## Test heading

**Bold** and [external link](https://example.org/).

| Item | Value |
| --- | --- |
| test | 1 |

- [x] Task list

Inline $x^2$ and a display equation:

$$
E = mc^2
$$

\`\`\`ts title="example.ts"
const answer = 42
\`\`\`

![Test avatar](../../../assets/avatar.png)

A footnote[^1].

[^1]: Footnote content.
`
  const cmsPost = emptyPayload('post')
  Object.assign(cmsPost,{slug:'migration-cms',publishDate:'2026-10-18',cover:'/media/90000000-0000-4000-8000-000000000001.webp',coverAlt:'CMS cover'})
  cmsPost.zh={title:'后台生成验收',description:'CMS Markdown output',body:body+'\n<script data-cms-unsafe>bad()</script>\n'}
  cmsPost.en={title:'CMS publishing check',description:'CMS Markdown output',body:body}
  const seed=JSON.parse(await readFile(join(root,'src/data/cms-published.json'),'utf8'))
  const cmsFiles=publicFiles([...seed.documents,{id:'90000000-0000-4000-8000-000000000001',kind:'post',revision:1,payload:cmsPost}],'fixture')
  const fixtures = [
    [join(directories[0],'index.mdx'),article('迁移验收文章') + body + '\n<span data-migration-inline="yes">MDX component</span>\n'],
    [join(directories[0],'index-en.mdx'),article('Migration verification') + body],
    [join(directories[1],'index.md'),article('中文回退验收') + body],
    [join(directories[2],'index.md'),article('NEVER_PUBLISH_MIGRATION_DRAFT','draft: true\n') + body],
    [collection,'---\ntitle: 迁移验收合集\ntitle_en: Migration collection\nbloglist: [migration-check, migration-fallback]\n---\n'],
    ...[...cmsFiles].filter(([p])=>p.startsWith('src/content/blogs/migration-cms/')).map(([p,c])=>[join(root,p),c])
  ]
  for (const [filename, contents] of fixtures) {
    try { await access(filename); throw new Error(`Refusing to overwrite ${filename}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await writeFile(filename, contents, {flag:'wx'})
    createdFiles.push(filename)
  }
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath,[astroCli,'build','--outDir',output],{cwd:root,stdio:'inherit'})
    child.on('error',reject); child.on('close',done)
  })
  assert.equal(code,0,'Fixture build must succeed')
  for (const locale of ['', 'en/']) {
    const cmsHTML=parse(await readFile(join(output,locale,'blog/migration-cms/index.html'),'utf8'))
    assert.ok(cmsHTML.querySelector('.katex'),'CMS formulas render after publishing')
    assert.ok(cmsHTML.querySelector('table'),'CMS tables render after publishing')
    assert.ok(cmsHTML.querySelector('img[src="/media/90000000-0000-4000-8000-000000000001.webp"]'),'CMS public cover paths survive')
    assert.equal(cmsHTML.querySelector('script[data-cms-unsafe]'),null,'Raw HTML never executes in CMS posts')
    const html = await readFile(join(output,locale,'blog/migration-check/index.html'),'utf8')
    const doc = parse(html)
    assert.ok(doc.querySelector('.katex'),'Math survives the migration')
    assert.ok(doc.querySelector('table'),'GFM tables survive the migration')
    assert.ok(doc.querySelector('input[type="checkbox"]'),'GFM tasks survive the migration')
    assert.ok(doc.querySelector('img.zoomable'),'Image zoom plugin survives the migration')
    assert.ok(doc.querySelector('.astro-code'),'Shiki code highlighting survives the migration')
    const external = doc.querySelector('a[href="https://example.org/"]')
    assert.equal(external.getAttribute('target'),'_blank')
    assert.match(external.getAttribute('rel'),/noopener/)
    assert.ok(doc.querySelector('a[href="#test-heading"]'),'Heading anchors survive the migration')
    assert.match(doc.textContent,/Footnote content/)
    if (!locale) assert.ok(doc.querySelector('[data-migration-inline="yes"]'))
    const list = await readFile(join(output,locale,'blog/all/index.html'),'utf8')
    assert.doesNotMatch(list,/NEVER_PUBLISH_MIGRATION_DRAFT/)
    const fallback = await readFile(join(output,locale,'blog/migration-fallback/index.html'),'utf8')
    assert.match(fallback,/中文回退验收/)
    const collectionHtml = await readFile(join(output,locale,'collection/migration-check/index.html'),'utf8')
    assert.match(collectionHtml,/migration-fallback/)
  }
  assert.match(await readFile(join(output,'rss.xml'),'utf8'),/迁移验收文章/)
  assert.doesNotMatch(await readFile(join(output,'rss.xml'),'utf8'),/NEVER_PUBLISH_MIGRATION_DRAFT/)
  console.log('PASS: bilingual Markdown/MDX, fallback, drafts, images, math, tables, code, footnotes, collections and RSS.')
} finally {
  for (const file of createdFiles.reverse()) await unlink(file)
  for (const dir of createdDirectories.reverse()) await rmdir(dir)
}

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {unlink,mkdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {generateToc} from '../src/plugins/toc.ts'
import {sortPosts,tagUrl,tagSegment} from '../src/lib/blog-presentation.ts'
await mkdir('work',{recursive:true});const path='work/presentation-'+randomUUID()+'.mjs'
await build({entryPoints:['src/lib/page-presentation.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:path})
const p=await import(pathToFileURL(process.cwd()+'/'+path));await unlink(path)
test('activity sorting compares actual dates, not whether updatedDate exists, with deterministic ties',()=>{
 const posts=[{id:'old',data:{publishDate:'2025-01-01',updatedDate:'2025-02-01'}},{id:'b',data:{publishDate:'2026-01-01'}},{id:'a',data:{publishDate:'2026-01-01'}},{id:'updated',data:{publishDate:'2024-01-01',updatedDate:'2026-02-01'}}]
 assert.deepEqual(sortPosts(posts).map(p=>p.id),['updated','a','b','old']);assert.equal(posts[0].id,'old')
})
test('special tags have unique filesystem-safe URLs in both languages',()=>{
 const tags=['c++','c#','a/b','a?b','100%','深度 学习','a b','con','a:b','a*','end.','~612f62','..','a\\b']
 assert.equal(new Set(tags.map(tagSegment)).size,tags.length)
 for(const t of tags){assert.ok(!/[/?#%\\]/.test(tagSegment(t)));assert.equal(decodeURIComponent(tagUrl(t,true).slice('/en/tags/'.length)),tagSegment(t))}
 assert.equal(tagUrl('c++'),'/tags/c%2B%2B')
})
test('article header distinguishes publication and update, escapes content and makes fallback explicit',()=>{
 const html=p.renderArticleHeader({title:'<script>x</script>',publishDate:'2025-01-01',updatedDate:'2026-01-01',tags:['c++']},{en:true,fallback:true,minutes:'2 min read'})
 assert.match(html,/Published/);assert.match(html,/Updated/);assert.match(html,/data-language-fallback/);assert.doesNotMatch(html,/<script>/);assert.match(html,/c%2B%2B/)
 assert.doesNotMatch(p.renderArticleHeader({title:'test',publishDate:'2026-01-01',updatedDate:'2025-01-01'},{en:true}),/Updated/)
 for(const url of ['javascript:alert(1)','//evil.example','/\\evil.example','https:\n//evil.example'])assert.equal(p.safeDisplayUrl(url),'')
})
test('academic years descend, same-year order is preserved, cards expose complete editable fields',()=>{
 const pub={title:'Private fixture',venue:'Test venue',year:'2026',type:'conference',status:'accepted',authors:[{name:'Example',isMe:true,isEqual:true,role:'corresponding'}],abstract:'Fixture only',image:'/media/fixture.webp',imageAlt:'Diagram',links:[{type:'pdf',label:'Read paper',href:'https://example.com/paper'}]}
 const groups=p.groupAcademicYears([{...pub,year:'2024'},{...pub,title:'first'},{...pub,title:'second'}]);assert.deepEqual(groups.map(g=>g[0]),['2026','2024']);assert.deepEqual(groups[0][1].map(x=>x.title),['first','second'])
 const html=p.renderPublication(pub,true);for(const text of ['Diagram','Read paper','Equal contribution','Corresponding author','Test venue','accepted'])assert.ok(html.includes(text))
 const empty=p.renderAcademic({background:'Hello',interests:[],publications:[],projects:[]},true);assert.match(empty,/No publications/);assert.match(empty,/No projects/)
})

test('TOC tolerates orphan and skipped heading levels without losing order',()=>{
 const tree=generateToc([3,5,4,2,4,3,2].map((depth,i)=>({depth,slug:String(i),text:'Heading '+i})))
 assert.deepEqual(tree.map(h=>h.slug),['0','3','6'])
 assert.deepEqual(tree[0].subheadings.map(h=>h.slug),['1','2'])
 assert.deepEqual(tree[1].subheadings.map(h=>h.slug),['4','5'])
})

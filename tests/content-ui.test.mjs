import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
import * as git from '../supabase/functions/_shared/git-content.ts'
import * as markdown from '../src/lib/article-markdown.ts'
import * as fields from '../src/lib/content-fields.ts'
const source=(await readFile('src/lib/content-editor.ts','utf8')).replaceAll('import.meta.env.PUBLIC_SUPABASE_URL',"'https://fixture.invalid'").replaceAll('import.meta.env.PUBLIC_SUPABASE_ANON_KEY',"'fixture-public'")
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const localModule={exports:{}}
Function('module','exports','require',ts.transpileModule(await readFile('src/lib/content-local.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(localModule,localModule.exports,()=>git)
const profile=await readFile('src/data/profile.json','utf8'),academic=await readFile('src/data/academic.json','utf8'),friends=await readFile('public/links.json','utf8')
const markup='<content-editor><p data-message></p><p data-gate></p><div data-shell hidden><nav>'+[['profile','首页与关于'],['blog','博客'],['academic','学术与项目'],['friend','友链'],['media','图片']].map(([k,n])=>'<button data-kind="'+k+'">'+n+'</button>').join('')+'</nav><div data-category-tools hidden><button data-back-blog>博客目录</button><span data-category-name></span><button data-create>新建文章</button><button data-create-collection>新建合集</button></div><button data-refresh>刷新</button><button data-review>发布</button><button data-recover>恢复本地副本</button><button data-export>导出</button><button data-import-trigger>从文件恢复</button><input data-import type=file><div data-search-box><button data-search-toggle>查找内容</button><input data-search><button data-search-clear>清空查找</button></div><div class="cms-workspace"><aside class="cms-sidebar"><div data-list></div></aside><div data-editor></div></div><div data-submission></div><p data-save></p></div><dialog><form method=dialog><button>关闭</button></form><div data-dialog></div></dialog></content-editor>'

const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();await new Promise(setImmediate)}
async function setup(t,{role='owner',saved=new Map()}={}){
 const dom=new JSDOM(markup,{url:'https://fixture.invalid/admin',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close())
 w.structuredClone=structuredClone;w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{}
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))}
 const files=new Map([[git.PROFILE,profile],[git.ACADEMIC,academic],[git.LINKS,friends]].map(([path,content])=>[path,{path,content,sha:'a'.repeat(40),encoding:'utf-8'}]))
 const calls=[];let override
 class MemoryStore{static async open(){return new MemoryStore()}async save(s){saved.set(s.id,structuredClone(s))}async list(){return [...saved.values()].filter(s=>s.owner==='owner')}async remove(id){saved.delete(id)}close(){}}
 const markCommitted=(files,sub,result)=>files.filter(f=>!sub.changes.some(c=>c.path===f.path&&sub.revisions[f.path]===f.revision&&c.content===f.content)).map(f=>{const sent=sub.changes.find(c=>c.path===f.path);return sent?{...f,baseSha:result.find(r=>r.path===f.path).sha,baseText:sent.content}:f})
 const client={auth:{getSession:async()=>({data:{session:role==='guest'?null:{user:{id:role},access_token:'fixture'}}})}}
 w.fetch=async(url,options)=>{
   const input=JSON.parse(options.body);calls.push(structuredClone(input))
   if(role!=='owner')return {ok:false,status:403,json:async()=>({error:'Owner access required'})}
   if(override){const value=await override(input);if(value)return value}
   let result
   if(input.action==='list')result={owner:'owner',localKey:'fixture',repository:git.REPOSITORY,head:'b'.repeat(40),entries:[...files.values()].map(f=>({path:f.path,sha:f.sha,size:f.content.length,kind:git.pathKind(f.path),writable:true}))}
   else if(input.action==='read')result={head:'b'.repeat(40),files:input.paths.map(p=>files.get(p)||{path:p,sha:null,content:null})}
   else if(input.action==='publish'){result={state:'committed',commitSha:'c'.repeat(40),files:input.changes.map(c=>({path:c.path,sha:c.content===null?null:'d'.repeat(40)}))};for(const c of input.changes){if(c.content===null)files.delete(c.path);else files.set(c.path,{...c,sha:'d'.repeat(40)})}}
   else if(input.action==='status')result={state:'live'}
   else if(input.action==='references')result={references:[]}
   else throw Error('Unknown action '+input.action)
   return {ok:true,json:async()=>result}
 }
 w.require=name=>{
   if(name==='./comment-auth')return {getCommentClient:()=>client,COMMENT_AUTH_EVENT:'auth-change'}
   if(name==='./article-markdown')return markdown
   if(name==='./content-render')return {enhanceArticle:async()=>{}}
   if(name==='./content-local')return {...localModule.exports,LocalContentStore:MemoryStore,markCommitted}
   if(name==='./content-fields')return fields
   if(name==='./cms-image')return {encodeCMSImage:()=>{throw Error('Browser codec acceptance required')}}
   if(name.includes('_shared/git-content'))return git
   throw Error(name)
 };w.module={exports:{}};w.exports=w.module.exports;w.eval(code);w.module.exports.installContentEditor();await tick()
 const root=w.document.querySelector('content-editor'),find=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text&&!b.closest('[hidden]')&&(!b.closest('dialog')||b.closest('dialog').open))
 const click=async text=>{const b=find(text);assert.ok(b,'button '+text);b.click();await tick()}
 const fill=(name,value)=>{const i=root.querySelector('[name="'+name+'"]');assert.ok(i,'input '+name);i.value=value;i.dispatchEvent(new w.Event('input',{bubbles:true}))}
 const open=async kind=>{await click(kind);await tick()}
 return {w,root,files,calls,saved,click,find,fill,open,override:fn=>override=fn,role:value=>{role=value;w.dispatchEvent(new w.Event('auth-change'))}}
}
test('guest and normal account cannot load private editor content',async t=>{
 for(const role of ['guest','member']){const ui=await setup(t,{role});assert.equal(ui.root.querySelector('[data-shell]').hidden,true);assert.ok(!ui.calls.some(c=>c.action==='read'));assert.equal(ui.root.querySelector('[data-editor]').textContent,'')}
})
test('owner edits canonical profile locally without any publish or server draft writes',async t=>{
 const ui=await setup(t);await ui.open('首页与关于');ui.fill('zh.intro','Local only');await tick();assert.equal(JSON.parse(ui.files.get(git.PROFILE).content).zh.intro,JSON.parse(profile).zh.intro);assert.ok([...ui.saved.values()].some(s=>s.files.some(f=>f.content.includes('Local only'))));assert.ok(!ui.calls.some(c=>c.action==='publish'))
})
test('selected changes publish once, keep newer typing, and exclude another changed file',async t=>{
 const ui=await setup(t);await ui.open('首页与关于');ui.fill('zh.intro','First');await ui.open('学术与项目')
 const md=ui.root.querySelector('[aria-label="Markdown 正文"]');md.value='Unselected academic';md.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await ui.open('首页与关于')
 let finish;ui.override(input=>input.action==='publish'?new Promise(r=>finish=r):null)
 ui.root.querySelector('[data-review]').click();await tick();const rows=[...ui.root.querySelectorAll('.cms-review-row')];const academicRow=rows.find(r=>r.textContent.includes(git.ACADEMIC));academicRow.querySelector('input').click()
 await ui.click('提交所选修改');ui.fill('zh.intro','Second');await tick();assert.equal(ui.calls.filter(c=>c.action==='publish').length,1);assert.deepEqual(ui.calls.find(c=>c.action==='publish').changes.map(c=>c.path),[git.PROFILE])
 finish({ok:true,json:async()=>({state:'committed',commitSha:'c'.repeat(40),files:[{path:git.PROFILE,sha:'d'.repeat(40)}]})});await tick()
 const latest=[...ui.saved.values()].at(-1);assert.ok(latest.files.find(f=>f.path===git.PROFILE).content.includes('Second'));assert.ok(latest.files.some(f=>f.path===git.ACADEMIC));assert.match(ui.root.querySelector('[data-submission]').textContent,/已发布上线/)
})
test('failed request retains edits and retries the exact idempotency key',async t=>{
 const ui=await setup(t);await ui.open('首页与关于');ui.fill('zh.intro','Keep me');let count=0
 ui.override(input=>input.action==='publish'&&count++===0?{ok:false,status:400,json:async()=>({error:'network interrupted'})}:null)
 ui.root.querySelector('[data-review]').click();await tick();await ui.click('提交所选修改');assert.match(ui.root.querySelector('[data-submission]').textContent,/失败/)
 await ui.click('安全重试同一提交');const calls=ui.calls.filter(c=>c.action==='publish');assert.equal(calls[0].requestId,calls[1].requestId);assert.deepEqual(calls[0].changes,calls[1].changes)
})
test('sign-out clears forms and a late request cannot reveal private editor content',async t=>{
 const ui=await setup(t);await ui.open('首页与关于');ui.fill('zh.intro','Private text');ui.role('guest');await tick();assert.equal(ui.root.querySelector('[data-shell]').hidden,true);assert.equal(ui.root.querySelector('[data-editor]').textContent,'');assert.ok(!ui.root.textContent.includes('Private text'))
})
test('local recovery creates an independent tab copy and preserves the old one',async t=>{
 const saved=new Map(),a=await setup(t,{saved});await a.open('首页与关于');a.fill('zh.intro','Restore this');await tick();const first=[...saved.keys()][0]
 const b=await setup(t,{saved});await b.click('恢复本地副本');await b.click('恢复此副本');assert.equal(b.root.querySelector('[name="zh.intro"]').value,'Restore this');assert.ok(saved.has(first));assert.equal(saved.size,2)
})
test('Markdown toolbar uses the selection and previews math without scripts',async t=>{
 const ui=await setup(t);await ui.open('学术与项目');const area=ui.root.querySelector('[aria-label="Markdown 正文"]');area.value='hello';area.setSelectionRange(0,5);await ui.click('B');assert.equal(area.value,'**hello**')
 area.value='$$\nx^2\n$$\n\n<script>bad()</script>';area.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,210));assert.ok(ui.root.querySelector('.cms-md-preview .katex'));assert.equal(ui.root.querySelector('.cms-md-preview script'),null)
})

test('blog folders contain articles and collections and creation is local with no language selector',async t=>{
 const ui=await setup(t);await ui.click('博客')
 assert.equal(ui.root.querySelectorAll('.cms-folder').length,3)
 ui.root.querySelectorAll('.cms-folder')[1].click();await tick();await ui.click('新建文章')
 assert.equal(ui.root.querySelector('dialog select'),null)
 const input=ui.root.querySelector('dialog input');input.value='nested-test';await ui.click('建立本地副本')
 assert.ok([...ui.saved.values()].some(s=>s.files.some(f=>f.path==='src/content/blogs/tech/nested-test/index.md')))
 await ui.click('编辑英文版');assert.ok([...ui.saved.values()].some(s=>s.files.some(f=>f.path==='src/content/blogs/tech/nested-test/index-en.md')))
 await ui.click('新建合集');ui.root.querySelector('dialog input').value='reading-list';await ui.click('建立本地副本')
 assert.ok([...ui.saved.values()].some(s=>s.files.some(f=>f.path==='src/content/collection/tech/reading-list/index.md')))
 const search=ui.root.querySelector('[data-search]');search.value='reading-list';search.dispatchEvent(new ui.w.Event('input'))
 assert.equal(ui.root.querySelectorAll('[data-list] button').length,1)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})



test('discard deletes the current local file and removes an empty stored workspace',async t=>{
 const ui=await setup(t);await ui.open('首页与关于');ui.fill('zh.intro','Discard test');await tick()
 assert.equal(ui.saved.size,1)
 await ui.click('放弃本地修改');await ui.click('确认');await tick()
 assert.equal(ui.saved.size,0)
 assert.equal(ui.root.querySelector('[name="zh.intro"]').value,JSON.parse(profile).zh.intro)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('discard automatically collects attached new uploads but keeps unrelated library uploads',async t=>{
 const ui=await setup(t),attached='public/media/attached.webp',unrelated='public/media/unrelated.webp'
 ui.root.edit(attached,'aW1hZ2U=','base64');ui.root.edit(unrelated,'aW1hZ2U=','base64')
 ui.fill('photo','/media/attached.webp');await tick()
 assert.ok(ui.root.space.files.find(f=>f.path===attached).mediaOwners.includes(git.PROFILE))
 await ui.click('放弃本地修改');await ui.click('确认');await tick()
 assert.deepEqual([...ui.saved.values()][0].files.map(f=>f.path),[unrelated])
 assert.match(ui.root.querySelector('[data-message]').textContent,/自动清理 1 张/)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('discard leaves another tab copy and shared images intact',async t=>{
 const saved=new Map(),a=await setup(t,{saved}),image='public/media/shared.webp'
 a.root.edit(image,'aW1hZ2U=','base64');a.fill('photo','/media/shared.webp');await tick()
 const b=await setup(t,{saved});await b.click('恢复本地副本');await b.click('恢复此副本');await b.open('首页与关于')
 const before=structuredClone(a.root.space)
 await b.click('放弃本地修改');await b.click('确认');await tick()
 assert.equal(b.root.space.files.length,0);assert.deepEqual(saved.get(a.root.space.id),before)
 assert.equal(a.root.querySelector('[name="photo"]').value,'/media/shared.webp')
})

test('typing during the asynchronous reference check cannot be erased by discard',async t=>{
 const ui=await setup(t);ui.fill('zh.intro','First');await tick();let release
 ui.root.store.list=()=>new Promise(resolve=>release=resolve)
 await ui.click('放弃本地修改');ui.find('确认').click();await tick()
 ui.fill('zh.intro','New typing');release([]);await tick()
 assert.ok(ui.root.space.files[0].content.includes('New typing'));assert.match(ui.root.querySelector('[data-message]').textContent,/刚刚发生变化/)
})

test('failed local deletion never reports successful automatic cleanup',async t=>{
 const ui=await setup(t);ui.fill('zh.intro','Preserved on disk');await tick()
 ui.root.store.remove=async()=>{throw Error('IndexedDB unavailable')}
 await ui.click('放弃本地修改');await ui.click('确认');await tick()
 assert.equal(ui.saved.size,1);assert.match(ui.root.querySelector('[data-message]').textContent,/存储已满或不可用/)
 assert.equal(ui.root.querySelector('[data-message]').textContent.includes('自动清理'),false)
})

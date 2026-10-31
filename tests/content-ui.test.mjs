import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
import * as git from '../supabase/functions/_shared/git-content.ts'
import * as markdown from '../src/lib/article-markdown.ts'
import * as fields from '../src/lib/content-fields.ts'
import * as blog from '../src/lib/blog-presentation.ts'
const source=(await readFile('src/lib/content-editor.ts','utf8')).replaceAll('import.meta.env.PUBLIC_SUPABASE_URL',"'https://fixture.invalid'").replaceAll('import.meta.env.PUBLIC_SUPABASE_ANON_KEY',"'fixture-public'")
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const localModule={exports:{}}
Function('module','exports','require',ts.transpileModule(await readFile('src/lib/content-local.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(localModule,localModule.exports,()=>git)
const profile=await readFile('src/data/profile.json','utf8'),academic=await readFile('src/data/academic.json','utf8'),friends=await readFile('public/links.json','utf8')
const markup='<content-editor><p data-message></p><p data-gate></p><div data-shell hidden><nav>'+[['profile','首页与关于'],['blog','博客'],['academic','学术与项目'],['friend','友链'],['media','图片']].map(([k,n])=>'<button data-kind="'+k+'">'+n+'</button>').join('')+'</nav><div data-category-tools hidden><button data-back-blog>博客目录</button><span data-category-name></span><button data-create>新建文章</button><button data-create-collection>新建合集</button></div><button data-refresh>刷新</button><button data-review>发布</button><button data-recover>恢复本地副本</button><button data-export>导出</button><button data-import-trigger>从文件恢复</button><input data-import type=file><div data-search-box><button data-search-toggle>查找内容</button><input data-search><button data-search-clear>清空查找</button></div><div class="cms-workspace"><aside class="cms-sidebar"><div data-list></div></aside><div data-editor></div></div><div data-submission></div><p data-save></p></div><dialog><form method=dialog><button>关闭</button></form><div data-dialog></div></dialog></content-editor>'

const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();await new Promise(setImmediate)}
async function setup(t,{role='owner',saved=new Map(),locks,initialStatus='live',saveHook=async()=>{}}={}){
 const dom=new JSDOM(markup,{url:'https://fixture.invalid/admin',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close())
 w.structuredClone=structuredClone;w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{}
 if(locks)Object.defineProperty(w.navigator,'locks',{value:locks})
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))}
 const files=new Map([[git.PROFILE,profile],[git.ACADEMIC,academic],[git.LINKS,friends]].map(([path,content])=>[path,{path,content,sha:'a'.repeat(40),encoding:'utf-8'}]))
 const calls=[];let override
 class MemoryStore{static async open(){return new MemoryStore()}async save(s){await saveHook(s);saved.set(s.id,structuredClone(s))}async list(){return [...saved.values()].filter(s=>s.owner==='owner').map(s=>structuredClone(s))}async remove(id){saved.delete(id)}async removeIfUnchanged(s){if(JSON.stringify(saved.get(s.id))!==JSON.stringify(s))return false;saved.delete(s.id);return true}close(){}}
 const markCommitted=(files,sub,result)=>files.filter(f=>!sub.changes.some(c=>c.path===f.path&&sub.revisions[f.path]===f.revision&&c.content===f.content)).map(f=>{const sent=sub.changes.find(c=>c.path===f.path);return sent?{...f,baseSha:result.find(r=>r.path===f.path).sha,baseText:sent.content}:f})
 const client={auth:{getSession:async()=>({data:{session:role==='guest'?null:{user:{id:role},access_token:'fixture'}}})}}
 w.fetch=async(url,options)=>{
   const input=options.method==='HEAD'?{action:'image-head',url}:JSON.parse(options.body);calls.push(structuredClone(input))
   if(role!=='owner')return {ok:false,status:403,json:async()=>({error:'Owner access required'})}
   if(override){const value=await override(input);if(value)return value}
   let result
   if(input.action==='image-head')return {ok:true,headers:{get:()=> 'image/webp'}}
   if(input.action==='list')result={owner:'owner',localKey:'fixture',repository:git.REPOSITORY,head:'b'.repeat(40),entries:[...files.values()].map(f=>({path:f.path,sha:f.sha,size:f.content.length,kind:git.pathKind(f.path),writable:true}))}
   else if(input.action==='read')result={head:'b'.repeat(40),files:input.paths.map(p=>files.get(p)||{path:p,sha:null,content:null})}
   else if(input.action==='publish'){result={state:'committed',commitSha:'c'.repeat(40),files:input.changes.map(c=>({path:c.path,sha:c.content===null?null:'d'.repeat(40)}))};for(const c of input.changes){if(c.content===null)files.delete(c.path);else files.set(c.path,{...c,sha:'d'.repeat(40)})}}
   else if(input.action==='status')result={state:initialStatus}
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
   if(name==='./blog-presentation')return blog
   if(name==='./cms-image')return {encodeCMSImage:()=>{throw Error('Browser codec acceptance required')}}
   if(name.includes('_shared/git-content'))return git
   throw Error(name)
 };w.module={exports:{}};w.exports=w.module.exports;w.eval(code);w.module.exports.installContentEditor();await tick()
 const root=w.document.querySelector('content-editor'),find=text=>[...root.querySelectorAll('button')].find(b=>(b.textContent===text||b.textContent.startsWith(text+' ('))&&!b.closest('[hidden]')&&(!b.closest('dialog')||b.closest('dialog').open))
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

test('collection picker selects, reorders and removes membership without deleting articles',async t=>{
 const ui=await setup(t);await ui.click('博客');ui.root.querySelectorAll('.cms-folder')[1].click();await tick()
 for(const name of ['first','second']){await ui.click('新建文章');ui.root.querySelector('dialog input').value=name;await ui.click('建立本地副本');ui.fill('title',name)}
 await ui.click('新建合集');ui.root.querySelector('dialog input').value='series';await ui.click('建立本地副本')
 const picker=ui.root.querySelector('.cms-collection-picker');for(let i=0;i<2;i++){picker.querySelectorAll('label')[i].querySelector('input').click();await tick()}
 const before=picker.querySelectorAll('ol li')[1].querySelector('span').textContent;picker.querySelectorAll('ol li')[1].querySelector('button').click();await tick();assert.equal(picker.querySelectorAll('ol li')[0].querySelector('span').textContent,before)
 picker.querySelector('ol li').querySelectorAll('button')[2].click();await tick()
 const files=[...ui.saved.values()].at(-1).files;assert.equal(files.filter(f=>git.pathKind(f.path)==='post').length,2);assert.equal(git.readArticle(files.find(f=>git.pathKind(f.path)==='collection').content).data.bloglist.length,1)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

async function createPreviewDocument(ui,name,kind='post'){
 if(ui.root.querySelector('[data-category-tools]').hidden){await ui.click('博客');ui.root.querySelectorAll('.cms-folder')[1].click();await tick()}
 await ui.click(kind==='collection'?'新建合集':'新建文章')
 ui.root.querySelector('dialog input').value=name;await ui.click('建立本地副本')
 return ui.root.querySelector('[data-editor] iframe')
}
const previewTick=async()=>{await new Promise(r=>setTimeout(r,220));await tick()}
function observePreview(ui,frame){
 assert.ok(frame,'article preview is immediately available in the editor')
 const messages=[],peer=frame.contentWindow
 peer.postMessage=(payload,origin)=>messages.push({payload:structuredClone(payload),origin})
 const signal=(type,options={})=>ui.w.dispatchEvent(new ui.w.MessageEvent('message',{data:{type},origin:ui.w.location.origin,source:peer,...options}))
 return {messages,signal,latest:()=>messages.at(-1)?.payload}
}

test('new article shows a private whole-article preview and accepts only its own frame handshake',async t=>{
 const ui=await setup(t),frame=await createPreviewDocument(ui,'whole-article'),preview=observePreview(ui,frame)
 assert.equal(frame.getAttribute('src'),'/admin/preview/')
 assert.equal(frame.title,'当前文章整体预览')
 assert.equal(frame.style.visibility,'hidden')
 preview.signal('cyril-preview-ready',{origin:'https://other.invalid'});preview.signal('cyril-preview-ready',{source:ui.w});await tick()
 assert.equal(preview.messages.length,0)
 preview.signal('cyril-preview-ready');await tick()
 assert.equal(preview.latest().kind,'post');assert.equal(preview.latest().compact,true)
 assert.equal(preview.latest().url,'https://cyril-fan.top/blog/tech/whole-article')
 assert.equal(preview.messages.at(-1).origin,ui.w.location.origin)
 assert.equal(preview.latest().data.title,ui.root.querySelector('[name="title"]').value)
 const status=frame.parentElement.querySelector('[role="status"]')
 preview.signal('cyril-preview-rendered',{source:ui.w});assert.equal(status.hidden,false);assert.equal(frame.style.visibility,'hidden')
 preview.signal('cyril-preview-rendered');assert.equal(status.hidden,true);assert.equal(frame.style.visibility,'visible')
 ui.fill('title','Retain my draft');const area=ui.root.querySelector('[aria-label="Markdown 正文"]');area.value='Unpublished text stays local';area.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await tick()
 const savedBeforeError=JSON.stringify([...ui.saved.values()])
 preview.signal('cyril-preview-error',{origin:'https://other.invalid'});preview.signal('cyril-preview-error',{source:ui.w});assert.equal(status.hidden,true)
 preview.signal('cyril-preview-error');assert.equal(status.hidden,false);assert.match(status.textContent,/文章暂时无法渲染，编辑内容已保留/)
 assert.equal(ui.root.querySelector('[name="title"]').value,'Retain my draft');assert.equal(area.value,'Unpublished text stays local');assert.equal(JSON.stringify([...ui.saved.values()]),savedBeforeError)
 assert.ok(!ui.files.has('src/content/blogs/tech/whole-article/index.md'))
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('whole-article preview tracks current metadata, body, theme and English fallback without publishing',async t=>{
 const ui=await setup(t),frame=await createPreviewDocument(ui,'live-edit'),preview=observePreview(ui,frame)
 preview.signal('cyril-preview-ready');await tick()
 ui.fill('title','Current title');ui.fill('description','Current description');ui.fill('tags','C++, Deep Learning, c++');ui.fill('publishDate','2026-02-03');ui.fill('updatedDate','2026-04-05')
 const area=ui.root.querySelector('[aria-label="Markdown 正文"]');area.value='## Local heading\n\nCurrent article body with $x^2$.';area.dispatchEvent(new ui.w.Event('input',{bubbles:true}))
 ui.w.document.documentElement.classList.add('dark');await previewTick()
 const sent=preview.latest();assert.equal(sent.data.title,'Current title');assert.equal(sent.data.description,'Current description');assert.deepEqual(sent.data.tags,['c++','deep learning'])
 assert.equal(sent.data.publishDate,'2026-02-03');assert.equal(sent.data.updatedDate,'2026-04-05');assert.equal(sent.body,area.value);assert.equal(sent.dark,true)
 const language=frame.parentElement.querySelector('select');language.value='en';language.dispatchEvent(new ui.w.Event('change'))
 assert.equal(frame.getAttribute('src'),'/en/admin/preview/')
 const english=observePreview(ui,frame);english.signal('cyril-preview-ready');await tick()
 assert.equal(english.latest().en,true);assert.equal(english.latest().fallback,true);assert.equal(english.latest().data.title,'Current title')
 assert.equal(english.latest().url,'https://cyril-fan.top/en/blog/tech/live-edit')
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('clearing an existing cover and optional article fields removes their YAML keys and preserves unrelated content',async t=>{
 const ui=await setup(t),path='src/content/blogs/tech/cover-clear/index.md'
 const original='---\ntitle: Original title\ndescription: Original description\npublishDate: 2026-02-03\nupdatedDate: 2026-03-04\ncategory: tech\ntags: [cpp]\nheroImage:\n  src: /avatar/avatar.png\n  alt: Preview image\n  width: 800\nsource: https://example.com/source\npixivLink: "12345"\ncustomField: Preserve this\ncomment: true\n---\n## Original body\n\nKeep this text.\n'
 ui.files.set(path,{path,sha:'a'.repeat(40),content:original,encoding:'utf-8'});await ui.click('刷新');await ui.click('博客');ui.root.querySelectorAll('.cms-folder')[1].click();await tick();ui.root.querySelector('[data-list] button').click();await tick()
 ui.fill('title','Updated title');ui.fill('description','Updated description');await ui.click('清除');await tick()
 assert.equal(ui.root.querySelector('[name="heroImage.src"]').value,'')
 ui.fill('source','');ui.fill('updatedDate','');ui.fill('pixivLink','');await tick();await ui.click('编辑原文件')
 const edited=git.readArticle(ui.root.querySelector('.cms-source').value)
 for(const key of ['heroImage','source','updatedDate','pixivLink'])assert.equal(Object.hasOwn(edited.data,key),false,key+' is removed from YAML')
 assert.equal(edited.data.title,'Updated title');assert.equal(edited.data.description,'Updated description');assert.equal(edited.data.customField,'Preserve this');assert.equal(edited.data.publishDate,'2026-02-03');assert.deepEqual(edited.data.tags,['cpp']);assert.equal(edited.data.comment,true);assert.equal(edited.body,git.readArticle(original).body)
 assert.equal(ui.files.get(path).content,original);assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('new collection preview reflects selected article order and removals as well as its own text',async t=>{
 const ui=await setup(t)
 for(const name of ['one','two']){await createPreviewDocument(ui,name);ui.fill('title','Article '+name)}
 const frame=await createPreviewDocument(ui,'reading-order','collection'),preview=observePreview(ui,frame)
 preview.signal('cyril-preview-ready');await tick();assert.equal(preview.latest().kind,'collection');assert.deepEqual(preview.latest().collectionPosts,[])
 const picker=ui.root.querySelector('.cms-collection-picker')
 for(let i=0;i<2;i++){picker.querySelectorAll('label')[i].querySelector('input').click();await tick()}
 picker.querySelectorAll('ol li')[1].querySelector('button').click();await tick()
 ui.fill('title','A useful collection');const area=ui.root.querySelector('[aria-label="Markdown 正文"]');area.value='Collection introduction';area.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await previewTick()
 assert.equal(preview.latest().data.title,'A useful collection');assert.equal(preview.latest().body,'Collection introduction')
 assert.deepEqual(preview.latest().collectionPosts.map(p=>p.title),[...picker.querySelectorAll('ol li>span')].map(s=>s.textContent))
 assert.ok(preview.latest().collectionPosts.every(p=>p.href.startsWith('/blog/tech/')))
 picker.querySelector('ol li').querySelectorAll('button')[2].click();await previewTick();assert.equal(preview.latest().collectionPosts.length,1)
 assert.equal([...ui.saved.values()].at(-1).files.filter(f=>git.pathKind(f.path)==='post').length,2)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('Academic retains its section Markdown preview without offering the article-page preview',async t=>{
 const ui=await setup(t);await ui.open('学术与项目')
 assert.equal(ui.find('全屏文章预览'),undefined);assert.equal(ui.root.querySelector('[data-editor] iframe'),null)
 assert.ok(ui.root.querySelector('[aria-label="实时预览"]'))
 const area=ui.root.querySelector('[aria-label="Markdown 正文"]');area.value='## Research note';area.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await previewTick()
 assert.match(ui.root.querySelector('[aria-label="实时预览"]').textContent,/Research note/)
})

test('closing full-screen preview stops its updates while inline preview stays live; switching sections stops the old frame',async t=>{
 const ui=await setup(t),inlineFrame=await createPreviewDocument(ui,'lifecycle'),inline=observePreview(ui,inlineFrame)
 inline.signal('cyril-preview-ready');await tick();await ui.click('全屏文章预览')
 const dialog=ui.root.querySelector('dialog'),fullFrame=dialog.querySelector('iframe'),full=observePreview(ui,fullFrame)
 full.signal('cyril-preview-ready');await tick();assert.equal(full.latest().compact,false)
 dialog.close();const fullCount=full.messages.length
 ui.fill('title','Edited after closing');full.signal('cyril-preview-ready');await previewTick()
 assert.equal(full.messages.length,fullCount);assert.equal(inline.latest().data.title,'Edited after closing')
 const inlineCount=inline.messages.length;await ui.open('友链');assert.equal(inlineFrame.isConnected,false)
 inline.signal('cyril-preview-ready');ui.w.document.documentElement.classList.toggle('dark');await previewTick();assert.equal(inline.messages.length,inlineCount)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('sign-out and editor removal tear down both article preview channels and private frame contents',async t=>{
 for(const teardown of ['sign-out','remove']){
  const ui=await setup(t),frame=await createPreviewDocument(ui,'private-preview'),inline=observePreview(ui,frame)
  ui.fill('title','Private working title');inline.signal('cyril-preview-ready');await tick();await ui.click('全屏文章预览')
  const fullFrame=ui.root.querySelector('dialog iframe'),full=observePreview(ui,fullFrame);full.signal('cyril-preview-ready');await tick()
  const inlineCount=inline.messages.length,fullCount=full.messages.length
  if(teardown==='sign-out'){ui.role('guest');await tick()}else ui.root.remove()
  assert.equal(ui.root.querySelectorAll('iframe').length,0);assert.ok(!ui.root.textContent.includes('Private working title'))
  inline.signal('cyril-preview-ready');full.signal('cyril-preview-ready');ui.w.document.documentElement.classList.toggle('dark');await previewTick()
  assert.equal(inline.messages.length,inlineCount);assert.equal(full.messages.length,fullCount)
 }
})

const testLocks=()=>{const held=new Set();return {held,async request(name,options,fn){if(typeof options==='function'){held.add(name);try{return await options({name})}finally{held.delete(name)}}return fn(held.has(name)?null:{name})}}}
const oldJob=id=>({id,owner:'owner',repository:git.REPOSITORY,updated:'2026-01-01T00:00:00Z',files:[],submission:{requestId:id,commitSha:'c'.repeat(40),state:'committed',changes:[],revisions:{}}})
test('entering editor reconciles confirmed deployment and refreshes restore list without restoring copies',async t=>{
 const saved=new Map([['original',oldJob('original')],['restored',oldJob('restored')]]),ui=await setup(t,{saved,locks:testLocks()});await tick()
 assert.equal(saved.size,0);assert.match(ui.root.querySelector('[data-message]').textContent,/已清理 2/);await ui.click('恢复本地副本');assert.match(ui.root.querySelector('[data-dialog]').textContent,/没有其它/)
})
test('build-in-progress and active tab jobs remain recoverable on entry',async t=>{
 const saved=new Map([['building',oldJob('building')]]),locks=testLocks();locks.held.add(localModule.exports.workspaceLock('owner','building'))
 const ui=await setup(t,{saved,locks});assert.equal(saved.size,1);assert.ok(!ui.calls.some(c=>c.action==='status'))
 locks.held.clear();const other=await setup(t,{saved,locks,initialStatus:'committed'});assert.equal(saved.size,1);assert.ok(other.calls.some(c=>c.action==='status'))
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

const recoverFixture=()=>({...oldJob('private-source'),submission:undefined,files:[{path:git.PROFILE,baseSha:'a'.repeat(40),baseText:profile,content:JSON.stringify({...JSON.parse(profile),email:'private@example.invalid'}),encoding:'utf-8',revision:1}]})
test('restore and import stop on either failed save and preserve the active editor and source copy',async t=>{
 for(const method of ['restore','import'])for(const phase of ['current','candidate']){
  const source=recoverFixture(),saved=new Map([[source.id,structuredClone(source)]]),ui=await setup(t,{saved})
  ui.fill('zh.intro','Keep current typing');await tick();const active=ui.root.space,save=ui.root.store.save.bind(ui.root.store)
  ui.root.store.save=async s=>{if(phase==='current'||s.id!==active.id)throw Error('Quota exceeded');await save(s)}
  ui.root.confirm=async()=>true
  if(method==='restore'){await ui.click('恢复本地副本');await ui.click('恢复此副本')}
  else await ui.root.importLocal({size:200,text:async()=>JSON.stringify({version:2,repository:git.REPOSITORY,workspace:source})})
  assert.equal(ui.root.space,active);assert.equal(ui.root.querySelector('[name="zh.intro"]').value,'Keep current typing')
  assert.deepEqual(saved.get(source.id),source);assert.match(ui.root.querySelector('[data-message]').textContent,/失败|存储/)
  assert.ok(!ui.root.querySelector('[data-message]').textContent.includes('已导入'));assert.ok(!ui.calls.some(c=>c.action==='publish'))
 }
})
test('typing while the recovered candidate is saved cancels the switch without losing either copy',async t=>{
 const ui=await setup(t);ui.fill('zh.intro','Before');await tick();const active=ui.root.space,save=ui.root.store.save.bind(ui.root.store);let finish
 ui.root.store.save=async s=>{if(s.id!==active.id)await new Promise(r=>finish=r);await save(s)}
 const switching=ui.root.switchLocalCopy(recoverFixture());await tick();ui.fill('zh.intro','Typed during save');finish();assert.equal(await switching,false);await tick()
 assert.equal(ui.root.space,active);assert.equal(ui.root.querySelector('[name="zh.intro"]').value,'Typed during save')
 assert.equal(ui.saved.size,2);assert.ok(ui.saved.get(active.id).files[0].content.includes('Typed during save'))
})

test('a restored edited copy shows its saved-local status instead of Matches GitHub',async t=>{
 const ui=await setup(t)
 assert.equal(await ui.root.switchLocalCopy(recoverFixture()),true)
 assert.match(ui.root.querySelector('[data-save]').textContent,/本地已暂存/)
 assert.equal(ui.root.querySelector('[data-review]').disabled,false)
})
test('published fingerprinted media uses the exact public blob; unpublished media falls back to GitHub',async t=>{
 const ui=await setup(t),path='public/media/image-'+ 'e'.repeat(20)+'.webp',url=git.publicImage(path)
 ui.files.set(path,{path,content:'aW1hZ2U=',sha:'e'.repeat(40),encoding:'base64'});await ui.root.refresh()
 let start=ui.calls.length
 assert.equal(await ui.root.imageUrl(url),url)
 assert.deepEqual(ui.calls.slice(start).map(c=>c.action),['image-head'])
 ui.override(input=>input.action==='image-head'?{ok:false,status:404,headers:{get:()=> 'text/html'}}:null)
 start=ui.calls.length;assert.equal(await ui.root.imageUrl(url),'blob:fixture')
 assert.deepEqual(ui.calls.slice(start).map(c=>c.action),['image-head','read'])
 ui.root.edit(path,null);start=ui.calls.length
 await assert.rejects(ui.root.imageUrl(url));assert.equal(ui.calls.length,start)
})

test('deletion staged during a public preview check cannot resurrect or fetch the image',async t=>{
 const ui=await setup(t),path='public/media/image-'+ 'e'.repeat(20)+'.webp'
 ui.files.set(path,{path,content:'aW1hZ2U=',sha:'e'.repeat(40),encoding:'base64'});await ui.root.refresh()
 let finish;ui.override(input=>input.action==='image-head'?new Promise(resolve=>finish=resolve):null)
 const pending=ui.root.imageUrl(git.publicImage(path));await tick();ui.root.edit(path,null)
 finish({ok:true,headers:{get:()=> 'image/webp'}})
 await assert.rejects(pending);assert.ok(!ui.calls.some(c=>c.action==='read'&&c.paths.includes(path)))
})

test('a slow image cannot delay other media cards or their controls',async t=>{
 const ui=await setup(t),paths=['slow','small','another','last'].map(name=>'public/media/'+name+'.webp')
 for(const path of paths)ui.files.set(path,{path,content:'aW1hZ2U=',sha:'e'.repeat(40),encoding:'base64'})
 await ui.root.refresh();let finish
 ui.override(input=>input.action==='read'&&input.paths[0]===paths[0]?new Promise(resolve=>finish=resolve):null)
 await ui.open('图片')
 const cards=[...ui.root.querySelectorAll('.cms-media-card')]
 assert.equal(cards.length,4);assert.equal(cards[0].querySelectorAll('button').length,3)
 assert.equal(cards[0].querySelector('img').getAttribute('src'),null)
 for(const card of cards.slice(1))assert.equal(card.querySelector('img').getAttribute('src'),'blob:fixture')
 finish({ok:false,status:503,json:async()=>({error:'isolated image unavailable'})});await tick()
 assert.equal(cards[0].querySelector('img').hidden,true)
 assert.match(cards[0].textContent,/暂时无法预览/)
 assert.ok(cards[0].querySelectorAll('button')[1].disabled===false)
 assert.ok(!ui.calls.some(c=>c.action==='publish'))
})

test('staged deletion and missing image blobs stop preview requests instead of recursing',async t=>{
 const ui=await setup(t),path='public/media/deleted.webp';ui.files.set(path,{path,content:'aW1hZ2U=',sha:'e'.repeat(40),encoding:'base64'});await ui.root.refresh()
 ui.root.edit(path,null);await tick();const before=ui.calls.length
 await assert.rejects(ui.root.imageUrl('/media/deleted.webp'));await assert.rejects(ui.root.imageUrl('/media/deleted.webp'))
 assert.equal(ui.calls.length,before)
 ui.root.space.files=[];ui.files.delete(path);ui.root.remote.delete(path)
 await assert.rejects(ui.root.imageUrl('/media/deleted.webp'));await assert.rejects(ui.root.imageUrl('/media/deleted.webp'))
 assert.equal(ui.calls.slice(before).filter(c=>c.action==='read').length,1)
})
test('deployment checks resume when returning online and do not erase newer edits',async t=>{
 const ui=await setup(t,{initialStatus:'committed'});ui.fill('zh.intro','First');await tick();ui.root.space.submission=oldJob('submitted').submission
 await ui.root.checkStatus();ui.fill('zh.intro','After commit');await tick()
 ui.override(input=>input.action==='status'?{ok:true,json:async()=>({state:'live'})}:null)
 ui.w.dispatchEvent(new ui.w.Event('online'));await tick()
 assert.match(ui.root.querySelector('[data-submission]').textContent,/已发布上线/)
 assert.ok(ui.root.space.files[0].content.includes('After commit'));assert.ok(ui.saved.get(ui.root.space.id).files.length)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
import * as cms from '../supabase/functions/_shared/cms.ts'
import * as markdown from '../src/lib/article-markdown.ts'
const template=(await readFile(new URL('../src/components/cms/AdminPage.astro',import.meta.url),'utf8')).match(/<owner-cms>[\s\S]*?<\/owner-cms>/)[0]
const baseline=JSON.parse(await readFile(new URL('../src/data/cms-published.json',import.meta.url),'utf8'))
const source=(await readFile(new URL('../src/lib/cms-editor.ts',import.meta.url),'utf8')).replaceAll('import.meta.env.PUBLIC_SUPABASE_URL',"'https://fixture.invalid'").replaceAll('import.meta.env.PUBLIC_SUPABASE_ANON_KEY',"'fixture-public'")
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(setImmediate)}
async function setup(t,{role='owner'}={}){
  const dom=new JSDOM(`<!doctype html><html><body>${template}</body></html>`,{url:'https://fixture.invalid/admin',runScripts:'outside-only'}),w=dom.window
  t.after(()=>w.close());w.structuredClone=structuredClone;w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{}
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false}
  const docs=new Map(baseline.documents.map(d=>[d.id,{...structuredClone(d),published_payload:structuredClone(d.payload),published_revision:d.revision,deleted:false}]))
  const calls=[],jobs=[];let rpcOverride
  const session=()=>role==='guest'?null:{user:{id:role==='owner'?'owner-id':'member-id'},access_token:'fixture'}
  const client={auth:{getSession:async()=>({data:{session:session()}})},rpc:async(name,args={})=>{
    calls.push({name,args:structuredClone(args)})
    if(rpcOverride){const override=await rpcOverride(name,args);if(override)return override}
    if(name==='comment_me')return {data:{is_admin:role==='owner'},error:null}
    if(role!=='owner')return {data:null,error:{message:'admin_required'}}
    if(name==='cms_initialize')return {data:null,error:null}
    if(name==='cms_list')return {data:[...docs.values()].map(d=>({...d,title:cms.documentTitle(d),published:!!d.published_payload,changed:JSON.stringify(d.payload)!==JSON.stringify(d.published_payload)})),error:null}
    if(name==='cms_get')return {data:structuredClone(docs.get(args.p_id)),error:null}
    if(name==='cms_save'){
      const old=docs.get(args.p_id)
      if((old?.revision||0)!==args.p_revision)return {data:null,error:{message:'cms_conflict'}}
      const next={...old,id:args.p_id,kind:args.p_kind,revision:args.p_revision+1,payload:structuredClone(args.p_payload),deleted:false}
      docs.set(next.id,next);return {data:structuredClone(next),error:null}
    }
    if(name==='cms_trash'){const d=docs.get(args.p_id);d.deleted=args.p_deleted;d.revision++;return {data:structuredClone(d),error:null}}
    if(name==='cms_prepare_publish'){const job={id:args.p_request_id,document_id:args.p_id,revision:args.p_revision,action:args.p_action,state:'queued',created_at:new Date().toISOString()};jobs.push(job);return {data:job,error:null}}
    if(name==='cms_jobs')return {data:jobs,error:null}
    if(name==='cms_media_list'||name==='cms_history')return {data:[],error:null}
    throw Error(`Unexpected RPC ${name}`)
  }}
  w.fetch=async(_url,options)=>{const {id}=JSON.parse(options.body),job=jobs.find(j=>j.id===id);if(job)job.state='committed';return {ok:true,json:async()=>({id,state:'committed'})}}
  w.require=name=>{
    if(name==='./comment-auth')return {getCommentClient:()=>client,COMMENT_AUTH_EVENT:'comment-auth-change'}
    if(name==='./article-markdown')return markdown
    if(name==='./cms-image')return {encodeCMSImage:()=>{throw Error('Use browser acceptance for image encoding')}}
    if(name.includes('cms-published'))return {default:baseline}
    if(name.includes('_shared/cms'))return cms
    throw Error(`Unexpected import ${name}`)
  };w.module={exports:{}};w.exports=w.module.exports;w.eval(code);w.module.exports.installCMS();await tick()
  const root=w.document.querySelector('owner-cms'),find=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text&&!b.closest('[hidden]'))
  return {w,root,docs,calls,jobs,find,click:async text=>{const b=find(text);assert.ok(b,`Button exists: ${text}`);b.click();await tick()},fill:(name,value)=>{const i=root.querySelector(`[name="${name}"]`);assert.ok(i,`Input ${name}`);i.value=value;i.dispatchEvent(new w.Event('input',{bubbles:true}))},override:fn=>{rpcOverride=fn},role:value=>{role=value;w.dispatchEvent(new w.CustomEvent('comment-auth-change',{detail:{userId:session()?.user.id||null}}))}}
}
test('guest and ordinary account never request or display CMS documents',async t=>{
  for(const role of ['guest','member']){const ui=await setup(t,{role});assert.equal(ui.root.querySelector('[data-cms-shell]').hidden,true);assert.ok(!ui.calls.some(x=>x.name==='cms_list'));assert.equal(ui.root.querySelector('[data-list]').textContent,'')}
})
test('existing owner enters the CMS without a new account or public nickname',async t=>{
  const ui=await setup(t);assert.equal(ui.root.querySelector('[data-cms-shell]').hidden,false);await ui.click('友链');assert.match(ui.root.querySelector('[data-list]').textContent,/Roy Zhao/)
})
test('saving a friend modifies only a private draft',async t=>{
  const ui=await setup(t);await ui.click('友链');const entry=ui.root.querySelector('[data-list] button');entry.click();await tick();ui.fill('intro','An edited introduction');await ui.click('保存草稿');const id=ui.calls.filter(c=>c.name==='cms_save').at(-1).args.p_id
  assert.equal(ui.docs.get(id).payload.intro,'An edited introduction');assert.notEqual(ui.docs.get(id).published_payload.intro,'An edited introduction');assert.equal(ui.jobs.length,0)
})
test('draft save failures preserve input and do not retry forever',async t=>{
  const ui=await setup(t);await ui.click('新建文章');ui.fill('zh.title','Never lose this');ui.override(name=>name==='cms_save'?{error:{message:'cms_conflict'},data:null}:null)
  await ui.click('保存草稿');assert.equal(ui.root.querySelector('[name="zh.title"]').value,'Never lose this');assert.match(ui.root.querySelector('[data-cms-message]').textContent,/另一个窗口/);assert.equal(ui.calls.filter(c=>c.name==='cms_save').length,1)
})
test('formatting previews sanitize HTML and preserve math',async t=>{
  const ui=await setup(t);await ui.click('新建文章');ui.fill('zh.body','**Hello** $x^2$\n\n<script>bad()</script>');await new Promise(r=>setTimeout(r,230));const preview=ui.root.querySelector('.cms-md-preview');assert.ok(preview.querySelector('strong'));assert.ok(preview.querySelector('.katex'));assert.equal(preview.querySelector('script'),null)
})
test('sign-out immediately clears private forms and ignores late responses',async t=>{
  const ui=await setup(t);await ui.click('新建文章');ui.fill('zh.title','Private draft');let resolve;ui.override(name=>name==='cms_save'?new Promise(r=>resolve=r):null);ui.find('保存草稿').click();await tick();ui.role('guest');await tick();resolve({data:{revision:1},error:null});await tick();assert.equal(ui.root.querySelector('[data-cms-shell]').hidden,true);assert.equal(ui.root.querySelector('[data-editor]').textContent,'');assert.ok(!ui.root.textContent.includes('Private draft'))
})
test('saving while typing retains the newer text instead of replacing it',async t=>{
  const ui=await setup(t);await ui.click('新建文章');ui.fill('zh.title','First');let resolve;ui.override(name=>name==='cms_save'?new Promise(r=>resolve=r):null);ui.find('保存草稿').click();await tick();ui.fill('zh.title','Second');resolve({data:{revision:1},error:null});await tick();assert.equal(ui.root.querySelector('[name="zh.title"]').value,'Second');assert.match(ui.root.querySelector('[data-save-status]').textContent,/未保存/)
})
test('duplicate publish clicks create one job and switch to deployment history',async t=>{
  const ui=await setup(t);await ui.click('新建文章');for(const [name,value] of Object.entries({slug:'new-note','zh.title':'New note','zh.description':'Description','zh.body':'Body',publishDate:'2026-10-18'}))ui.fill(name,value)
  const publish=ui.find('发布');publish.click();publish.click();await tick();assert.equal(ui.jobs.length,0);await ui.click('确认发布');await tick();assert.equal(ui.jobs.length,1);assert.match(ui.root.querySelector('[data-editor]').textContent,/等待部署/)
})

test('cancelling publication keeps the saved draft and creates no job',async t=>{
  const ui=await setup(t);await ui.click('友链');ui.root.querySelector('[data-list] button').click();await tick();await ui.click('发布');assert.ok(ui.root.querySelector('.cms-confirm')?.open);await ui.click('取消');assert.equal(ui.jobs.length,0);assert.equal(ui.root.querySelector('.cms-confirm'),null);assert.ok(ui.find('发布'))
})

test('sign-out cancels pending publication confirmation',async t=>{
  const ui=await setup(t);await ui.click('友链');ui.root.querySelector('[data-list] button').click();await tick();await ui.click('发布');ui.role('guest');await tick();assert.equal(ui.root.querySelector('.cms-confirm'),null);assert.equal(ui.jobs.length,0);assert.equal(ui.root.querySelector('[data-cms-shell]').hidden,true)
})
test('draft trash has a reverse action and restoring does not publish',async t=>{
  const ui=await setup(t);await ui.click('新建文章');ui.fill('zh.title','Reversible');await ui.click('保存草稿');await ui.click('移入回收站');await ui.click('确认移入回收站');assert.ok(ui.find('恢复到草稿'));await ui.click('恢复到草稿');const d=[...ui.docs.values()].find(d=>d.payload.zh?.title==='Reversible');assert.equal(d.deleted,false);assert.equal(ui.jobs.length,0)
})

test('export provides a persistent download link and sign-out revokes it',async t=>{
  const ui=await setup(t);await ui.click('友链');ui.root.querySelector('[data-list] button').click();await tick();await ui.click('导出此项');const link=ui.root.querySelector('[data-cms-download]');assert.ok(link.download.endsWith('.json'));assert.match(link.href,/^blob:/);assert.match(ui.root.querySelector('[data-cms-message]').textContent,/点击/);ui.role('guest');await tick();assert.equal(ui.root.querySelector('[data-cms-download]'),null)
})

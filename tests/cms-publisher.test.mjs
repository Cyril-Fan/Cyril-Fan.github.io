import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash,randomUUID } from 'node:crypto'
import { publicFiles } from '../supabase/functions/_shared/cms.ts'
const baseline=JSON.parse(await readFile(new URL('../src/data/cms-published.json',import.meta.url)))
const image=await readFile(new URL('../public/links/royzhao.webp',import.meta.url))
let handler,env
globalThis.Deno={env:{get:key=>env[key]},serve:fn=>{handler=fn}}
await import('../supabase/functions/cms-publish/index.ts')
const hash=data=>createHash('sha1').update(`blob ${Buffer.byteLength(data)}\0`).update(data).digest('hex')
function setup(t,{owner=true,token=true,conflict=false,uncertain=false,external=false,media=0}={}){
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch})
  env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',SUPABASE_ANON_KEY:'public-key',...(token?{CMS_GITHUB_TOKEN:'scoped-publisher'}:{})}
  const target=structuredClone(baseline.documents),profile=target.find(d=>d.id==='profile');profile.revision++;profile.payload.zh.intro='Published through the editor.'
  const mediaIds=Array.from({length:media},()=>randomUUID());profile.payload.zh.about=mediaIds.map(id=>`![Photo](/media/${id}.webp)`).join('\n')||profile.payload.zh.about
  const job={id:randomUUID(),state:'queued',lease:null,base_documents:baseline.documents,documents:target,blobs:{}}
  let files=new Map([...publicFiles(baseline.documents,'initial'),['.github/workflows/deploy.yml','existing workflow']].map(([p,c])=>[p,Buffer.from(c)])),head='1'.repeat(40),treeId='2'.repeat(40),seq=3,commits=0,updates=0,failedFinalization=false
  const blobs=new Map([...files.values()].map(c=>[hash(c),c])),trees=new Map([[treeId,new Map([...files].map(([p,c])=>[p,hash(c)]))]]),commitTrees=new Map([[head,treeId]])
  if(external){files.set('public/links.json',Buffer.from('manual change'));blobs.set(hash('manual change'),Buffer.from('manual change'));trees.get(treeId).set('public/links.json',hash('manual change'))}
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
  globalThis.fetch=async(url,options={})=>{
    url=String(url);const u=new URL(url),body=options.body?JSON.parse(options.body):null
    if(u.origin==='https://fixture.supabase.co'){
      if(u.pathname.includes('/storage/'))return new Response(image,{headers:{'Content-Type':'image/webp'}})
      const name=u.pathname.split('/').at(-1)
      if(name==='comment_me')return reply({is_admin:owner})
      if(name==='cms_jobs')return reply([job])
      if(name==='cms_service_claim'){if(['queued','failed'].includes(job.state)){job.state='publishing';job.lease=randomUUID()}return reply(job)}
      if(name==='cms_service_stage'){Object.assign(job.blobs,body.p_blobs);job.state='queued';job.lease=null;return reply(null)}
      if(name==='cms_service_redeploy'){job.commit_sha=body.p_sha;return reply(null)}
      if(name==='cms_service_finish'){
        if(uncertain&&!failedFinalization&&body.p_state==='committed'){failedFinalization=true;return reply({message:'database unavailable'},503)}
        job.state=body.p_state;job.commit_sha=body.p_sha;return reply(null)
      }
      throw Error(`Unexpected RPC ${name}`)
    }
    if(u.origin==='https://cyril-fan.top')return new Response(files.get('public/data/cms-release.json'),{headers:{'Content-Type':'application/json'}})
    if(u.origin!=='https://api.github.com')throw Error('Unexpected destination')
    const p=u.pathname.replace('/repos/Cyril-Fan/Cyril-Fan.github.io','')
    if(p==='/git/ref/heads/main')return reply({object:{sha:head}})
    if(p.startsWith('/git/commits/')&&(!options.method||options.method==='GET'))return reply({tree:{sha:commitTrees.get(p.split('/').at(-1))}})
    if(p.startsWith('/git/trees/')&&(!options.method||options.method==='GET'))return reply({truncated:false,tree:[...trees.get(p.split('/').at(-1))].map(([path,sha])=>({path,sha,type:'blob'}))})
    if(p.startsWith('/git/blobs/')){const blob=blobs.get(p.split('/').at(-1));return reply({size:blob.length,content:blob.toString('base64')})}
    if(p==='/git/blobs'){const data=Buffer.from(body.content,'base64'),sha=hash(data);blobs.set(sha,data);return reply({sha})}
    if(p==='/git/trees'){
      assert.ok(body.base_tree,'must preserve unrelated files');const tree=new Map(trees.get(body.base_tree))
      for(const change of body.tree){if(change.sha===null)tree.delete(change.path);else if(change.content!==undefined){const data=Buffer.from(change.content),sha=hash(data);blobs.set(sha,data);tree.set(change.path,sha)}else tree.set(change.path,change.sha)}
      const sha=String(seq++).padStart(40,'0');trees.set(sha,tree);return reply({sha})
    }
    if(p==='/git/commits'){commits++;assert.deepEqual(body.parents,[head]);const sha=String(seq++).padStart(40,'0');commitTrees.set(sha,body.tree);return reply({sha})}
    if(p==='/git/refs/heads/main'){
      assert.equal(body.force,false,'never force push');if(conflict)return reply({message:'ref changed'},422)
      updates++;head=body.sha;treeId=commitTrees.get(head);files=new Map([...trees.get(treeId)].map(([p,s])=>[p,blobs.get(s)]));return reply({object:{sha:head}})
    }
    throw Error(`Unexpected Git operation ${p}`)
  }
  return {job,mediaIds,call:async(action='publish',origin='https://cyril-fan.top')=>{const result=await handler(new Request('https://fixture.supabase.co/functions/v1/cms-publish',{method:'POST',headers:{Origin:origin,Authorization:'Bearer fixture-owner','Content-Type':'application/json'},body:JSON.stringify({id:job.id,action})}));return {status:result.status,data:await result.json()}},get files(){return files},get updates(){return updates},get commits(){return commits}}
}
test('publisher refuses ordinary users before any Git action',async t=>{const f=setup(t,{owner:false});assert.equal((await f.call()).status,403);assert.equal(f.commits,0)})
test('publisher refuses other origins and missing service credentials',async t=>{const f=setup(t,{token:false});assert.equal((await f.call('publish','https://evil.example')).status,403);assert.equal((await f.call()).status,503);assert.equal(f.job.state,'queued')})
test('one atomic commit preserves workflow and changes only approved content',async t=>{const f=setup(t);const r=await f.call();assert.equal(r.data.state,'committed');assert.equal(f.updates,1);assert.equal(f.files.get('.github/workflows/deploy.yml').toString(),'existing workflow');assert.equal(JSON.parse(f.files.get('public/data/cms-release.json')).release,f.job.id);assert.match(f.files.get('src/data/cms-published.json').toString(),/Published through the editor/);assert.equal((await f.call('status')).data.state,'live')})
test('retry after an uncertain database response reconciles the Git marker without another commit',async t=>{const f=setup(t,{uncertain:true});assert.equal((await f.call()).status,400);assert.equal(f.updates,1);assert.equal(f.job.state,'failed');assert.equal((await f.call()).data.state,'committed');assert.equal(f.updates,1);assert.equal(f.commits,1)})
test('branch races never force push or advance published state',async t=>{const f=setup(t,{conflict:true});assert.equal((await f.call()).status,400);assert.equal(f.updates,0);assert.equal(f.job.state,'failed');assert.equal(JSON.parse(f.files.get('public/data/cms-release.json')).release,'initial')})
test('unrelated draft edits cannot overwrite manual changes to managed files',async t=>{const f=setup(t,{external:true});const result=await f.call();assert.equal(result.status,200);assert.equal(f.files.get('public/links.json').toString(),'manual change');assert.equal(result.data.state,'committed')})
test('media batches are resumable and become public together in the final commit',async t=>{const f=setup(t,{media:5});assert.equal((await f.call()).data.state,'queued');assert.equal(Object.keys(f.job.blobs).length,3);assert.equal(f.updates,0);assert.equal((await f.call()).data.state,'committed');assert.equal(f.updates,1);for(const id of f.mediaIds)assert.ok(f.files.has(`public/media/${id}.webp`))})
test('cancelled jobs do not publish and cannot be retried accidentally',async t=>{const f=setup(t);assert.equal((await f.call('cancel')).data.state,'cancelled');assert.equal((await f.call()).data.state,'cancelled');assert.equal(f.commits,0)})
test('redeploy is a no-content commit for the latest submitted version',async t=>{const f=setup(t);await f.call();const files=[...f.files].map(([p,c])=>[p,c.toString()]);assert.equal((await f.call('redeploy')).data.state,'committed');assert.deepEqual([...f.files].map(([p,c])=>[p,c.toString()]),files);assert.equal(f.updates,2)})

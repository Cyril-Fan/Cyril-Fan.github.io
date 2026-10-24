import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile,writeFile,unlink,mkdir } from 'node:fs/promises'
import { createHash,randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
const hash=data=>createHash('sha1').update('blob '+Buffer.byteLength(data)+'\0').update(data).digest('hex')
await mkdir('work',{recursive:true})
const bundle='work/content-publisher-test-'+randomUUID()+'.mjs'
await build({entryPoints:['supabase/functions/content-github/index.ts'],bundle:true,packages:'external',format:'esm',platform:'node',outfile:bundle})
let handler,env
globalThis.Deno={env:{get:k=>env[k]},serve:fn=>{handler=fn}}
await import(pathToFileURL(process.cwd()+'/'+bundle));await unlink(bundle)
const profile=await readFile('src/data/profile.json','utf8')
const academic=await readFile('src/data/academic.json','utf8')
const avatar=await (await import('sharp')).default({create:{width:2,height:2,channels:4,background:'#abc'}}).webp({lossless:true}).toBuffer()
function fixture(t,{owner=true,race=false,uncertain=false,failImage=false,live=false,buildFailed=false}={}){
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original})
 env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'private-server-key',CMS_GITHUB_TOKEN:'private-pat'}
 let head='1'.repeat(40),seq=2,updates=0,commits=0,history=[],lost=false
 const blobs=new Map(),trees=new Map(),commitData=new Map(),initial=new Map()
 for(const [path,value]of [['src/data/profile.json',profile],['src/data/academic.json',academic],['public/links.json','{"friends":[]}'],['public/media/shared.webp',avatar],['src/content/blogs/demo/index.md','---\ntitle: Demo\ndescription: Test\npublishDate: 2026-10-24\n---\n![Shared](/media/shared.webp)'],['.github/workflows/deploy.yml','private workflow config']]){const bytes=Buffer.from(value),sha=hash(bytes);blobs.set(sha,bytes);initial.set(path,sha)}
 trees.set('initial',initial);commitData.set(head,{tree:'initial',message:'Initial'})
 const current=()=>trees.get(commitData.get(head).tree),response=(value,status=200)=>new Response(JSON.stringify(value),{status})
 globalThis.fetch=async(url,init={})=>{
   const u=new URL(url),body=init.body?JSON.parse(init.body):null,p=u.pathname.replace('/repos/Cyril-Fan/Cyril-Fan.github.io','')
   if(u.origin==='https://fixture.supabase.co'){
     assert.ok(!u.pathname.includes('cms_'),'no legacy CMS RPC')
     if(u.pathname.endsWith('/comment_me'))return response({is_admin:owner})
     if(u.pathname==='/auth/v1/user')return response({id:'owner-1'})
     throw Error('Unexpected Supabase call '+u.pathname)
   }
   if(u.origin==='https://cyril-fan.top')return live&&current().has('public/data/cms-release.json')?new Response(blobs.get(current().get('public/data/cms-release.json'))):response({})
   assert.equal(u.origin,'https://api.github.com')
   if(p==='/git/ref/heads/main')return response({object:{sha:head}})
   if(p.startsWith('/git/commits/')&&init.method==='GET'){const c=commitData.get(p.split('/').at(-1));return response({tree:{sha:c.tree}})}
   if(p.startsWith('/git/trees/'))return response({truncated:false,tree:[...trees.get(p.split('/').at(-1))].map(([path,sha])=>({path,sha,mode:'100644',type:'blob',size:blobs.get(sha).length}))})
   if(p.startsWith('/git/blobs/'))return response({content:blobs.get(p.split('/').at(-1)).toString('base64')})
   if(p==='/commits')return response(history)
   if(p.startsWith('/commits/'))return response({commit:{message:commitData.get(p.split('/').at(-1)).message}})
   if(p.startsWith('/compare/'))return response({status:p.endsWith(head+'...'+head)?'identical':'ahead'})
   if(p.includes('/actions/'))return response({workflow_runs:[{status:'completed',conclusion:buildFailed?'failure':'success',html_url:'https://github.com/Cyril-Fan/Cyril-Fan.github.io/actions'}]})
   if(p==='/git/blobs'){
     if(failImage&&body.encoding==='base64')return response({},503)
     const bytes=Buffer.from(body.content,body.encoding==='base64'?'base64':'utf8'),sha=hash(bytes);blobs.set(sha,bytes);return response({sha})
   }
   if(p==='/git/trees'){
     const tree=new Map(trees.get(body.base_tree));for(const c of body.tree){if(c.sha===null)tree.delete(c.path);else if(c.content!==undefined){const bytes=Buffer.from(c.content),sha=hash(bytes);blobs.set(sha,bytes);tree.set(c.path,sha)}else tree.set(c.path,c.sha)}
     const sha=String(seq++).padStart(40,'0');trees.set(sha,tree);return response({sha})
   }
   if(p==='/git/commits'){assert.deepEqual(body.parents,[head]);commits++;const sha=String(seq++).padStart(40,'0');commitData.set(sha,{tree:body.tree,message:body.message});return response({sha})}
   if(p==='/git/refs/heads/main'){
     assert.equal(body.force,false);if(race)return response({},422)
     head=body.sha;updates++;history.unshift({sha:head,commit:{message:commitData.get(head).message}})
     if(uncertain&&!lost){lost=true;throw Error('network response lost')}
     return response({object:{sha:head}})
   }
   throw Error('Unexpected Git call '+p)
 }
 const call=async(input,extra={})=>{const r=await handler(new Request('https://fixture.supabase.co/functions/v1/content-github',{method:'POST',headers:{Origin:extra.origin||'https://cyril-fan.top',Authorization:'Bearer owner-session','Content-Type':'application/json'},body:JSON.stringify(input)}));return {status:r.status,...await r.json()}}
 const changed=()=>({path:'src/data/profile.json',baseSha:current().get('src/data/profile.json'),content:JSON.stringify({...JSON.parse(profile),email:'owner@example.com'}),encoding:'utf-8'})
 return {call,changed,get head(){return head},get updates(){return updates},get commits(){return commits},get files(){return new Map([...current()].map(([p,s])=>[p,blobs.get(s)]))},publish(changes=[changed()],requestId=randomUUID(),baseHead=head){return call({action:'publish',requestId,baseHead,changes})}}
}
test('anonymous/member/cross-origin calls cannot read or write private editor state',async t=>{
 const f=fixture(t,{owner:false});assert.equal((await f.call({action:'list'})).status,403);assert.equal((await f.publish()).status,403);assert.equal((await f.call({action:'list'},{origin:'https://evil.test'})).status,403);assert.equal(f.updates,0)
})
test('owner reads canonical Git files and receives a stable account-bound local key',async t=>{
 const f=fixture(t);const a=await f.call({action:'list'}),b=await f.call({action:'list'});assert.equal(a.localKey,b.localKey);assert.equal(Buffer.from(a.localKey,'base64').length,32);assert.ok(!JSON.stringify(a).includes('private-pat'));assert.ok(a.entries.every(x=>!x.path.includes('.github')))
})
test('one atomic selected-file commit preserves unrelated files and separates live status',async t=>{
 const f=fixture(t),id=randomUUID(),change=f.changed(),r=await f.publish([change],id);assert.equal(r.state,'committed');assert.equal(f.updates,1);assert.equal(f.files.get('.github/workflows/deploy.yml').toString(),'private workflow config');assert.equal(f.files.get('src/data/academic.json').toString(),academic)
 const status=await f.call({action:'status',requestId:id,commitSha:r.commitSha});assert.equal(status.state,'committed')
})
test('uncertain network result safely retries the same request without another commit',async t=>{
 const f=fixture(t,{uncertain:true}),id=randomUUID(),changes=[f.changed()],head=f.head;assert.equal((await f.publish(changes,id,head)).status,400);assert.equal(f.updates,1);assert.equal((await f.publish(changes,id,head)).state,'committed');assert.equal(f.commits,1)
})
test('conflicts return remote text; branch races never force push',async t=>{
 const f=fixture(t,{race:true}),change=f.changed();const conflict=await f.publish([{...change,baseSha:'a'.repeat(40)}]);assert.equal(conflict.status,409);assert.equal(conflict.detail[0].current,profile)
 assert.equal((await f.publish([change])).status,409);assert.equal(f.updates,0)
})
test('shared references block image removal; deleting referencing file together is allowed',async t=>{
 const f=fixture(t),sha=hash(avatar);assert.equal((await f.publish([{path:'public/media/shared.webp',baseSha:sha,content:null,encoding:'base64'}])).status,409)
 const text=f.files.get('src/content/blogs/demo/index.md');assert.equal((await f.publish([{path:'public/media/shared.webp',baseSha:sha,content:null,encoding:'base64'},{path:'src/content/blogs/demo/index.md',baseSha:hash(text),content:null}])).state,'committed')
 assert.ok(!f.files.has('public/media/shared.webp'))
})
test('new image and content are atomic; missing selection and image failures do not publish',async t=>{
 const f=fixture(t,{failImage:true}),p=JSON.parse(profile);p.photo='/media/new.webp';const content={...f.changed(),content:JSON.stringify(p)}
 assert.equal((await f.publish([content])).status,400)
 assert.equal((await f.publish([content,{path:'public/media/new.webp',baseSha:null,content:avatar.toString('base64'),encoding:'base64'}])).status,502);assert.equal(f.updates,0)
})
test('fixed page deletion and all program paths are rejected before Git mutation',async t=>{
 const f=fixture(t);for(const path of ['src/data/profile.json','.github/workflows/deploy.yml','supabase/config.toml'])assert.equal((await f.publish([{path,baseSha:null,content:null}])).status,400);assert.equal(f.commits,0)
})
test('idempotency key reuse with another payload fails and no-op saves create no commit',async t=>{
 const f=fixture(t),id=randomUUID(),change=f.changed();await f.publish([change],id);assert.equal((await f.publish([{...change,content:profile}],id)).status,409)
 const noOp=await f.publish([{...change,baseSha:hash(change.content)}]);assert.equal(noOp.state,'unchanged');assert.ok(noOp.files.length);assert.equal(f.commits,1)
})
test('build failure is distinguishable from commit failure and live requires actual marker',async t=>{
 const f=fixture(t,{buildFailed:true}),id=randomUUID(),r=await f.publish(undefined,id);assert.equal((await f.call({action:'status',requestId:id,commitSha:r.commitSha})).state,'build-failed')
})
test('live marker verifies the submitted release',async t=>{
 const f=fixture(t,{live:true}),id=randomUUID(),r=await f.publish(undefined,id);assert.equal((await f.call({action:'status',requestId:id,commitSha:r.commitSha})).state,'live')
})


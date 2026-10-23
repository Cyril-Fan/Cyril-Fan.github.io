import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../src/lib/site-traffic.ts',import.meta.url),'utf8')
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const key = 'header.'+Buffer.from('{"role":"anon"}').toString('base64url')+'.signature'
const endpoint = 'https://project.supabase.co'
const stats = {total:'24',started_at:'2026-10-23T12:00:00Z'}
const flush = () => new Promise(resolve=>setImmediate(resolve))
function setup({host='cyril-fan.top',path='/',visible=true,production=true,fetcher=async()=>({ok:true,json:async()=>stats})}={}) {
  const dom = new JSDOM('<html lang="zh"><p data-site-visits hidden><span data-visit-total></span></p></html>',{url:`https://${host}${path}`,runScripts:'outside-only'})
  const {window}=dom
  Object.defineProperty(window.document,'visibilityState',{configurable:true,value:visible?'visible':'hidden'})
  window.AbortSignal.timeout=AbortSignal.timeout
  // jsdom and Node have distinct AbortSignal realms; the mock fetch does not
  // need a real timeout, but DOM listeners still require jsdom's own signal.
  window.AbortSignal.any=signals=>signals[0]
  const module={exports:{}}
  window.Function('module','exports',code)(module,module.exports)
  const stop=module.exports.installSiteTraffic({url:endpoint,key,production,fetcher})
  return {window,module:module.exports,close:()=>{stop();window.close()}}
}

test('only public keys and valid count responses are accepted',()=>{
  const a=setup({production:false})
  assert.equal(a.module.publicStatsConfig(endpoint,key),true)
  for(const bad of ['sb_secret_bad','x.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.x']) assert.equal(a.module.publicStatsConfig(endpoint,bad),false)
  assert.equal(a.module.publicStatsConfig('https://project.supabase.co/?token=x',key),false)
  for(const bad of [-1,12,'-1','1.2','01','9223372036854775808','<script>']) assert.equal(a.module.parseSiteStats({...stats,total:bad}),null)
  assert.equal(a.module.parseSiteStats({...stats,started_at:'unknown'}),null)
  assert.deepEqual(JSON.parse(JSON.stringify(a.module.parseSiteStats(stats))),stats)
  a.close()
})

test('private authoring pages do not inflate public page views',async()=>{
  for(const path of ['/admin','/admin/','/en/admin/']){
    let calls=0;const a=setup({path,fetcher:async()=>{calls++;throw Error('unexpected request')}})
    await flush();assert.equal(calls,0);a.close()
  }
})
test('record once per visible load, without credentials, path or account identity',async()=>{
  const calls=[]
  const a=setup({fetcher:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>stats}}})
  await flush()
  a.window.document.dispatchEvent(new a.window.Event('visibilitychange'))
  a.window.dispatchEvent(new a.window.PageTransitionEvent('pageshow'))
  await flush()
  assert.equal(calls.length,1)
  assert.equal(calls[0].url,endpoint+'/rest/v1/rpc/record_page_view')
  assert.equal(calls[0].init.credentials,'omit')
  assert.equal(calls[0].init.referrerPolicy,'no-referrer')
  assert.equal(calls[0].init.cache,'no-store')
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)),['p_request_id'])
  assert.equal(a.window.document.querySelector('[data-visit-total]').textContent,'24')
  assert.equal(a.window.document.querySelector('[data-site-visits]').hidden,false)
  a.close()
})
test('network retry uses the same id, while BFCache revisit counts a new page view',async()=>{
  const ids=[]
  const a=setup({fetcher:async(url,init)=>{ids.push(JSON.parse(init.body).p_request_id);if(ids.length===1)throw Error('lost response');return {ok:true,json:async()=>stats}}})
  await flush()
  assert.equal(ids.length,2)
  assert.equal(ids[0],ids[1])
  a.window.dispatchEvent(new a.window.PageTransitionEvent('pageshow',{persisted:true}))
  await flush()
  assert.equal(ids.length,3)
  assert.notEqual(ids[2],ids[1])
  a.close()
})
test('previews and background tabs do not count; service failure does not invent zero',async()=>{
  let calls=0
  const fetcher=async()=>{calls++;throw Error('offline')}
  for(const options of [{host:'localhost'},{production:false},{visible:false}]) {
    const a=setup({...options,fetcher})
    await flush()
    assert.equal(calls,0)
    a.close()
  }
  const a=setup({fetcher})
  await flush()
  assert.equal(calls,2)
  assert.equal(a.window.document.querySelector('[data-site-visits]').hidden,true)
  assert.equal(a.window.document.querySelector('[data-visit-total]').textContent,'')
  a.close()
})

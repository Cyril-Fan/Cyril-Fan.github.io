import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir,unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
await mkdir('work',{recursive:true});const path='work/local-test-'+randomUUID()+'.mjs'
await build({entryPoints:['src/lib/content-local.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:path})
const {LocalContentStore,markCommitted,discardLocalFile}=await import(pathToFileURL(process.cwd()+'/'+path));await unlink(path)
const repository='Cyril-Fan/Cyril-Fan.github.io',secret=Buffer.alloc(32,7).toString('base64')
function indexedDBFixture(){
 const rows=new Map()
 const db={createObjectStore(){},close(){},transaction(){
   const tx={objectStore:()=>Object.fromEntries(['put','get','getAll','delete'].map(method=>[method,(value)=>{const request={};queueMicrotask(()=>{try{
     request.result=method==='put'?(rows.set(value.id,structuredClone(value)),value.id):method==='get'?rows.get(value):method==='getAll'?[...rows.values()]:(rows.delete(value),undefined)
     request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.())
   }catch(e){tx.error=e;tx.onerror?.()}});return request}]))
   };return tx
 }}
 return {rows,open(){const r={result:db};queueMicrotask(()=>{r.onupgradeneeded?.();r.onsuccess?.()});return r}}
}
const workspace=(owner='owner',id=randomUUID())=>({id,owner,repository,updated:new Date().toISOString(),files:[{path:'src/content/blogs/private/index.md',baseSha:null,baseText:null,content:'Private words',revision:1}]})
test('local drafts and image payloads are encrypted, recoverable, and isolated by account and tab',async()=>{
 const fake=indexedDBFixture();globalThis.indexedDB=fake;const a=await LocalContentStore.open('owner',secret),b=await LocalContentStore.open('other',secret)
 const first=workspace(),second=workspace();second.files[0].content='Other tab text';await a.save(first);await a.save(second)
 assert.ok(!JSON.stringify([...fake.rows.values()]).includes('Private words'));assert.equal((await a.list()).length,2);assert.equal((await b.list()).length,0)
 await assert.rejects(()=>b.remove(first.id),/account mismatch/);await assert.rejects(()=>b.save(first),/account mismatch/)
 assert.equal((await a.list()).find(s=>s.id===first.id).files[0].content,'Private words')
 await a.remove(second.id);assert.equal((await a.list()).length,1)
})
test('wrong key never reveals content and reports recoverability instead of silently discarding',async()=>{
 globalThis.indexedDB=indexedDBFixture();const a=await LocalContentStore.open('owner',secret);await a.save(workspace())
 const wrong=await LocalContentStore.open('owner',Buffer.alloc(32,8).toString('base64'));await assert.rejects(()=>wrong.list(),/could not be decrypted/)
})
test('publish completion only clears the exact submitted revision, retaining newer and unselected changes',()=>{
 const first={path:'a',baseSha:'old',baseText:'Old',content:'First',revision:1},later={...first,content:'Second',revision:2},unselected={...first,path:'b'}
 const submission={changes:[first],revisions:{a:1}},results=[{path:'a',sha:'new'}]
 assert.deepEqual(markCommitted([first,unselected],submission,results),[unselected])
 const retained=markCommitted([later,unselected],submission,results);assert.equal(retained[0].content,'Second');assert.equal(retained[0].baseText,'First');assert.equal(retained[0].baseSha,'new');assert.equal(retained[1].path,'b')
})
test('late deletion completion retains a newly restored local body',()=>{
 const submission={changes:[{path:'a',content:null}],revisions:{a:2}}
 const files=markCommitted([{path:'a',baseSha:'old',baseText:'old',content:'Restored',revision:3}],submission,[{path:'a',sha:null}])
 assert.equal(files[0].content,'Restored');assert.equal(files[0].baseSha,null)
})

const article='src/content/blogs/tech/test/index.md',image='public/media/image-new.webp'
const localImage=(path=image)=>({path,baseSha:null,baseText:null,content:'image-bytes',encoding:'base64',revision:1,mediaOwners:[article]})
const localText=(path=article,content='![image](/media/image-new.webp)')=>({path,baseSha:null,baseText:null,content,encoding:'utf-8',revision:1})
const localSpace=files=>({...workspace(),files})
test('discard removes only associated unused new images, including earlier replaced selections',()=>{
 const s=localSpace([localText(),localImage(),{...localImage('public/media/earlier.webp')}, {...localImage('public/media/library.webp'),mediaOwners:[]}])
 const result=discardLocalFile(s,article,[],new Set(),[])
 assert.deepEqual(result.removed,[image,'public/media/earlier.webp']);assert.equal(result.files[0].path,'public/media/library.webp')
 assert.equal(s.files.length,4,'planning must not mutate the original workspace')
})
test('shared references, existing GitHub paths and uncertain submissions protect images',()=>{
 for(const extra of [localText('src/data/profile.json'),localText('src/content/blogs/tech/test/index-en.md')]){
  const s=localSpace([localText(),localImage(),extra]);assert.deepEqual(discardLocalFile(s,article,[],new Set(),[]).removed,[])
 }
 const s=localSpace([localText(),localImage()])
 assert.deepEqual(discardLocalFile(s,article,[],new Set([image]),[]).removed,[])
 assert.deepEqual(discardLocalFile(s,article,[localText('src/data/profile.json')],new Set(),[]).removed,[])
 s.submission={changes:[localImage()],state:'failed'};assert.deepEqual(discardLocalFile(s,article,[],new Set(),[]).removed,[])
})
test('other tabs retain their bytes and references; unavailable recovery inspection fails closed',()=>{
 const s=localSpace([localText(),localImage()]),other=localSpace([localText('src/data/profile.json'),localImage()]),copy=structuredClone(other)
 assert.deepEqual(discardLocalFile(s,article,[],new Set(),[other]).removed,[image],'Other tab owns its own full payload, which is untouched')
 assert.deepEqual(discardLocalFile(s,article,[],new Set(),[{...other,files:[localText('src/data/profile.json')]}]).removed,[],'A reference without an independent payload protects the only copy')
 assert.deepEqual(other,copy);assert.deepEqual(discardLocalFile(s,article,[],new Set(),null).removed,[])
 assert.equal(discardLocalFile(s,image,[],new Set(),[]).blocked,true)
})
test('discarding replacement content restores an automatically removed original, without staging GitHub deletion',()=>{
 const old='public/media/original.webp',s=localSpace([localText(),localImage(),{...localImage(old),baseSha:'old-sha',content:null,autoRemovedFor:image}])
 const remote=[localText(article,'![original](/media/original.webp)')]
 const result=discardLocalFile(s,article,remote,new Set([old]),[])
 assert.deepEqual(result.removed,[image]);assert.deepEqual(result.restored,[old]);assert.deepEqual(result.files,[])
})


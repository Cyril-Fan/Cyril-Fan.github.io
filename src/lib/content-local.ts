import { REPOSITORY, decodeBase64, encodeBase64, fileReferences, pathKind, type Change } from '../../supabase/functions/_shared/git-content'
export type LocalFile = Change & { baseText: string | null; revision: number; title?: string; mediaOwners?:string[]; autoRemovedFor?:string; autoRemovedBy?:string }
export type Submission = { requestId:string; baseHead:string; changes:Change[]; revisions:Record<string,number>; commitSha?:string; state:string; files?:{path:string;sha:string|null}[] }
export type Workspace = { id:string; owner:string; repository:string; updated:string; files:LocalFile[]; submission?:Submission }

export const mediaUseLock=(owner:string)=>'cyril-editor-media:'+REPOSITORY+':'+owner
/** All stored copies, including pending/unknown submissions, protect their images. */
export function imageUsedInCopies(path:string,current:Workspace,copies:Workspace[]|null){
  if(copies===null)return true
  return copies.some(s=>s.id!==current.id&&s.owner===current.owner&&s.repository===current.repository&&
    [...s.files,...s.submission?.changes||[]].some(f=>f.content!==null&&(f.path===path||f.encoding!=='base64'&&fileReferences(f.content,path,f.path))))
}

/** Each workspace owns its full image bytes. Never mutate another tab's record.
 * Unknown/unreadable other copies disable automatic collection (fail closed). */
export function discardLocalFile(space:Workspace,path:string,remote:Change[],existingPaths:Set<string>,otherCopies:Workspace[]|null){
  const discarded=space.files.find(f=>f.path===path)
  const kept=space.files.filter(f=>f.path!==path),effective=new Map(remote.map(f=>[f.path,f]))
  for(const f of kept)effective.set(f.path,f)
  const references=(files:Change[],image:string)=>files.some(f=>f.encoding!=='base64'&&f.content&&fileReferences(f.content,image,f.path))
  const pending=space.submission?.changes||[]
  // Restored tabs own a complete duplicate payload. Removing this tab's bytes
  // cannot invalidate that copy. A cross-copy reference without its own bytes
  // must retain this payload; never assume an unfinished save has succeeded.
  const dependsElsewhere=(image:LocalFile)=>otherCopies?.some(s=>s.id!==space.id&&s.owner===space.owner&&s.repository===space.repository&&
    ![...s.files,...s.submission?.changes||[]].some(f=>f.path===image.path&&f.encoding==='base64'&&f.content===image.content)&&
    (references(s.files,image.path)||s.submission?.changes.some(c=>c.path===image.path)||references(s.submission?.changes||[],image.path)))
  const associated=(f:LocalFile)=>f.mediaOwners?.includes(path)||!!(discarded?.content&&discarded.encoding!=='base64'&&fileReferences(discarded.content,f.path,path))
  if(discarded?.encoding==='base64'&&!discarded.baseSha&&discarded.content&&
    (references([...effective.values()],path)||pending.some(c=>c.path===path)||references(pending,path)||otherCopies===null||
     dependsElsewhere(discarded)))return {files:space.files,removed:[],restored:[],blocked:true}
  const candidates=kept.filter(f=>pathKind(f.path)==='media'&&f.encoding==='base64'&&!f.baseSha&&f.content&&!existingPaths.has(f.path)&&associated(f))
  const removed=new Set(candidates.filter(f=>otherCopies!==null&&!references([...effective.values()],f.path)&&
    !pending.some(c=>c.path===f.path)&&!references(pending,f.path)&&
    !dependsElsewhere(f)).map(f=>f.path))
  // Undo only replacement-generated old-image deletions if restored text needs them.
  const restored=new Set(kept.filter(f=>f.autoRemovedFor&&f.content===null&&
    (f.autoRemovedBy===path||candidates.some(c=>c.path===f.autoRemovedFor))&&references([...effective.values()],f.path)&&!pending.some(c=>c.path===f.path)).map(f=>f.path))
  return {files:kept.filter(f=>!removed.has(f.path)&&!restored.has(f.path)),removed:[...removed],restored:[...restored]}
}
type Sealed = { id:string; owner:string; repository:string; updated:string; iv:string; data:string }
const DATABASE='cyril-content-local-v2'
// Keys are supplied only after a fresh server-side owner check and are never persisted.
export class LocalContentStore {
  private constructor(private db:IDBDatabase,private owner:string,private key:CryptoKey) {}
  static async open(owner:string,secret:string){
    const key=await crypto.subtle.importKey('raw',decodeBase64(secret),{name:'AES-GCM'},false,['encrypt','decrypt'])
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open(DATABASE,1)
      request.onupgradeneeded=()=>request.result.createObjectStore('workspaces',{keyPath:'id'})
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
      request.onblocked=()=>reject(new Error('Local storage is blocked by another browser window'))
    })
    return new LocalContentStore(db,owner,key)
  }
  private operation<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>){
    return new Promise<T>((resolve,reject)=>{
      const tx=this.db.transaction('workspaces',mode),request=run(tx.objectStore('workspaces'));let result:T
      request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result)
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Local save aborted'))
    })
  }
  async save(value:Workspace){
    if(value.owner!==this.owner||value.repository!==REPOSITORY)throw new Error('Local account mismatch')
    const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(value))
    const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(value.id+this.owner+REPOSITORY)},this.key,plain))
    await this.operation('readwrite',s=>s.put({id:value.id,owner:this.owner,repository:REPOSITORY,updated:value.updated,iv:encodeBase64(iv),data:encodeBase64(data)} satisfies Sealed))
  }
  async list(){
    const records=await this.operation('readonly',s=>s.getAll()) as Sealed[],result:Workspace[]=[]
    for(const r of records.filter(r=>r.owner===this.owner&&r.repository===REPOSITORY)){
      try{
        const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeBase64(r.iv),additionalData:new TextEncoder().encode(r.id+this.owner+REPOSITORY)},this.key,decodeBase64(r.data))
        result.push(JSON.parse(new TextDecoder().decode(bytes)))
      }catch{throw new Error('A local copy could not be decrypted. Do not clear browser data; restore from your export or ask the maintainer to restore the previous server recovery key.')}
    }
    return result.sort((a,b)=>b.updated.localeCompare(a.updated))
  }
  async remove(id:string){const entry=await this.operation('readonly',s=>s.get(id)) as Sealed|undefined;if(entry&&(entry.owner!==this.owner||entry.repository!==REPOSITORY))throw new Error('Local account mismatch');await this.operation('readwrite',s=>s.delete(id))}
  /** Compare encrypted records inside the delete transaction; a concurrent save always wins. */
  async removeIfUnchanged(expected:Workspace){
    const record=await this.operation('readonly',s=>s.get(expected.id)) as Sealed|undefined
    if(!record||record.owner!==this.owner||record.repository!==REPOSITORY)return false
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeBase64(record.iv),additionalData:new TextEncoder().encode(record.id+this.owner+REPOSITORY)},this.key,decodeBase64(record.data))
    if(new TextDecoder().decode(bytes)!==JSON.stringify(expected))return false
    return new Promise<boolean>((resolve,reject)=>{
      const tx=this.db.transaction('workspaces','readwrite'),s=tx.objectStore('workspaces'),r=s.get(expected.id);let removed=false
      r.onsuccess=()=>{const latest=r.result as Sealed|undefined;if(latest?.data===record.data&&latest.iv===record.iv){s.delete(expected.id);removed=true}}
      tx.oncomplete=()=>resolve(removed);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)
    })
  }
  close(){this.db.close()}
}
export const workspaceLock=(owner:string,id:string)=>'cyril-editor:'+REPOSITORY+':'+owner+':'+id
export const completedCandidate=(s:Workspace)=>!s.files.length&&!!s.submission?.commitSha&&['committed','live'].includes(s.submission.state)
/** Only empty, positively verified deployed jobs are garbage. Unknown/failed jobs remain recoverable. */
export async function reconcileCompletedCopies(store:Pick<LocalContentStore,'list'|'removeIfUnchanged'>,check:(s:Submission)=>Promise<{state:string}>,currentId:string,locks:LockManager|undefined,valid=()=>true){
  if(!locks)return 0 // No reliable cross-tab exclusion: keep all records.
  let removed=0;const states=new Map<string,Promise<{state:string}>>()
  for(const copy of await store.list()){
    if(!valid())break
    if(copy.id===currentId||!completedCandidate(copy))continue
    await locks.request(workspaceLock(copy.owner,copy.id),{ifAvailable:true},async lock=>{
      if(!lock||!valid())return
      try{
        const sub=copy.submission!,key=sub.requestId+sub.commitSha
        if(!states.has(key))states.set(key,check(sub))
        if((await states.get(key))?.state==='live'&&valid()&&await store.removeIfUnchanged(copy))removed++
      }catch{ /* Offline, expired tasks and ambiguous deployment status must remain recoverable. */ }
    })
  }
  return removed
}
export function markCommitted(files:LocalFile[],submission:Submission,results:{path:string;sha:string|null}[]){
  const selected=new Map(submission.changes.map(c=>[c.path,c])),next:LocalFile[]=[]
  for(const file of files){
    const sent=selected.get(file.path),result=results.find(r=>r.path===file.path)
    if(!sent||!result){next.push(file);continue}
    if(file.revision===submission.revisions[file.path]&&file.content===sent.content)continue
    // Typing continued after Publish: rebase the newer local edit, never erase it.
    next.push({...file,baseSha:result.sha,baseText:sent.content})
  }
  return next
}

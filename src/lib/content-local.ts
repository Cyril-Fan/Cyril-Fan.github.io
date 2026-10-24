import { REPOSITORY, decodeBase64, encodeBase64, type Change } from '../../supabase/functions/_shared/git-content'
export type LocalFile = Change & { baseText: string | null; revision: number; title?: string }
export type Submission = { requestId:string; baseHead:string; changes:Change[]; revisions:Record<string,number>; commitSha?:string; state:string; files?:{path:string;sha:string|null}[] }
export type Workspace = { id:string; owner:string; repository:string; updated:string; files:LocalFile[]; submission?:Submission }
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
  close(){this.db.close()}
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

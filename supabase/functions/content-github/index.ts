import { REPOSITORY, BRANCH, SHA, REQUEST_ID, PROFILE, ACADEMIC, RELEASE, pathKind, validateText, validateImage, decodeBase64, encodeBase64, fileReferences, gitBlobHash, type Change } from '../_shared/git-content.ts'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void }
const origins=new Set(['https://cyril-fan.top','https://www.cyril-fan.top'])
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true})
type TreeItem={path:string;sha:string;type:string;size:number;mode:string}
class HttpError extends Error { constructor(public status:number,message:string,public detail?:unknown){super(message)} }

export async function handle(request:Request):Promise<Response>{
  const origin=request.headers.get('origin')||'',headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}
  if(origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'})
  const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{headers,status})
  if(origin&&!origins.has(origin))return respond({error:'Origin not allowed'},403)
  if(request.method==='OPTIONS')return new Response(null,{headers,status:204})
  if(request.method!=='POST')return respond({error:'POST required'},405)
  const authorization=request.headers.get('authorization')||''
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization))return respond({error:'Sign in required'},401)
  const bounded=(url:string,init:RequestInit={})=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)})
  try{
    // Validated on EVERY request by the existing verified-email/ban/admin policy.
    const endpoint=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!
    const auth=await bounded(endpoint+'/rest/v1/rpc/comment_me',{method:'POST',headers:{apikey:anon,Authorization:authorization,'Content-Type':'application/json'},body:'{}'})
    if(!auth.ok)throw new HttpError(auth.status===401?401:403,'Sign in as the site owner')
    const actor=await auth.json()
    if(actor?.is_admin!==true)throw new HttpError(403,'Owner access required')
    const token=Deno.env.get('CMS_GITHUB_TOKEN')
    if(!token)throw new HttpError(503,'GitHub publishing credential is not configured')
    if(Number(request.headers.get('content-length')||0)>28*1024*1024)throw new HttpError(413,'Request too large')
    // Stream the request with a hard ceiling instead of trusting Content-Length.
    const reader=request.body?.getReader();let chunks:Uint8Array[]=[],length=0
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>28*1024*1024){await reader.cancel();throw new HttpError(413,'Request too large')}chunks.push(value)}
    const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}chunks=[]
    const input=JSON.parse(decoder.decode(bytes))
    if(!['list','read','references','publish','status','retry-build'].includes(input.action))throw new HttpError(400,'Unknown operation')
    const gh=async(path:string,method='GET',body?:unknown)=>{
      const res=await bounded('https://api.github.com/repos/'+REPOSITORY+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
      if(!res.ok)throw new HttpError(res.status===409||res.status===422?409:res.status===401||res.status===403?503:502,
        res.status===409||res.status===422?'GitHub changed during submission. Local changes are safe; refresh and retry.':res.status===401||res.status===403?'GitHub credential expired, rate limited or missing permission':'GitHub request failed ('+res.status+')')
      return res.json()
    }
    const current=await gh('/git/ref/heads/'+BRANCH),head=current.object.sha
    const commit=await gh('/git/commits/'+head),tree=await gh('/git/trees/'+commit.tree.sha+'?recursive=1')
    if(tree.truncated)throw new HttpError(413,'Repository tree is too large to validate safely')
    const items:TreeItem[]=tree.tree.filter((x:TreeItem)=>x.type==='blob')
    const files=new Map<string,TreeItem>(items.map(x=>[x.path,x]))
    const textCache=new Map<string,string>()
    const content=async(path:string)=>{
      if(textCache.has(path))return textCache.get(path)!
      const item=files.get(path);if(!item)return null
      if(item.size>2*1024*1024)throw new HttpError(413,'Text file too large: '+path)
      const blob=await gh('/git/blobs/'+item.sha),text=decoder.decode(decodeBase64(blob.content.replace(/\s/g,'')))
      textCache.set(path,text);return text
    }
    const entries=items.filter(x=>pathKind(x.path)).map(x=>({path:x.path,sha:x.sha,size:x.size,kind:pathKind(x.path),writable:x.mode==='100644'}))
    if(input.action==='list'){
      const userResponse=await bounded(endpoint+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization}})
      if(!userResponse.ok)throw new HttpError(401,'Session expired')
      const user=await userResponse.json()
      const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if(!secret)throw new HttpError(503,'Local recovery key is unavailable')
      const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
      const localKey=encodeBase64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('cyril-local-editor-v2:'+user.id+':'+REPOSITORY))))
      return respond({repository:REPOSITORY,branch:BRANCH,head,entries,owner:user.id,localKey})
    }
    if(input.action==='read'){
      if(!Array.isArray(input.paths)||input.paths.length>40||input.paths.some((p:unknown)=>typeof p!=='string'||!pathKind(p)))throw new HttpError(400,'Invalid file paths')
      const result=[]
      for(const path of input.paths){
        const item=files.get(path);if(!item){result.push({path,sha:null,content:null});continue}
        if(item.size>8*1024*1024)throw new HttpError(413,'Image too large')
        if(pathKind(path)==='media'){const b=await gh('/git/blobs/'+item.sha);result.push({path,sha:item.sha,content:b.content.replace(/\s/g,''),encoding:'base64'})}
        else result.push({path,sha:item.sha,content:await content(path),encoding:'utf-8'})
      }
      return respond({head,files:result})
    }
    const refs=async(path:string,changes:Change[]=[])=>{
      const candidate=new Map<string,string|null>(changes.filter(c=>c.encoding!=='base64').map(c=>[c.path,c.content]))
      const found=[]
      // Include application source: a hard-coded reference is not safe to delete from the UI.
      const sources=items.filter(x=>/\.(?:mdx?|json|astro|tsx?|jsx?|css|html)$/.test(x.path)&&!['package-lock.json','package.json'].includes(x.path)&&!x.path.startsWith('tests/')&&!x.path.startsWith('supabase/'))
      for(let i=0;i<sources.length;i+=8)await Promise.all(sources.slice(i,i+8).map(async file=>{
        const source=candidate.has(file.path)?candidate.get(file.path):await content(file.path)
        if(source&&fileReferences(source,path,file.path))found.push(file.path)
        candidate.delete(file.path)
      }))
      for(const [file,source]of candidate)if(source&&fileReferences(source,path,file))found.push(file)
      return found
    }
    if(input.action==='references'){
      if(pathKind(input.path)!=='media')throw new HttpError(400,'Invalid image path')
      return respond({path:input.path,head,references:await refs(input.path)})
    }
    if(input.action==='status'||input.action==='retry-build'){
      if(!SHA.test(input.commitSha)||!REQUEST_ID.test(input.requestId))throw new HttpError(400,'Invalid submission')
      const submitted=await gh('/commits/'+input.commitSha)
      if(!submitted.commit.message.includes('Content-Request: '+input.requestId+'\n'))throw new HttpError(400,'Submission does not match')
      const compare=await gh('/compare/'+input.commitSha+'...'+head)
      if(!['ahead','identical'].includes(compare.status))throw new HttpError(409,'Submission is not on main')
      if(input.action==='retry-build'){
        if(head!==input.commitSha)throw new HttpError(409,'A newer commit exists. Check its deployment instead.')
        // No duplicate content commit: GitHub Actions rerun needs Actions:write, so
        // provide its official link rather than expanding the publishing token.
        return respond({state:'retry-build',url:'https://github.com/'+REPOSITORY+'/actions',message:'Use Re-run jobs on the failed workflow. No content is submitted again.'})
      }
      let live:any=null
      try{const r=await bounded('https://cyril-fan.top/data/cms-release.json?check='+Date.now());if(r.ok)live=await r.json()}catch{}
      if(live?.release===input.requestId)return respond({state:'live',commitSha:input.commitSha})
      // A later live release also contains this commit when it descends from it.
      if(SHA.test(live?.head||'')){const ancestor=await gh('/compare/'+input.commitSha+'...'+live.head);if(['ahead','identical'].includes(ancestor.status))return respond({state:'live',commitSha:input.commitSha})}
      let deploy=null
      try{const r=await bounded('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/deploy.yml/runs?head_sha='+input.commitSha+'&per_page=3',{headers:{Accept:'application/vnd.github+json'}});if(r.ok){const run=(await r.json()).workflow_runs?.[0];if(run)deploy={status:run.status,conclusion:run.conclusion,url:run.html_url}}}catch{}
      return respond({state:deploy?.status==='completed'&&deploy.conclusion!=='success'?'build-failed':'committed',commitSha:input.commitSha,deploy})
    }
    if(!REQUEST_ID.test(input.requestId)||!SHA.test(input.baseHead)||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>80)throw new HttpError(400,'Invalid publication')
    const changes:Change[]=input.changes,paths=new Set<string>(),hashes=new Map<string,string>()
    for(const change of changes){
      const kind=pathKind(change.path)
      if(!kind||paths.has(change.path)||!(change.baseSha===null||SHA.test(change.baseSha)))throw new HttpError(400,'Invalid or duplicate file: '+change.path)
      paths.add(change.path)
      if(files.get(change.path)&&files.get(change.path)!.mode!=='100644')throw new HttpError(400,'Symlinks and non-regular files cannot be edited')
      if(change.content===null){if([PROFILE,ACADEMIC,'public/links.json'].includes(change.path))throw new HttpError(400,'Fixed pages cannot be deleted; clear their content instead');continue}
      if(typeof change.content!=='string')throw new HttpError(400,'Invalid file content')
      if(kind==='media'){if(change.encoding!=='base64')throw new HttpError(400,'Binary encoding required');const b=decodeBase64(change.content);validateImage(change.path,b);hashes.set(change.path,await gitBlobHash(b))}
      else{if(change.encoding==='base64')throw new HttpError(400,'Text encoding required');validateText(change.path,change.content);hashes.set(change.path,await gitBlobHash(encoder.encode(change.content)))}
    }
    const digest=await gitBlobHash(encoder.encode(JSON.stringify(changes.map(c=>[c.path,c.baseSha,c.content===null?null:hashes.get(c.path)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))))
    // Idempotency is recorded in Git itself, not a second database of content.
    const history=await gh('/commits?path='+encodeURIComponent(RELEASE)+'&per_page=100')
    const previous=history.find((c:any)=>c.commit.message.includes('Content-Request: '+input.requestId+'\n'))
    if(previous){
      if(!previous.commit.message.includes('Content-Digest: '+digest))throw new HttpError(409,'This request ID belongs to different changes')
      return respond({state:'committed',commitSha:previous.sha,requestId:input.requestId,files:changes.map(c=>({path:c.path,sha:c.content===null?null:hashes.get(c.path)}))})
    }
    const conflicts=[]
    for(const c of changes)if((files.get(c.path)?.sha||null)!==c.baseSha)conflicts.push({path:c.path,baseSha:c.baseSha,currentSha:files.get(c.path)?.sha||null,current:files.has(c.path)&&pathKind(c.path)!=='media'?await content(c.path):null})
    if(conflicts.length)throw new HttpError(409,'These files changed on GitHub. Compare and merge before publishing.',conflicts)
    for(const c of changes)if(pathKind(c.path)==='media'&&c.content!==null&&c.baseSha&&c.baseSha!==hashes.get(c.path))throw new HttpError(400,'Replace images using a new content-addressed filename and update references together; existing image bytes are immutable.')
    for(const c of changes.filter(c=>pathKind(c.path)==='media'&&c.content===null)){
      const references=await refs(c.path,changes)
      if(references.length)throw new HttpError(409,'Image is still referenced: '+c.path,references)
    }
    // Require every new local image referenced by a selected file in this commit.
    for(const c of changes.filter(c=>c.content!==null&&c.encoding!=='base64')){
      const matches=[...c.content!.matchAll(/\/media\/[a-zA-Z0-9._-]+\.(?:webp|png|jpe?g|gif|avif)/g)]
      for(const m of matches)if(!files.has('public'+m[0])&&!changes.some(x=>x.path==='public'+m[0]&&x.content!==null))throw new HttpError(400,'Missing image in selected changes: '+m[0])
    }
    const updates=[]
    for(const c of changes){
      if(c.content===null){if(c.baseSha)updates.push({path:c.path,mode:'100644',type:'blob',sha:null});continue}
      if(hashes.get(c.path)===c.baseSha)continue
      const b=await gh('/git/blobs','POST',{content:c.content,encoding:c.encoding==='base64'?'base64':'utf-8'})
      updates.push({path:c.path,mode:'100644',type:'blob',sha:b.sha})
    }
    if(!updates.length)return respond({state:'unchanged',head,files:changes.map(c=>({path:c.path,sha:c.content===null?null:hashes.get(c.path)}))})
    const marker=JSON.stringify({version:2,release:input.requestId,head,digest})+'\n'
    updates.push({path:RELEASE,mode:'100644',type:'blob',content:marker})
    const nextTree=await gh('/git/trees','POST',{base_tree:commit.tree.sha,tree:updates})
    const next=await gh('/git/commits','POST',{message:'Edit website content\n\nContent-Request: '+input.requestId+'\nContent-Digest: '+digest,tree:nextTree.sha,parents:[head]})
    await gh('/git/refs/heads/'+BRANCH,'PATCH',{sha:next.sha,force:false})
    return respond({state:'committed',requestId:input.requestId,commitSha:next.sha,files:changes.map(c=>({path:c.path,sha:c.content===null?null:hashes.get(c.path)}))})
  }catch(e){
    if(e instanceof HttpError)return respond({error:e.message,detail:e.detail},e.status)
    const message=e instanceof Error?e.message:'Unknown error'
    return respond({error:/network|fetch|timeout|abort|socket/i.test(message)?'Connection interrupted. Keep local changes and retry the same submission; do not create a new request.':message},400)
  }
}
Deno.serve(handle)

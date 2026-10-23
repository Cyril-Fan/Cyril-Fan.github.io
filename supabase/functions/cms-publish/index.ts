import { publicFiles, referencedMedia, validateWebp, allowedPath, UUID } from '../_shared/cms.ts'
declare const Deno: { env:{ get(name:string):string|undefined }; serve(handler:(request:Request)=>Promise<Response>):void }

const repo = 'Cyril-Fan/Cyril-Fan.github.io'
const origins = new Set(['https://cyril-fan.top', 'https://www.cyril-fan.top'])
const api = 'https://api.github.com'
const encoder = new TextEncoder()
const decode = (s: string) => Uint8Array.from(atob(s.replace(/\s/g,'')), c => c.charCodeAt(0))
const base64 = (a: Uint8Array) => { let s=''; for(let i=0;i<a.length;i+=8192) s+=String.fromCharCode(...a.subarray(i,i+8192)); return btoa(s) }
const blobHash = async (data: Uint8Array) => {
  const header=encoder.encode(`blob ${data.length}\0`), all=new Uint8Array(header.length+data.length)
  all.set(header);all.set(data,header.length)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1',all))].map(x=>x.toString(16).padStart(2,'0')).join('')
}
type Job = { id: string; state: string; lease: string; documents: any[]; base_documents: any[]; commit_sha?: string; blobs:Record<string,string> }

Deno.serve(async (request: Request) => {
  const origin=request.headers.get('origin') || '', cors: Record<string,string>={ 'Vary':'Origin', 'Cache-Control':'no-store', 'Content-Type':'application/json' }
  if(origins.has(origin)) Object.assign(cors, {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'})
  const response=(value: unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:cors})
  if(origin && !origins.has(origin)) return response({error:'不允许从这个网站访问后台。'},403)
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors})
  if(request.method!=='POST') return response({error:'仅支持 POST。'},405)
  const authorization=request.headers.get('authorization')||''
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization)) return response({error:'请先登录站长账号。'},401)
  const endpoint=Deno.env.get('SUPABASE_URL')!, serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!
  const fetchBounded=(url: string,init: RequestInit={})=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)})
  const rpc=async(name: string,args: unknown,service=false)=>{
    const res=await fetchBounded(`${endpoint}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:service?serviceKey:anon,Authorization:service?`Bearer ${serviceKey}`:authorization,'Content-Type':'application/json'},body:JSON.stringify(args)})
    const data=await res.json()
    if(!res.ok) throw new Error(['cms_publish_busy','cms_lease_lost'].includes(data.message)?'另一项发布操作仍在执行，请稍后刷新。':'后台操作未完成，请刷新后重试。')
    return data
  }
  let job: Job | undefined
  try {
    const me=await rpc('comment_me',{})
    if(me?.is_admin!==true) return response({error:'只有当前已登录的站长可以发布。'},403)
    if(Number(request.headers.get('content-length')||0)>2048) return response({error:'请求过大。'},413)
    const raw=await request.text()
    if(raw.length>2048) return response({error:'请求过大。'},413)
    const input=JSON.parse(raw)
    if(!UUID.test(input.id) || !['publish','status','cancel','redeploy'].includes(input.action)) return response({error:'请求格式不正确。'},400)
    const token=Deno.env.get('CMS_GITHUB_TOKEN')
    if(!token) return response({error:'发布服务尚未配置。草稿已安全保存，暂时不能发布。'},503)
    const gh=async(path: string,method='GET',body?: unknown)=>{
      const res=await fetchBounded(`${api}/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
      if(!res.ok) {
        if(res.status===401||res.status===403) throw new Error('GitHub 发布凭据失效或权限不足，请更新后台发布密钥。')
        if(res.status===409||res.status===422) throw new Error('仓库在发布时发生变化。此次未覆盖，请重试。')
        throw new Error(`GitHub 暂时无法完成操作（${res.status}），请稍后重试。`)
      }
      return res.json()
    }
    if(input.action==='status') {
      const jobs=await rpc('cms_jobs',{}), current=jobs.find((j: any)=>j.id===input.id)
      if(!current) return response({error:'发布记录不存在。'},404)
      if(current.state==='committed') {
        const live=await fetchBounded(`https://cyril-fan.top/data/cms-release.json?check=${Date.now()}`)
        if(live.ok && (await live.json()).release===current.id) {
          await rpc('cms_service_finish',{p_id:current.id,p_lease:null,p_state:'live'},true)
          return response({...current,state:'live'})
        }
        // Public workflow runs require no extra token permission. Do not add
        // Actions:write to a publishing credential merely for progress display.
        const run=await fetchBounded(`${api}/repos/${repo}/actions/workflows/deploy.yml/runs?head_sha=${current.commit_sha}&per_page=3`,{headers:{Accept:'application/vnd.github+json'}})
        if(run.ok) {
          const runs=(await run.json()).workflow_runs||[]
          const latest=runs[0]
          return response({...current,deploy:latest?{status:latest.status,conclusion:latest.conclusion,url:latest.html_url}:null})
        }
      }
      return response(current)
    }
    job=await rpc('cms_service_claim',{p_id:input.id},true)
    if(!job || (['committed','live','cancelled'].includes(job.state) && input.action!=='redeploy')) return response(job)
    if(input.action==='redeploy' && job.state!=='committed') return response({error:'只有已提交、尚未上线的任务可以重新部署。'},400)
    const branch=await gh('/git/ref/heads/main'), head=await gh(`/git/commits/${branch.object.sha}`)
    const tree=await gh(`/git/trees/${head.tree.sha}?recursive=1`)
    if(tree.truncated) throw new Error('仓库文件过多，无法安全核对发布，请联系维护者。')
    const existing=new Map<string,string>(tree.tree.filter((x: any)=>x.type==='blob').map((x: any)=>[x.path,x.sha]))
    const blobText=async(path: string)=>{
      const sha=existing.get(path);if(!sha)return null
      const data=await gh(`/git/blobs/${sha}`)
      if(data.size>16*1024*1024)throw new Error('仓库内容清单过大。')
      return new TextDecoder().decode(decode(data.content))
    }
    const marker=JSON.parse(await blobText('public/data/cms-release.json')||'{}')
    if(input.action==='redeploy') {
      if(marker.release!==job.id) return response({error:'仓库中已有较新的发布，请查看最新任务。'},409)
      const retry=await gh('/git/commits','POST',{message:`Retry site deployment\n\nCMS-Release: ${job.id}`,tree:head.tree.sha,parents:[branch.object.sha]})
      await gh('/git/refs/heads/main','PATCH',{sha:retry.sha,force:false})
      await rpc('cms_service_redeploy',{p_id:job.id,p_sha:retry.sha},true)
      return response({id:job.id,state:'committed',commit_sha:retry.sha})
    }
    if(marker.release===job.id) {
      // Recover a completed Git update after a network timeout or Edge restart.
      await rpc('cms_service_finish',{p_id:job.id,p_lease:job.lease,p_state:'committed',p_sha:branch.object.sha},true)
      return response({id:job.id,state:'committed',commit_sha:branch.object.sha})
    }
    if(input.action==='cancel') {
      await rpc('cms_service_finish',{p_id:job.id,p_lease:job.lease,p_state:'cancelled'},true)
      return response({id:job.id,state:'cancelled'})
    }
    const before=publicFiles(job.base_documents,marker.release||'initial'), after=publicFiles(job.documents,job.id)
    const changes: any[]=[]
    for(const path of new Set([...before.keys(),...after.keys()])) {
      if(!allowedPath(path))throw new Error('发布包含不允许修改的文件。')
      if(before.get(path)===after.get(path))continue
      const expected=before.has(path)?await blobHash(encoder.encode(before.get(path)!)):undefined
      if(existing.get(path)!==expected)throw new Error(`仓库中的 ${path} 已被其他方式修改。为保留这些修改，本次发布已停止。`)
      changes.push(after.has(path)?{path,mode:'100644',type:'blob',content:after.get(path)}:{path,mode:'100644',type:'blob',sha:null})
    }
    // A manifest mismatch must be caught even if another field happens to be unchanged.
    const stored=await blobText('src/data/cms-published.json')
    if(stored!==before.get('src/data/cms-published.json')) throw new Error('仓库内容与后台已发布版本不一致。请先核对外部修改。')
    const mediaIds=referencedMedia(job.documents)
    if(mediaIds.length>300)throw new Error('本次公开内容引用的图片超过 300 张，请分批整理。')
    const unstaged=mediaIds.filter(id=>!existing.has(`public/media/${id}.webp`)&&!job!.blobs[id])
    const staged={...job.blobs}
    for(const id of unstaged.slice(0,3)) {
      const path=`public/media/${id}.webp`
      if(existing.has(path))continue
      const media=await fetchBounded(`${endpoint}/storage/v1/object/authenticated/cms-media/${id}.webp`,{headers:{apikey:anon,Authorization:authorization}})
      if(!media.ok)throw new Error('某张图片尚未上传完成或无法读取，请在图片库检查后重试。')
      if(Number(media.headers.get('content-length')||0)>4194304)throw new Error('图片超过大小限制。')
      const bytes=new Uint8Array(await media.arrayBuffer());validateWebp(bytes)
      const blob=await gh('/git/blobs','POST',{encoding:'base64',content:base64(bytes)})
      staged[id]=blob.sha
    }
    if(unstaged.length>3) {
      await rpc('cms_service_stage',{p_id:job.id,p_lease:job.lease,p_blobs:staged},true)
      return response({id:job.id,state:'queued',remaining:unstaged.length-3})
    }
    for(const id of mediaIds) if(!existing.has(`public/media/${id}.webp`)) changes.push({path:`public/media/${id}.webp`,mode:'100644',type:'blob',sha:staged[id]})
    // Only assets no longer referenced by any published document are removed.
    for(const id of referencedMedia(job.base_documents).filter(id=>!mediaIds.includes(id))) {
      const path=`public/media/${id}.webp`;if(existing.has(path))changes.push({path,mode:'100644',type:'blob',sha:null})
    }
    if(changes.some(x=>!allowedPath(x.path)))throw new Error('发布文件范围不正确。')
    const newTree=await gh('/git/trees','POST',{base_tree:head.tree.sha,tree:changes})
    const commit=await gh('/git/commits','POST',{message:`Publish site content\n\nCMS-Release: ${job.id}`,tree:newTree.sha,parents:[branch.object.sha]})
    await gh('/git/refs/heads/main','PATCH',{sha:commit.sha,force:false})
    await rpc('cms_service_finish',{p_id:job.id,p_lease:job.lease,p_state:'committed',p_sha:commit.sha},true)
    return response({id:job.id,state:'committed',commit_sha:commit.sha})
  } catch(error) {
    const message=error instanceof SyntaxError?'请求格式不正确。':error instanceof Error && !/fetch|network|timeout|abort/i.test(error.message)?error.message:'连接中断。草稿和发布记录已保留，请刷新状态或重试同一任务。'
    if(job?.lease) try { await rpc('cms_service_finish',{p_id:job.id,p_lease:job.lease,p_state:'failed',p_error:message},true) } catch { /* Preserve the original, non-secret error. */ }
    return response({error:message},400)
  }
})

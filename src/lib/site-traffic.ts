type Stats = { total:string; started_at:string }
type Options = { url:string; key:string; production:boolean; fetcher?:typeof fetch }

/** A tiny anonymous client: never initialize Auth or read its persisted session. */
export function publicStatsConfig(url:string, key:string): boolean {
  try {
    const endpoint = new URL(url)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') return false
    if (key.startsWith('sb_publishable_')) return key.length > 15
    const payload = key.split('.')[1]
    const normalized = payload.replace(/-/g,'+').replace(/_/g,'/')
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='))).role === 'anon'
  } catch { return false }
}

export function parseSiteStats(value:unknown): Stats | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string,unknown>
  if (typeof data.total !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(data.total) || BigInt(data.total)>9223372036854775807n) return null
  if (typeof data.started_at !== 'string' || !Number.isFinite(Date.parse(data.started_at))) return null
  return { total:data.total, started_at:data.started_at }
}

export function installSiteTraffic({url,key,production,fetcher=fetch}:Options): () => void {
  if (!production || !['cyril-fan.top','www.cyril-fan.top'].includes(location.hostname) || !publicStatsConfig(url,key)) return () => {}
  const controller = new AbortController()
  const {signal} = controller
  const display = document.querySelector<HTMLElement>('[data-site-visits]')
  const number = display?.querySelector<HTMLElement>('[data-visit-total]')
  const english = document.documentElement.lang === 'en'
  let requestId = crypto.randomUUID()
  let counted = false
  let pending = false
  let generation = 0
  let lastRead = 0
  const endpoint = url.replace(/\/$/,'') + '/rest/v1/rpc/'
  const rpc = async (name:string, body:Record<string,string>) => {
    const response = await fetcher(endpoint+name, {
      method:'POST', headers:{apikey:key,...(!key.startsWith('sb_publishable_')?{Authorization:`Bearer ${key}`}:{}) ,'Content-Type':'application/json'},
      body:JSON.stringify(body), credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',
      signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])
    })
    if (!response.ok) throw new Error('Page-view service unavailable')
    const data = parseSiteStats(await response.json())
    if (!data) throw new Error('Invalid page-view response')
    return data
  }
  const render = (data:Stats) => {
    if (!display || !number) return
    number.textContent = new Intl.NumberFormat(english?'en-US':'zh-CN').format(BigInt(data.total))
    const since = new Intl.DateTimeFormat(english?'en-GB':'zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(data.started_at))
    display.title = english ? `Site-wide page views since ${since}. Repeated visits count; this is not a unique visitor count.` : `自 ${since} 起的全站页面访问次数；重复访问会累计，不代表独立访客人数。`
    display.hidden = false
  }
  const update = async () => {
    if (document.visibilityState!=='visible' || pending || signal.aborted) return
    if (counted && (!display || Date.now()-lastRead<60000)) return
    pending = true
    const currentGeneration = generation
    try {
      let stats:Stats
      if (!counted) {
        // A lost response can be retried once with the same id, never counted twice.
        try { stats = await rpc('record_page_view',{p_request_id:requestId}) }
        catch {
          if (signal.aborted || document.visibilityState!=='visible') return
          stats = await rpc('record_page_view',{p_request_id:requestId})
        }
        if (generation!==currentGeneration) return
        counted = true
      } else stats = await rpc('read_site_stats',{})
      if (generation!==currentGeneration || signal.aborted) return
      lastRead = Date.now()
      render(stats)
    } catch {
      // Never display a fabricated zero or an error banner in the page layout.
      if (display && !display.hidden) display.title = english ? 'The count could not refresh; showing the last available total.' : '暂时无法刷新，显示上次读取的访问次数。'
    } finally { pending = false }
  }
  const timer = window.setInterval(() => { void update() },60000)
  signal.addEventListener('abort',()=>window.clearInterval(timer),{once:true})
  document.addEventListener('visibilitychange',()=>{void update()},{signal})
  window.addEventListener('pageshow',event=>{
    if (event.persisted) { generation++; requestId=crypto.randomUUID(); counted=false; lastRead=0 }
    void update()
  },{signal})
  void update()
  return () => controller.abort()
}

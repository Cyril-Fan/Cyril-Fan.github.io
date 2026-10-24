import { refreshBrowserFeeds, type FeedData } from './friend-feed-client'
/** Automatic checks read only our published snapshot. Never replace the open discussion or an
 * author's dialog while someone is reading or composing a comment. */
export function watchFriendFeed(host: HTMLElement, signal: AbortSignal, initial?:FeedData, apply?:(data:FeedData)=>void) {
  let checking = false, lastCheck = 0
  let current=initial
  let inFlight=Promise.resolve(),finish:()=>void=()=>{}
  const refresh = async (manual = false) => {
    if(manual&&checking)await inFlight
    if (document.hidden || signal.aborted || checking || (!manual && Date.now() - lastCheck < 10 * 60 * 1000)) return 'busy'
    checking = true; lastCheck = Date.now()
    inFlight=new Promise(resolve=>finish=resolve)
    try {
      if(manual&&current&&apply){
        const updated=await refreshBrowserFeeds(current,signal)
        const changed=JSON.stringify(current.feeds.map(f=>f.articles))!==JSON.stringify(updated.feeds.map(f=>f.articles))
        current=updated;apply(updated)
        const notice=host.querySelector<HTMLElement>('[data-feed-update]');if(notice)notice.hidden=true
        return updated.feeds.some(f=>f.status==='unavailable')?'partial':changed?'updated':'current'
      }
      const response = await fetch('/data/friend-feeds.json', { cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', redirect:'error',
        signal:AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      if (!response.ok || !response.body) return 'unavailable'
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let text = '', size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 2_000_000) throw new Error('Feed snapshot too large')
          text += decoder.decode(value, { stream:true })
        }
        text += decoder.decode()
      } finally { await reader.cancel() }
      const data = JSON.parse(text)
      if (signal.aborted || data?.version !== 1 || !/^[a-f0-9]{64}$/.test(data.revision) ||
          !Number.isFinite(Date.parse(data.checkedAt)) || Date.parse(data.checkedAt) > Date.now() + 300000) return 'unavailable'
      if (Date.parse(data.checkedAt) <= Date.parse(host.dataset.checked || '') || data.revision === host.dataset.revision) return 'current'
      const notice = host.querySelector<HTMLElement>('[data-feed-update]')
      const link = notice?.querySelector<HTMLAnchorElement>('a')
      if (!notice || !link) return 'unavailable'
      const url = new URL(location.href)
      url.search = ''; url.searchParams.set('feed', data.revision.slice(0,16)); url.hash = 'small-circle'
      link.href = url.href
      notice.hidden = false
      return 'updated'
    } catch { return 'unavailable' /* Preserve the currently visible feed. */ }
    finally { checking = false; finish() }
  }
  void refresh()
  const timer = window.setInterval(() => void refresh(), 10 * 60 * 1000)
  signal.addEventListener('abort', () => window.clearInterval(timer), { once:true })
  document.addEventListener('visibilitychange', () => void refresh(), { signal })
  return refresh
}

import { refreshBrowserFeeds, type FeedData } from './friend-feed-client'

const CHECK_INTERVAL = 10 * 60 * 1000
type Result = 'updated' | 'current' | 'partial' | 'unavailable' | 'busy'

export function watchFriendFeed(host: HTMLElement, signal: AbortSignal, initial: FeedData, apply: (data: FeedData) => void) {
  let current = initial
  let nextCheck = 0
  let timer: number | undefined
  let inFlight: Promise<Result> | undefined
  let nearFeed = typeof IntersectionObserver !== 'function'

  const check = async (): Promise<Result> => {
    try {
      const updated = await refreshBrowserFeeds(current, signal)
      if (signal.aborted) return 'unavailable'
      const changed = JSON.stringify(current.feeds.map(feed => feed.articles)) !==
        JSON.stringify(updated.feeds.map(feed => feed.articles))
      current = updated
      apply(updated)
      if (updated.feeds.some(feed => feed.status === 'unavailable')) return 'partial'
      return changed ? 'updated' : 'current'
    } catch {
      return 'unavailable'
    }
  }

  const refresh = (manual = false): Promise<Result> => {
    if (signal.aborted || document.hidden) return Promise.resolve('busy')
    if (inFlight) return inFlight
    if (!manual && (!nearFeed || Date.now() < nextCheck)) return Promise.resolve('busy')
    nextCheck = Date.now() + CHECK_INTERVAL
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void refresh(), CHECK_INTERVAL)
    inFlight = check().finally(() => { inFlight = undefined })
    return inFlight
  }

  if (!nearFeed) {
    const observer = new IntersectionObserver(([entry]) => {
      nearFeed = entry.isIntersecting
      if (nearFeed) void refresh()
    }, { rootMargin: '240px 0px' })
    observer.observe(host)
    signal.addEventListener('abort', () => observer.disconnect(), { once: true })
  } else {
    void refresh()
  }
  signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true })
  document.addEventListener('visibilitychange', () => void refresh(), { signal })
  window.addEventListener('pageshow', () => void refresh(), { signal })
  window.addEventListener('online', () => {
    nextCheck = 0
    void refresh()
  }, { signal })
  return refresh
}

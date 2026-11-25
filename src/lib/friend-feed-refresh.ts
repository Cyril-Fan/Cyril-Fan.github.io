import { refreshBrowserFeeds, type FeedData } from './friend-feed-client'

type Result = 'updated' | 'current' | 'partial' | 'unavailable'

export function watchFriendFeed(host: HTMLElement, signal: AbortSignal, initial: FeedData, apply: (data: FeedData) => void) {
  let current = initial
  let observer: IntersectionObserver | undefined
  let inFlight: Promise<Result> | undefined

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

  const refresh = (): Promise<Result> => {
    if (signal.aborted) return Promise.resolve('unavailable')
    observer?.disconnect()
    observer = undefined
    return inFlight ??= check().finally(() => { inFlight = undefined })
  }

  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => {
      if (observer && entries.some(entry => entry.isIntersecting)) void refresh()
    }, { rootMargin: '240px 0px' })
    observer.observe(host)
    signal.addEventListener('abort', () => observer?.disconnect(), { once: true })
  } else {
    void refresh()
  }
  return refresh
}

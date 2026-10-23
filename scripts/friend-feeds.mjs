import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { parse } from 'node-html-parser'

const MAX_BYTES = 4 * 1024 * 1024
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const value = item => typeof item === 'string' ? item : typeof item?.['#text'] === 'string' ? item['#text'] : ''

export function articleUrl(input, base) {
  try {
    if (typeof input !== 'string' || !input.trim()) return null
    const url = new URL(input, base)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    if (url.hostname === 'localhost' || !url.hostname.includes('.') || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.includes(':')) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function normalizeArticles(items, friend, now = Date.now()) {
  const seen = new Set()
  return items.flatMap(item => {
    const link = articleUrl(item.link, friend.link)
    const title = parse(String(item.title || '').slice(0, 2000)).textContent.replace(/\s+/g, ' ').trim().slice(0, 300)
    const date = Date.parse(item.date)
    if (!link || !title || !Number.isFinite(date) || date > now + 86400000 || seen.has(link)) return []
    seen.add(link)
    return [{ title, link, date: new Date(date).toISOString(), source: friend.link }]
  }).sort((a, b) => b.date.localeCompare(a.date) || a.link.localeCompare(b.link)).slice(0, 40)
}

export function parseFeed(xml, friend, now = Date.now()) {
  if (Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsafe or oversized feed')
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid XML feed')
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true, maxNestedTags: 32 }).parse(xml)
  let items
  if (Object.hasOwn(doc.rss ?? {}, 'channel')) items = list(doc.rss.channel?.item).map(item => ({ title: value(item.title), link: value(item.link), date: value(item.pubDate) || value(item.date) }))
  else if (Object.hasOwn(doc, 'feed')) items = list(doc.feed?.entry).map(item => ({
    title: value(item.title),
    link: list(item.link).find(link => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href'],
    date: value(item.published) || value(item.updated)
  }))
  else if (doc.RDF) items = list(doc.RDF.item).map(item => ({ title: value(item.title), link: value(item.link), date: value(item.date) }))
  else throw new Error('Unsupported feed document')
  return normalizeArticles(items, friend, now)
}

/** Only operator-configured feeds are fetched, without credentials or cross-host redirects. */
export async function fetchFeed(url, fetcher = fetch) {
  const initial = new URL(url)
  if (initial.protocol !== 'https:' || !articleUrl(url)) throw new Error('Invalid feed URL')
  let current = initial
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(current, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'Cyril-Fan-Blogroll/1.0 (+https://cyril-fan.top/links)' } })
    if (response.status >= 300 && response.status < 400) {
      const target = new URL(response.headers.get('location') || '', current)
      await response.body?.cancel()
      if (target.protocol !== 'https:' || target.port !== initial.port || target.hostname.replace(/^www\./, '') !== initial.hostname.replace(/^www\./, '') || target.username || target.password) throw new Error('Cross-host feed redirect')
      current = target
      continue
    }
    if (!response.ok || !response.body) throw new Error(`Feed HTTP ${response.status}`)
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > MAX_BYTES) throw new Error('Oversized feed')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel() }
    return Buffer.concat(chunks).toString('utf8')
  }
  throw new Error('Too many feed redirects')
}

export async function refreshFriendFeeds(friends, previous = {}, { fetcher = fetch, now = Date.now() } = {}) {
  const checkedAt = new Date(now).toISOString()
  const results = await Promise.all(friends.map(async friend => {
    const prior = previous.feeds?.find(feed => feed.source === friend.link && feed.feed === friend.feed)
    if (!friend.feed) return { source: friend.link, status: 'unconfigured', articles: [] }
    try {
      const articles = parseFeed(await fetchFeed(friend.feed, fetcher), friend, now)
      return { source: friend.link, feed: friend.feed, status: 'ok', lastSuccessAt: checkedAt, articles }
    } catch {
      return { source: friend.link, feed: friend.feed, status: 'unavailable', lastSuccessAt: prior?.lastSuccessAt ?? null,
        articles: normalizeArticles(prior?.articles ?? [], friend, now) }
    }
  }))
  return { version: 1, checkedAt, feeds: results }
}

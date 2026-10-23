import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { refreshFriendFeeds, mergeFriendSnapshots, fetchPublishedFriendSnapshot } from './friend-feeds.mjs'

const root = new URL('../', import.meta.url)
const friends = JSON.parse(await readFile(new URL('public/links.json', root), 'utf8')).friends.flatMap(group => group.link_list)
const output = new URL('src/assets/friend-feeds.json', root)
let previous = {}
try { previous = JSON.parse(await readFile(output, 'utf8')) } catch { /* First build has no snapshot. */ }
let published = {}
try { published = await fetchPublishedFriendSnapshot() }
catch { console.warn('[friends] Published snapshot unavailable; retaining local fallback where available.') }
previous = mergeFriendSnapshots(friends, previous, published)
const data = await refreshFriendFeeds(friends, previous)
// Article identity, not the hourly check time: unchanged feeds never nag readers.
data.revision = createHash('sha256').update(JSON.stringify(data.feeds.map(feed => ({ source:feed.source, articles:feed.articles })))).digest('hex')
await writeFile(output, `${JSON.stringify(data, null, 2)}\n`)
await mkdir(new URL('public/data/', root), { recursive:true })
await writeFile(new URL('public/data/friend-feeds.json', root), `${JSON.stringify(data)}\n`)
console.log(`[friends] ${data.feeds.filter(feed => feed.status === 'ok').length}/${friends.filter(friend => friend.feed).length} feeds refreshed; ${data.feeds.reduce((total, feed) => total + feed.articles.length, 0)} recent articles.`)
for (const feed of data.feeds.filter(feed => feed.status === 'unavailable')) console.warn(`[friends] Retained available snapshot for ${feed.source}`)

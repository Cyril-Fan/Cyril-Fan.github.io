import { readFile, writeFile } from 'node:fs/promises'
import { refreshFriendFeeds } from './friend-feeds.mjs'

const root = new URL('../', import.meta.url)
const friends = JSON.parse(await readFile(new URL('public/links.json', root), 'utf8')).friends.flatMap(group => group.link_list)
const output = new URL('src/assets/friend-feeds.json', root)
let previous = {}
try { previous = JSON.parse(await readFile(output, 'utf8')) } catch { /* First build has no snapshot. */ }
const data = await refreshFriendFeeds(friends, previous)
await writeFile(output, `${JSON.stringify(data, null, 2)}\n`)
console.log(`[friends] ${data.feeds.filter(feed => feed.status === 'ok').length}/${friends.filter(friend => friend.feed).length} feeds refreshed; ${data.feeds.reduce((total, feed) => total + feed.articles.length, 0)} recent articles.`)
for (const feed of data.feeds.filter(feed => feed.status === 'unavailable')) console.warn(`[friends] Retained available snapshot for ${feed.source}`)

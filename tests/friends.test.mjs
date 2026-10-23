import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { articleUrl, parseFeed, refreshFriendFeeds, fetchFeed } from '../scripts/friend-feeds.mjs'
const now = Date.parse('2026-10-23T12:00:00Z')
const friend = { name:'Friend', link:'https://example.com/', feed:'https://example.com/rss.xml' }
const rss = '<rss><channel><item><title>A &amp; B</title><link>https://example.com/post</link><pubDate>2026-10-20</pubDate></item></channel></rss>'
const typescriptModule = async file => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(readFileSync(new URL(file, import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'))
const { sortFriends } = await typescriptModule('../src/lib/friends.ts')
const { commentThread } = await typescriptModule('../src/lib/comment-utils.ts')

test('dictionary order is stable, locale-independent and does not mutate configuration', () => {
  const names = ['VYS3N','Roy Zhao','Leonwater','Axi']
  const input = Object.freeze(names.map((name,i)=>Object.freeze({name,link:`https://example.com/${i}`})))
  assert.deepEqual(sortFriends(input).map(f=>f.name),['Axi','Leonwater','Roy Zhao','VYS3N'])
  assert.deepEqual(input.map(f=>f.name),names)
  assert.deepEqual(sortFriends([...input].reverse()),sortFriends(input))
})
test('both languages use one links discussion without changing about and blog threads', () => {
  for(const path of ['/links','/links/','/en/links/','/en/links?from=friend#comments']) assert.equal(commentThread(path),'/links')
  assert.equal(commentThread('/en/about/'),'/about')
  assert.equal(commentThread('/en/blog/note/'),'/blog/note')
  assert.throws(()=>commentThread('/links/other'))
})
test('RSS and Atom normalize text, dates and safe links', () => {
  assert.deepEqual(parseFeed(rss,friend,now),[{title:'A & B',link:'https://example.com/post',date:'2026-10-20T00:00:00.000Z',source:friend.link}])
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title><![CDATA[<b>Research</b> notes]]></title><link rel="self" href="/api"/><link rel="alternate" href="/notes"/><published>2026-10-21T08:00:00+08:00</published></entry></feed>'
  assert.equal(parseFeed(atom,friend,now)[0].title,'Research notes')
  assert.equal(parseFeed(atom,friend,now)[0].link,'https://example.com/notes')
  assert.deepEqual(parseFeed('<rss><channel/></rss>',friend,now),[])
})
test('malicious links, entities and malformed feeds fail safely', () => {
  for(const link of ['',undefined,'javascript:alert(1)','data:text/html,x','file:///tmp/x','https://u:p@example.com','http://127.0.0.1/x']) assert.equal(articleUrl(link,friend.link),null)
  assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss,friend,now))
  assert.throws(()=>parseFeed('<rss><channel>',friend,now))
  assert.throws(()=>parseFeed('<html><body>Not a feed</body></html>',friend,now))
  const bad = '<rss><channel><item><title>Missing URL</title><pubDate>2026-10-20</pubDate></item><item><title>X</title><link>javascript:x</link><pubDate>2026-10-20</pubDate></item></channel></rss>'
  assert.deepEqual(parseFeed(bad,friend,now),[])
})
test('cross-host redirects are blocked; failures preserve only the configured feed snapshot',async()=>{
  await assert.rejects(fetchFeed(friend.feed,async()=>new Response(null,{status:302,headers:{location:'http://localhost/private'}})))
  const prior={feeds:[{source:friend.link,feed:friend.feed,lastSuccessAt:'2026-10-20T00:00:00Z',articles:parseFeed(rss,friend,now)}]}
  const failed=await refreshFriendFeeds([friend],prior,{now,fetcher:async()=>{throw Error('offline')}})
  assert.equal(failed.feeds[0].status,'unavailable')
  assert.equal(failed.feeds[0].articles.length,1)
  const changed=await refreshFriendFeeds([{...friend,feed:'https://example.com/new.xml'}],prior,{now,fetcher:async()=>{throw Error('offline')}})
  assert.equal(changed.feeds[0].articles.length,0)
  const ok=await refreshFriendFeeds([friend],prior,{now,fetcher:async()=>new Response('<rss><channel/></rss>')})
  assert.equal(ok.feeds[0].status,'ok')
  assert.deepEqual(ok.feeds[0].articles,[])
})

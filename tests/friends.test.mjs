import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { articleUrl, parseFeed, refreshFriendFeeds, fetchFeed, mergeFriendSnapshots, fetchPublishedFriendSnapshot } from '../scripts/friend-feeds.mjs'
import { JSDOM } from 'jsdom'
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

test('fallback restoration picks the last successful per-feed data, not a later failed check',async()=>{
  const old={checkedAt:'2026-10-23T10:00:00Z',feeds:[{source:friend.link,feed:friend.feed,lastSuccessAt:'2026-10-20T00:00:00Z',articles:parseFeed(rss,friend,now)}]}
  const recent={checkedAt:'2026-10-22T12:00:00Z',feeds:[{source:friend.link,feed:friend.feed,lastSuccessAt:'2026-10-22T00:00:00Z',articles:[{title:'New post',link:'https://example.com/new',date:'2026-10-22',source:friend.link}]}]}
  const previous=mergeFriendSnapshots([friend],old,recent,now)
  const failed=await refreshFriendFeeds([friend],previous,{now,fetcher:async()=>{throw Error('offline')}})
  assert.equal(failed.feeds[0].articles[0].title,'New post')
  assert.equal(failed.feeds[0].lastSuccessAt,'2026-10-22T00:00:00Z')
  assert.equal(failed.feeds[0].status,'unavailable')
  assert.equal(mergeFriendSnapshots([{...friend,feed:'https://example.com/changed.xml'}],old,recent,now).feeds[0].articles.length,0)
  recent.feeds[0].lastSuccessAt='2099-01-01'
  assert.equal(mergeFriendSnapshots([friend],old,recent,now).feeds[0].articles[0].title,'A & B')
})

test('published feed restore is bounded, credential-free and fails safely on invalid documents',async()=>{
  const data=await fetchPublishedFriendSnapshot({fetcher:async(url,options)=>{
    assert.equal(url,'https://cyril-fan.top/data/friend-feeds.json');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error')
    return new Response(JSON.stringify({version:1,feeds:[]}))
  }})
  assert.deepEqual(data.feeds,[])
  await assert.rejects(fetchPublishedFriendSnapshot({fetcher:async()=>new Response(JSON.stringify({feeds:[]}))}))
  await assert.rejects(fetchPublishedFriendSnapshot({fetcher:async()=>new Response('x'.repeat(2_000_001))}))
})

test('a visible feed announces changed articles without replacing dialogs, pagination or comment drafts',async context=>{
  const dom=new JSDOM('<friend-feed data-revision="'+ 'a'.repeat(64)+'" data-checked="2026-10-20T00:00:00Z"><p data-feed-update hidden><a target="_blank"></a></p><dialog open>Current author</dialog><article data-feed-article>Current article</article></friend-feed><textarea>Keep my draft</textarea>',{url:'https://cyril-fan.top/links/',runScripts:'outside-only',pretendToBeVisual:true})
  context.after(()=>dom.window.close())
  const w=dom.window, host=w.document.querySelector('friend-feed')
  w.TextDecoder=TextDecoder;w.AbortSignal.any=()=>new w.AbortController().signal;w.AbortSignal.timeout=()=>new w.AbortController().signal
  let scheduled, ticks=0, revision='a'.repeat(64), requests=0
  w.Date.now=()=>Date.parse('2026-10-23T12:00:00Z')+ticks
  w.setInterval=fn=>{scheduled=fn;return 1};w.clearInterval=()=>{}
  w.fetch=async()=>{requests++;return new Response(JSON.stringify({version:1,revision,checkedAt:'2026-10-23T11:00:00Z'}))}
  const module={exports:{}}
  const code=ts.transpileModule(readFileSync(new URL('../src/lib/friend-feed-refresh.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  w.Function('module','exports',code)(module,module.exports)
  const controller=new w.AbortController();module.exports.watchFriendFeed(host,controller.signal)
  const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();await new Promise(setImmediate)}
  await settle();assert.equal(host.querySelector('[data-feed-update]').hidden,true,'A new check time alone is not an update')
  revision='b'.repeat(64);ticks+=600001;scheduled();await settle()
  assert.equal(host.querySelector('[data-feed-update]').hidden,false)
  assert.match(host.querySelector('a').href,/\?feed=b{16}#small-circle$/)
  assert.equal(host.querySelector('dialog').open,true)
  assert.equal(host.querySelector('article').textContent,'Current article')
  assert.equal(w.document.querySelector('textarea').value,'Keep my draft')
  Object.defineProperty(w.document,'hidden',{configurable:true,value:true});ticks+=600001;scheduled();await settle()
  assert.equal(requests,2,'Background tabs do not poll')
  controller.abort()
})

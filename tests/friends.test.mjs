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
const browserModule=(w,file,imports={})=>{
 const module={exports:{}}
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 w.Function('module','exports','require',code)(module,module.exports,name=>{if(name in imports)return imports[name];throw Error(name)})
 return module.exports
}

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
  const client=browserModule(w,'../src/lib/friend-feed-client.ts'),refresh=browserModule(w,'../src/lib/friend-feed-refresh.ts',{'./friend-feed-client':client})
  const controller=new w.AbortController();refresh.watchFriendFeed(host,controller.signal)
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

test('server and browser retain all supplied RSS entries beyond the former 40-item cap',t=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.TextEncoder=TextEncoder
 const client=browserModule(dom.window,'../src/lib/friend-feed-client.ts')
 const xml='<rss><channel>'+Array.from({length:113},(_,i)=>`<item><title>Post ${i}</title><link>https://example.com/${i}</link><pubDate>2026-10-20</pubDate></item>`).join('')+'</channel></rss>'
 assert.equal(parseFeed(xml,friend,now).length,113)
 assert.deepEqual(JSON.parse(JSON.stringify(client.parseBrowserFeed(xml,friend,now))),parseFeed(xml,friend,now))
 assert.throws(()=>client.parseBrowserFeed('<!DOCTYPE rss>'+rss,friend,now))
 assert.throws(()=>client.parseBrowserFeed('<rss><channel>',friend,now))
 assert.equal(client.parseBrowserFeed(rss.replace('https://example.com/post','javascript:alert(1)'),friend,now).length,0)
 assert.equal(client.parseBrowserFeed(rss.replace('https://example.com/post',''),friend,now).length,0)
})

test('manual refresh really requests configured feeds, updates counts/time and preserves failed-source posts',async t=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.AbortSignal.any=()=>new w.AbortController().signal;w.AbortSignal.timeout=()=>new w.AbortController().signal
 const client=browserModule(w,'../src/lib/friend-feed-client.ts'),second={name:'Second',link:'https://second.example/',feed:'https://second.example/rss.xml',avatar:'/avatar.png'}
 const primary={...friend,avatar:'/avatar.png'},previous={friends:[primary],checkedAt:'2026-10-20',feeds:[{source:second.link,feed:second.feed,status:'ok',lastSuccessAt:'2026-10-21',articles:[{title:'Retained',link:second.link+'post',date:'2026-10-21',source:second.link},{title:'Bad',link:'javascript:alert(1)',date:'2026-10-21',source:second.link}]}]}
 const urls=[],fetcher=async(url,options)=>{urls.push(url);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error')
  if(url==='/links.json')return new Response(JSON.stringify({friends:[{link_list:[primary,second]}]}))
  if(url==='/data/friend-feeds.json')throw Error('Snapshot offline')
  if(url===primary.feed)return new Response(rss)
  throw Error('CORS unavailable')
 }
 const result=await client.refreshBrowserFeeds(previous,new w.AbortController().signal,fetcher)
 assert.ok(urls.includes(primary.feed)&&urls.includes(second.feed));assert.equal(result.friends.length,2)
 assert.equal(result.feeds[0].status,'ok');assert.equal(result.feeds[0].articles.length,1)
 assert.equal(result.feeds[1].status,'unavailable');assert.equal(result.feeds[1].articles.length,1)
 assert.equal(result.feeds[1].articles[0].title,'Retained');assert.ok(Date.parse(result.checkedAt)>Date.parse(previous.checkedAt))
 await assert.rejects(()=>client.refreshBrowserFeeds(previous,new w.AbortController().signal,async()=>{throw Error('Offline')}))
 assert.equal(previous.feeds[0].articles.length,2,'Input snapshot remains untouched')
})

test('manual feed UI refresh replaces only reading rows and restores pagination feedback after 3.5 seconds',async t=>{
 const initial={friends:[{...friend,avatar:'/avatar.png'}],feeds:[],checkedAt:'2026-10-20'}
 const dom=new JSDOM(`<friend-feed data-lang="zh"><script data-feed-data type="application/json">${JSON.stringify(initial)}</script><template data-feed-row><article data-feed-article><button class="feed-author"><img><span></span></button><a class="feed-title"></a><time></time></article></template><button data-random-refresh>随便读读</button><button data-check-update>刷新</button><section data-random-panel hidden><a data-random-title></a><span data-random-meta></span><button data-close-random></button></section><div class="feed-articles"></div><button data-load-more></button><p data-feed-status></p><span data-feed-counts></span><span data-feed-checked><time></time></span><span data-feed-stale></span><dialog><h3 id="feed-author-title"></h3><a data-author-site></a><ul data-author-articles></ul></dialog></friend-feed><textarea>Unsubmitted comment</textarea>`,{url:'https://cyril-fan.top/links/',runScripts:'outside-only'})
 t.after(()=>dom.window.close());const w=dom.window;let timer
 w.setTimeout=(fn,ms)=>{assert.equal(ms,3500);timer=fn;return 1};w.clearTimeout=()=>{}
 const updated={...initial,checkedAt:'2026-10-24T16:02:01Z',feeds:[{source:friend.link,status:'ok',articles:parseFeed(rss,friend,now)}]}
 const refresh={watchFriendFeed:(_host,_signal,_data,apply)=>async()=>{apply(updated);return 'updated'}}
 const source=readFileSync(new URL('../src/components/links/FriendFeed.astro',import.meta.url),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 w.Function('require','exports',js)(()=>refresh,{})
 const host=w.document.querySelector('friend-feed');host.querySelector('[data-check-update]').click();await new Promise(setImmediate)
 assert.equal(host.querySelectorAll('[data-feed-article]').length,1);assert.match(host.querySelector('[data-feed-status]').textContent,/已更新/)
 assert.equal(host.querySelector('time').dateTime,'2026-10-20T00:00:00.000Z');assert.equal(host.querySelector('[data-feed-checked] time').dateTime,updated.checkedAt)
 assert.match(host.querySelector('[data-feed-counts]').textContent,/1 位朋友 · 1 个订阅可用/)
 timer();assert.match(host.querySelector('[data-feed-status]').textContent,/已显示 1 \/ 1/)
 host.querySelector('[data-random-refresh]').click();assert.equal(host.querySelector('[data-random-panel]').hidden,false)
 assert.equal(host.querySelector('[data-random-panel]').textContent.includes('随便读读'),false)
 assert.equal(w.document.querySelector('textarea').value,'Unsubmitted comment')
})

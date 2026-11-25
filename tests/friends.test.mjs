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

for(const lang of ['zh','en'])test(`exchange copy feedback expires, resets on repeat and preserves failures (${lang})`,async t=>{
 const dom=new JSDOM(`<link-exchange data-lang="${lang}"><button data-copy="https://cyril-fan.top/">Link</button><p data-copy-status></p></link-exchange>`,{url:'https://cyril-fan.top/links/',runScripts:'outside-only'})
 t.after(()=>dom.window.close());const w=dom.window,pending=[],timers=new Map();let sequence=0
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:text=>{assert.equal(text,'https://cyril-fan.top/');return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}})
 w.setTimeout=(fn,ms)=>{assert.equal(ms,3000);timers.set(++sequence,fn);return sequence};w.clearTimeout=id=>timers.delete(id)
 const source=readFileSync(new URL('../src/components/links/LinkExchange.astro',import.meta.url),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const feedback=browserModule(w,'../src/lib/ui-feedback.ts')
 w.Function('require','exports',js)(()=>feedback,{})
 const host=w.document.querySelector('link-exchange'),button=host.querySelector('button'),status=host.querySelector('[data-copy-status]')
 button.click();assert.equal(status.textContent,'');assert.equal(timers.size,0,'Do not report success before clipboard completes')
 pending.shift().resolve();await new Promise(setImmediate)
 assert.equal(status.textContent,lang==='en'?'Copied to clipboard.':'已复制到剪贴板。');assert.equal(timers.size,1)
 button.click();assert.equal(timers.size,0,'Repeat clicks cancel the previous expiry')
 pending.shift().resolve();await new Promise(setImmediate)
 assert.equal(timers.size,1);timers.get(sequence)();assert.equal(status.textContent,'')
 button.click();button.click();const first=pending.shift(),last=pending.shift()
 last.reject(Error('Clipboard blocked'));await new Promise(setImmediate)
 const failure=status.textContent;assert.match(failure,/Clipboard is unavailable|暂时无法访问剪贴板/)
 first.resolve();await new Promise(setImmediate)
 assert.equal(status.textContent,failure,'An older completion must not replace the latest failure');assert.equal(timers.size,0)
 button.click();pending.shift().resolve();await new Promise(setImmediate);assert.equal(timers.size,1)
 host.remove();assert.equal(timers.size,0,'Disconnect clears the notification timer')
})

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

test('entering the feed checks the live RSS only once and shares a concurrent manual refresh',async context=>{
  const dom=new JSDOM('<friend-feed></friend-feed><textarea>Keep my draft</textarea>',{url:'https://cyril-fan.top/links/',runScripts:'outside-only',pretendToBeVisual:true})
  context.after(()=>dom.window.close())
  const w=dom.window, host=w.document.querySelector('friend-feed')
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder
  w.AbortSignal.any=()=>new w.AbortController().signal;w.AbortSignal.timeout=()=>new w.AbortController().signal
  const configured={...friend,avatar:'/avatar.png'}
  const initial={friends:[configured],feeds:[],checkedAt:'2026-10-20T00:00:00Z'}
  const requests=[],applied=[]
  let intersection,scheduled=0,disconnected=false,releaseRss
  w.IntersectionObserver=class {
    constructor(callback){intersection=callback}
    observe(element){assert.equal(element,host)}
    disconnect(){disconnected=true}
  }
  w.setTimeout=()=>{scheduled++;return 1}
  w.fetch=async(url,options)=>{
    requests.push(url)
    assert.equal(options.credentials,'omit')
    assert.equal(options.referrerPolicy,'no-referrer')
    if(url==='/links.json')return new Response(JSON.stringify({friends:[{link_list:[configured]}]}))
    assert.equal(url,friend.feed,'A working RSS feed does not depend on the deployment snapshot')
    return new Promise(resolve=>{releaseRss=()=>resolve(new Response(rss))})
  }
  const client=browserModule(w,'../src/lib/friend-feed-client.ts'),refresh=browserModule(w,'../src/lib/friend-feed-refresh.ts',{'./friend-feed-client':client})
  const controller=new w.AbortController()
  const run=refresh.watchFriendFeed(host,controller.signal,initial,data=>applied.push(data))
  intersection([{isIntersecting:false}])
  assert.deepEqual(requests,[],'Articles off screen do not trigger third-party requests')
  intersection([{isIntersecting:true}])
  await new Promise(setImmediate)
  const manual=run()
  releaseRss()
  assert.equal(await manual,'updated')
  assert.deepEqual(requests,['/links.json',friend.feed])
  assert.equal(applied[0].feeds[0].articles[0].title,'A & B')
  assert.equal(disconnected,true)
  intersection([{isIntersecting:false}])
  intersection([{isIntersecting:true}])
  w.document.dispatchEvent(new w.Event('visibilitychange'))
  w.dispatchEvent(new w.Event('online'))
  assert.equal(scheduled,0,'Reading does not schedule another check')
  assert.equal(requests.length,2,'Returning to the reading feed does not recheck')
  const next=run()
  await new Promise(setImmediate)
  releaseRss()
  assert.equal(await next,'current')
  assert.deepEqual(requests,['/links.json',friend.feed,'/links.json',friend.feed])
  assert.equal(w.document.querySelector('textarea').value,'Keep my draft')
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

test('a published feed is used after browser access fails without replacing a newer saved result',async t=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window
 w.TextDecoder=TextDecoder;w.AbortSignal.any=()=>new w.AbortController().signal;w.AbortSignal.timeout=()=>new w.AbortController().signal
 const client=browserModule(w,'../src/lib/friend-feed-client.ts'),configured={...friend,avatar:'/avatar.png'}
 const snapshotFeed=(lastSuccessAt,title)=>({source:friend.link,feed:friend.feed,status:'ok',lastSuccessAt,articles:parseFeed(rss,friend,now).map(a=>({...a,title}))})
 const published=snapshotFeed('2026-10-22T00:00:00Z','Published')
 const fetcher=async url=>{
  if(url==='/links.json')return new Response(JSON.stringify({friends:[{link_list:[configured]}]}))
  if(url==='/data/friend-feeds.json')return new Response(JSON.stringify({version:1,feeds:[published]}))
  throw Error('CORS unavailable')
 }
 const refresh=feed=>client.refreshBrowserFeeds({friends:[configured],feeds:[feed],checkedAt:feed.lastSuccessAt},new w.AbortController().signal,fetcher)
 const fromPublished=await refresh(snapshotFeed('2026-10-21T00:00:00Z','Older browser record'))
 assert.equal(fromPublished.feeds[0].status,'ok')
 assert.equal(fromPublished.feeds[0].articles[0].title,'Published')
 const kept=await refresh(snapshotFeed('2026-10-23T00:00:00Z','Newer browser record'))
 assert.equal(kept.feeds[0].articles[0].title,'Newer browser record')
})

test('manual feed UI refresh replaces only reading rows and restores pagination feedback after 3 seconds',async t=>{
 const initial={friends:[{...friend,avatar:'/avatar.png'}],feeds:[],checkedAt:'2026-10-20'}
 const dom=new JSDOM(`<friend-feed data-lang="zh"><script data-feed-data type="application/json">${JSON.stringify(initial)}</script><template data-feed-row><article data-feed-article><button class="feed-author"><img><span></span></button><a class="feed-title"></a><time></time></article></template><button data-random-refresh>随便读读</button><button data-check-update>刷新</button><section data-random-panel hidden><a data-random-title></a><span data-random-meta></span><button data-close-random></button></section><div class="feed-articles"></div><button data-load-more></button><p data-feed-status></p><span data-feed-counts></span><span data-feed-checked><time></time></span><span data-feed-stale></span><dialog><h3 id="feed-author-title" tabindex="-1" autofocus></h3><button data-close-author></button><a data-author-site></a><ul data-author-articles></ul></dialog></friend-feed><textarea>Unsubmitted comment</textarea>`,{url:'https://cyril-fan.top/links/',runScripts:'outside-only'})
 t.after(()=>dom.window.close());const w=dom.window;let timer
 const dialog=w.document.querySelector('dialog'),list=dialog.querySelector('[data-author-articles]'),scrollArea=w.document.createElement('div')
 scrollArea.className='author-dialog-scroll';list.replaceWith(scrollArea);scrollArea.append(list)
 w.setTimeout=(fn,ms)=>{assert.equal(ms,3000);timer=fn;return 1};w.clearTimeout=()=>{}
 const articles=Array.from({length:23},(_,i)=>({...parseFeed(rss,friend,now)[0],title:`Article ${i+1}`,link:`https://example.com/post-${i}`}))
 const updated={...initial,checkedAt:'2026-10-24T16:02:01Z',feeds:[{source:friend.link,status:'ok',articles}]}
 let publishUpdate
 const refresh={watchFriendFeed:(_host,_signal,_data,apply)=>{publishUpdate=apply;return async()=>{apply(updated);return 'updated'}}}
 const source=readFileSync(new URL('../src/components/links/FriendFeed.astro',import.meta.url),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const feedback=browserModule(w,'../src/lib/ui-feedback.ts')
 w.Function('require','exports',js)(name=>name.endsWith('/ui-feedback')?feedback:refresh,{})
 const host=w.document.querySelector('friend-feed');host.querySelector('[data-check-update]').click();await new Promise(setImmediate)
 dialog.getBoundingClientRect=()=>({left:100,right:500,top:100,bottom:600})
 const wheel=(target,x,y,ctrlKey=false)=>{const event=new w.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:x,clientY:y,deltaY:100,ctrlKey});target.dispatchEvent(event);return event.defaultPrevented}
 assert.equal(wheel(dialog.querySelector('h3'),200,150),true,'The panel header must not scroll the background')
 assert.equal(wheel(dialog,110,300),true,'The panel padding must not scroll the background')
 assert.equal(wheel(list,200,300),false,'The list keeps native scrolling; CSS contains overscroll')
 assert.equal(wheel(dialog,600,300),false,'Wheel events on the backdrop may scroll the background')
 assert.equal(wheel(dialog.querySelector('h3'),200,150,true),false,'Browser pinch/Control zoom is preserved')
 assert.equal(host.querySelectorAll('[data-feed-article]').length,23);assert.match(host.querySelector('[data-feed-status]').textContent,/已更新/)
 assert.equal(host.querySelectorAll('[data-feed-article]:not([hidden])').length,10)
 assert.equal(host.querySelector('time').dateTime,'2026-10-20T00:00:00.000Z');assert.equal(host.querySelector('[data-feed-checked] time').dateTime,updated.checkedAt)
 assert.match(host.querySelector('[data-feed-counts]').textContent,/1 位朋友 · 1 个订阅可用/)
 timer();assert.match(host.querySelector('[data-feed-status]').textContent,/已显示 10 \/ 23/)
 const firstNewPost=host.querySelectorAll('[data-feed-article]')[10].querySelector('.feed-title')
 host.querySelector('[data-load-more]').click()
 assert.equal(host.querySelectorAll('[data-feed-article]:not([hidden])').length,20)
 assert.equal(w.document.activeElement,firstNewPost,'Keyboard loading continues at the first newly revealed post')
 host.querySelector('[data-check-update]').click();await new Promise(setImmediate)
 assert.equal(host.querySelectorAll('[data-feed-article]:not([hidden])').length,20,'Refreshing does not collapse the reading list')
 host.querySelector('[data-load-more]').click()
 assert.equal(host.querySelectorAll('[data-feed-article]:not([hidden])').length,23)
 assert.equal(host.querySelector('[data-load-more]').hidden,true)
 host.querySelector('[data-random-refresh]').click();assert.equal(host.querySelector('[data-random-panel]').hidden,false)
 assert.equal(host.querySelector('[data-random-refresh]').getAttribute('aria-expanded'),'true')
 assert.equal(host.querySelector('[data-random-panel]').textContent.includes('随便读读'),false)
 host.querySelector('[data-close-random]').click()
 assert.equal(host.querySelector('[data-random-panel]').hidden,true)
 assert.equal(host.querySelector('[data-random-refresh]').getAttribute('aria-expanded'),'false')
 assert.equal(w.document.activeElement,host.querySelector('[data-random-refresh]'))
 const firstRow=host.querySelector('[data-feed-article]')
 const author=firstRow.querySelector('button')
 dialog.showModal=()=>dialog.setAttribute('open','')
 dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new w.Event('close'))}
 author.click()
 assert.equal(w.document.activeElement,dialog.querySelector('h3'),'Opening focuses the heading, not the close button')
 host.querySelector('[data-random-refresh]').click()
 const randomLink=host.querySelector('[data-random-title]').href
 const fresh={...articles[0],title:'New automatic post',link:'https://example.com/new',date:'2026-10-24T00:00:00.000Z'}
 publishUpdate({...updated,feeds:[{...updated.feeds[0],articles:[fresh,...articles]}]})
 assert.equal(host.querySelector('[data-feed-article]'),firstRow,'Automatic updates wait for the open dialog')
 assert.equal(dialog.querySelectorAll('li').length,23)
 dialog.querySelector('[data-close-author]').click()
 assert.equal(host.querySelector('[data-feed-article] .feed-title').textContent,'New automatic post')
 assert.equal(host.querySelectorAll('[data-feed-article]')[1],firstRow,'Existing rows are reused')
 assert.equal(w.document.activeElement,author)
 assert.equal(host.querySelectorAll('[data-feed-article]:not([hidden])').length,24)
 assert.equal(host.querySelector('[data-random-panel]').hidden,false)
 assert.equal(host.querySelector('[data-random-title]').href,randomLink)
 assert.equal(w.document.querySelector('textarea').value,'Unsubmitted comment')
})

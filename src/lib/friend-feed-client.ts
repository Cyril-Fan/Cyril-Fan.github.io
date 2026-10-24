export type Friend={name:string;link:string;avatar:string;feed?:string}
export type FeedArticle={title:string;link:string;date:string;source:string}
export type Feed={source:string;feed?:string;status:string;lastSuccessAt?:string|null;articles:FeedArticle[]}
export type FeedData={friends:Friend[];feeds:Feed[];checkedAt:string}
export function safeFeedUrl(value:string,base?:string){
  if(typeof value!=='string'||!value.trim())return ''
  try{const u=new URL(value,base);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||u.hostname.includes(':')||/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname))return '';u.hash='';return u.href}catch{return ''}
}
export async function readFeedResponse(response:Response,max:number){
  if(!response.ok||!response.body)throw new Error('Feed unavailable')
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Feed too large');text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}
  finally{await reader.cancel()}
}
export function parseBrowserFeed(xml:string,friend:Friend,now=Date.now()):FeedArticle[]{
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||new TextEncoder().encode(xml).length>4*1024*1024)throw new Error('Unsafe or oversized feed')
  const doc=new DOMParser().parseFromString(xml,'application/xml')
  if(doc.querySelector('parsererror'))throw new Error('Invalid feed')
  const root=doc.documentElement.localName.toLowerCase()
  if(!['rss','feed','rdf'].includes(root))throw new Error('Unsupported feed')
  const children=(e:Element,name:string)=>[...e.children].filter(c=>c.localName===name)
  const text=(e:Element,name:string)=>children(e,name)[0]?.textContent||''
  const items=[...doc.getElementsByTagNameNS('*',root==='feed'?'entry':'item')],seen=new Set<string>()
  return items.flatMap(item=>{
    const link=safeFeedUrl(root==='feed'?children(item,'link').find(l=>!l.getAttribute('rel')||l.getAttribute('rel')==='alternate')?.getAttribute('href')||'':text(item,'link'),friend.link)
    const date=Date.parse(root==='feed'?text(item,'published')||text(item,'updated'):text(item,'pubDate')||text(item,'date'))
    const title=text(item,'title').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,300)
    if(!link||!title||!Number.isFinite(date)||date>now+86400000||seen.has(link))return []
    seen.add(link);return [{title,link,date:new Date(date).toISOString(),source:friend.link}]
  }).sort((a,b)=>b.date.localeCompare(a.date)||a.link.localeCompare(b.link))
}
/** Read only operator-configured public feeds; no credentials, proxy, or arbitrary URL input. */
export async function refreshBrowserFeeds(previous:FeedData,signal:AbortSignal,fetcher=fetch):Promise<FeedData>{
  const options={cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])} as const
  const config=JSON.parse(await readFeedResponse(await fetcher('/links.json',options),256000))
  const raw=config?.friends?.flatMap((g:{link_list:unknown[]})=>g.link_list)
  if(!Array.isArray(raw)||raw.length>100)throw new Error('Invalid friend list')
  const friends:Friend[]=raw.map(f=>{
    if(typeof f.name!=='string'||typeof f.avatar!=='string'||!safeFeedUrl(f.link)||!f.link.startsWith('https:')||(f.feed&&(!safeFeedUrl(f.feed)||!f.feed.startsWith('https:'))))throw new Error('Invalid friend')
    return {name:f.name.slice(0,150),avatar:f.avatar,link:f.link,feed:f.feed}
  })
  let fallback=previous.feeds
  try{const published=JSON.parse(await readFeedResponse(await fetcher('/data/friend-feeds.json',options),2000000));if(published.version===1&&Array.isArray(published.feeds))fallback=published.feeds}catch{ /* Initial in-page data remains a fallback. */ }
  const feeds=await Promise.all(friends.map(async friend=>{
    if(!friend.feed)return {source:friend.link,status:'unconfigured',articles:[]}
    try{const xml=await readFeedResponse(await fetcher(friend.feed,options),4*1024*1024);return {source:friend.link,feed:friend.feed,status:'ok',lastSuccessAt:new Date().toISOString(),articles:parseBrowserFeed(xml,friend)}}
    catch{
      const candidates=[...previous.feeds,...fallback].filter(f=>f.source===friend.link&&f.feed===friend.feed&&Array.isArray(f.articles))
      const old=candidates.sort((a,b)=>Date.parse(b.lastSuccessAt||'')-Date.parse(a.lastSuccessAt||''))[0]
      const seen=new Set<string>(),articles=(old?.articles||[]).flatMap(a=>{
        const link=typeof a.link==='string'?safeFeedUrl(a.link,friend.link):'',date=Date.parse(a.date)
        if(!link||typeof a.title!=='string'||!a.title.trim()||!Number.isFinite(date)||date>Date.now()+86400000||seen.has(link))return []
        seen.add(link);return [{title:a.title.slice(0,300),link,date:new Date(date).toISOString(),source:friend.link}]
      })
      return {source:friend.link,feed:friend.feed,status:'unavailable',lastSuccessAt:old?.lastSuccessAt||null,articles}
    }
  }))
  if(signal.aborted)throw new Error('Aborted')
  return {friends,feeds,checkedAt:new Date().toISOString()}
}

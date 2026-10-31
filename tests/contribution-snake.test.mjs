import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { syncContributionSnake, verifyContributionBundle, refreshContributionSnapshot } from '../scripts/sync-contribution-snake.mjs'
import { calendarHash, fetchContributionBundle, fetchPublishedContributionBundle, validatePublishedContributionBundle, validateProfileSnake, PROFILE_REF } from '../src/lib/contribution-feed.ts'
import * as calendarHelpers from '../src/lib/github-contributions.ts'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const metadata = JSON.parse(read('../src/assets/contributions.json'))
const fixtureCommit = metadata.sourceCommit || 'a'.repeat(40)
const snapshot = JSON.parse(read('../src/assets/contribution-calendar.json'))
const calendar = calendarHelpers.normalizeContributions(snapshot)
const light = read(`../public${metadata.light}`), dark = read(`../public${metadata.dark}`)
const now = new Date(Date.parse(snapshot.fetchedAt) + 300000)
const profile = { login:'Cyril-Fan', updated:snapshot.fetchedAt.slice(0,16).replace('T',' '), calendar:snapshot.contributions, stats:[['Contributions',calendar.total]], snake_calendar_hash:snapshot.dataHash }
const response = value => new Response(typeof value === 'string' ? value : JSON.stringify(value))
function feed(override = {}) {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({url,options})
    if (url.split('?')[0] === PROFILE_REF) return response({object:{sha:fixtureCommit}})
    assert.ok(url.includes(`/${fixtureCommit}/assets/`), 'Every resource must be commit pinned')
    const name = url.split('?')[0].split('/').at(-1)
    const value = override[name] ?? ({'profile-data.json':profile,'github-contribution-grid-snake.svg':light,'github-contribution-grid-snake-dark.svg':dark})[name]
    if (value instanceof Error) throw value
    return response(value)
  }
  return {calls,fetcher}
}

test('published fallback preserves the original profile SVG and matching calendar in both themes', async () => {
  await verifyContributionBundle({requireFresh:false})
  assert.equal(await calendarHash(calendar), profile.snake_calendar_hash)
  assert.equal(validateProfileSnake(light,calendar,'light').duration, metadata.cycleDurationMs)
  assert.equal(validateProfileSnake(dark,calendar,'dark').width, metadata.width)
  assert.ok(!light.includes('data-consumed-at'), 'No custom path or easing replaces the original animation')
})

test('updates fetch all resources at one commit, omit credentials and keep tokens off raw file requests', async () => {
  const remote = feed()
  const bundle = await fetchContributionBundle({fetcher:remote.fetcher,now,token:'test-token'})
  assert.equal(bundle.calendar.total, calendar.total)
  assert.equal(bundle.light,light)
  assert.equal(bundle.dark,dark)
  assert.equal(remote.calls.length,4)
  for (const call of remote.calls) {
    assert.equal(call.options.credentials,'omit')
    assert.equal(call.options.referrerPolicy,'no-referrer')
    assert.equal(call.options.redirect,'error')
    assert.equal(call.options.cache,'no-store')
    assert.equal(call.options.headers?.Authorization,call.url.split('?')[0] === PROFILE_REF ? 'Bearer test-token' : undefined)
  }
  const unchanged = feed()
  assert.equal(await fetchContributionBundle({fetcher:unchanged.fetcher,now,currentCommit:fixtureCommit}),null)
  assert.equal(unchanged.calls.length,1)
})

test('half-published snapshots, wrong cells, incorrect themes, stale data and interrupted requests are rejected', async () => {
  const wrong = structuredClone(profile)
  const active = wrong.calendar.find(day=>day.level>0)
  active.count++; wrong.stats[0][1]++
  for (const override of [
    {'profile-data.json':wrong},
    {'profile-data.json':{...profile,login:'somebody-else'}},
    {'profile-data.json':{...profile,updated:'2026-01-01 00:00'}},
    {'github-contribution-grid-snake-dark.svg':light},
    {'github-contribution-grid-snake.svg':light.replace('class="c" x="','class="c c999" x="')},
    {'github-contribution-grid-snake-dark.svg':new Error('Offline')}
  ]) await assert.rejects(fetchContributionBundle({fetcher:feed(override).fetcher,now}))
  for (const payload of ['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.org/x"/>','<g onclick="x()"/>','<style>@import "x";</style>','<style>.x{fill:url(x)}</style>','<!ENTITY x>']) {
    assert.throws(()=>validateProfileSnake(light.replace('</svg>',payload+'</svg>'),calendar,'light'))
  }
})

test('failed refresh never overwrites the complete local fallback', async context => {
  const directory = await mkdtemp(join(tmpdir(),'contribution-tests-'))
  const root = pathToFileURL(directory+sep)
  context.after(async()=>{
    const target=resolve(directory)
    assert.equal(dirname(target),resolve(tmpdir()))
    assert.ok(basename(target).startsWith('contribution-tests-'))
    await rm(target,{recursive:true,force:true})
  })
  await syncContributionSnake({root,now,fetcher:feed().fetcher,token:''})
  await verifyContributionBundle({root,now})
  const file=new URL('src/assets/contributions.json',root)
  const before=await readFile(file,'utf8')
  await assert.rejects(syncContributionSnake({root,now,token:'',fetcher:feed({'github-contribution-grid-snake-dark.svg':new Error('Offline')}).fetcher}))
  assert.equal(await readFile(file,'utf8'),before)
})

const code=ts.transpileModule(read('../src/lib/contribution-view.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const flush=async()=>{for(let i=0;i<12;i++) await Promise.resolve();await new Promise(setImmediate)}
function view(context,{en=false,remote=async()=>null,published=async()=>{throw Error('offline')},reduced=false,decode=async()=>{}}={}) {
  const cells=Array.from({length:10},(_,i)=>`<rect class="contribution-day level-0" role="button" data-date="2026-10-${String(i+1).padStart(2,'0')}" data-count="${i}" tabindex="${i===9?0:-1}" aria-label="day ${i}: ${i} contributions"></rect>`).join('')
  const dom=new JSDOM(`<contribution-snake data-updated="2026-10-25T00:00:00.000Z" data-lang="${en?'en':'zh'}"><div class="contribution-canvas"><svg class="contribution-surface" viewBox="-16 -32 880 192"><g class="snake-animated"><image class="snake-light" href="/old-light.svg" x="-16" y="-32" width="880" height="192" preserveAspectRatio="none"/><image class="snake-dark" href="/old-dark.svg" x="-16" y="-32" width="880" height="192" preserveAspectRatio="none"/></g><g class="contribution-calendar">${cells}</g></svg></div><span data-contribution-total>old total</span><input type="date" data-contribution-date><output data-contribution-detail></output><button data-snake-toggle hidden></button></contribution-snake>`,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://cyril-fan.top/'})
  context.after(()=>dom.window.close())
  const {window}=dom
  const media=new window.EventTarget();media.matches=reduced
  window.matchMedia=()=>media
  let sequence=0
  const revoked=[]
  window.URL.createObjectURL=()=>`blob:test-${++sequence}`
  window.URL.revokeObjectURL=url=>revoked.push(url)
  window.HTMLImageElement.prototype.decode=decode
  const module={exports:{}}
  window.Function('require','module','exports',code)(name=>name.includes('contribution-feed')?{fetchContributionBundle:remote,fetchPublishedContributionBundle:published,REFRESH_INTERVAL_MS:300000}:calendarHelpers,module,module.exports)
  window.customElements.define('contribution-snake',module.exports.ContributionSnake)
  const host=window.document.querySelector('contribution-snake')
  return {window,host,media,revoked,button:host.querySelector('button'),cells:[...host.querySelectorAll('[data-date]')],input:host.querySelector('input'),output:host.querySelector('output')}
}

test('published bundles stay anonymous, accept honestly dated history and reject mixed or hostile SVGs',async()=>{
  const bundle=await fetchContributionBundle({fetcher:feed().fetcher,now})
  const oldNow=new Date(now.getTime()+10*86400000)
  const result=await fetchPublishedContributionBundle({now:oldNow,fetcher:async(url,options)=>{
    assert.equal(url.split('?')[0],'/data/contributions.json'); assert.equal(options.credentials,'omit'); assert.equal(options.cache,'no-store')
    assert.equal(options.headers,undefined)
    return response({version:1,...bundle})
  }})
  assert.equal(result.fetchedAt,bundle.fetchedAt)
  for(const invalid of [
    {...bundle,dataHash:'0'.repeat(64)}, {...bundle,dark:light}, {...bundle,sourceCommit:'../../unsafe'},
    {...bundle,light:light.replace('</svg>','<script>alert(1)</script></svg>')},
    {...bundle,fetchedAt:new Date(oldNow.getTime()+86400000).toISOString()}
  ]) await assert.rejects(validatePublishedContributionBundle({version:1,...invalid},oldNow))
})

test('an upstream outage keeps the latest fully verified deployed snapshot without blocking the site',async context=>{
  const directory=await mkdtemp(join(tmpdir(),'contribution-tests-')), root=pathToFileURL(directory+sep)
  context.after(async()=>{
    const target=resolve(directory); assert.equal(dirname(target),resolve(tmpdir())); assert.ok(basename(target).startsWith('contribution-tests-'))
    await rm(target,{recursive:true,force:true})
  })
  await syncContributionSnake({root,now,fetcher:feed().fetcher,token:''})
  const bundle=await fetchContributionBundle({fetcher:feed().fetcher,now})
  const deployed={version:1,...bundle,fetchedAt:new Date(Date.parse(bundle.fetchedAt)+60000).toISOString(),sourceCommit:'a'.repeat(40)}
  const later=new Date(now.getTime()+10*86400000)
  await refreshContributionSnapshot({root,now:later,retry:false,token:'',fetcher:async url=>{
    if(url.split('?')[0]==='https://cyril-fan.top/data/contributions.json') return response(deployed)
    throw Error('GitHub rate limited')
  }})
  const result=await verifyContributionBundle({root,now:later,requireFresh:false})
  assert.equal(result.snapshot.fetchedAt,deployed.fetchedAt)
  assert.equal(result.snapshot.sourceCommit,deployed.sourceCommit)
  await assert.rejects(verifyContributionBundle({root,now:later}))
  const publicBundle=JSON.parse(await readFile(new URL('public/data/contributions.json',root),'utf8'))
  assert.equal(publicBundle.fetchedAt,deployed.fetchedAt,'Do not replace data time with the failed check time')
  assert.equal(publicBundle.light,light);assert.equal(publicBundle.dark,dark)
  await refreshContributionSnapshot({root,now:later,retry:false,token:'',fetcher:async()=>{throw Error('All upstreams offline')}})
  assert.equal((await verifyContributionBundle({root,now:later,requireFresh:false})).snapshot.sourceCommit,deployed.sourceCommit)
})

test('the visible graph can refresh from the published same-origin bundle after GitHub throttles it',async context=>{
  const bundle=await fetchContributionBundle({fetcher:feed().fetcher,now})
  const ui=view(context,{remote:async()=>{throw Error('rate limited')},published:async()=>bundle,reduced:true})
  await flush()
  assert.equal(ui.host.querySelector('[data-contribution-total]').textContent,`${calendar.total} 次贡献`)
  assert.equal(ui.host.querySelectorAll('[data-date]').length,calendar.contributions.length)
  assert.equal(ui.host.dataset.playing,'false')
})
for(const en of [false,true]) test(`${en?'en':'zh'}: keyboard, hover, date picker, reduced motion and reconnection remain usable`,async context=>{
  const ui=view(context,{en,reduced:true})
  assert.equal(ui.host.dataset.playing,'false');assert.equal(ui.button.hidden,false)
  ui.button.click();assert.equal(ui.host.dataset.playing,'true');assert.equal(ui.input.disabled,true)
  ui.button.click()
  ui.cells[3].dispatchEvent(new ui.window.Event('pointerover',{bubbles:true}))
  assert.equal(ui.output.textContent,'day 3: 3 contributions')
  ui.cells[9].dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))
  assert.equal(ui.output.textContent,'day 2: 2 contributions')
  ui.input.value='2026-10-06';ui.input.dispatchEvent(new ui.window.Event('change'))
  assert.equal(ui.output.textContent,'day 5: 5 contributions')
  ui.media.matches=false;ui.media.dispatchEvent(new ui.window.Event('change'))
  assert.equal(ui.host.dataset.playing,'false','Explicit static choice is preserved')
  ui.host.remove();ui.window.document.body.append(ui.host);ui.button.click()
  assert.equal(ui.host.dataset.playing,'true')
  ui.media.matches=true;ui.media.dispatchEvent(new ui.window.Event('change'))
  assert.equal(ui.host.dataset.playing,'false')
})

test('calendar, count and both images update only after both new images decode; selection remains interactive',async context=>{
  let release;const pending=new Promise(resolve=>{release=resolve})
  const bundle=await fetchContributionBundle({fetcher:feed().fetcher,now})
  const ui=view(context,{remote:async()=>bundle,decode:()=>pending,reduced:true})
  await flush()
  assert.equal(ui.host.querySelector('[data-contribution-total]').textContent,'old total')
  assert.equal(ui.cells.length,10)
  assert.equal(ui.host.querySelector('.snake-light').getAttribute('href'),'/old-light.svg')
  release();await flush()
  assert.equal(ui.host.querySelector('[data-contribution-total]').textContent,`${calendar.total} 次贡献`)
  assert.equal(ui.host.querySelectorAll('[data-date]').length,calendar.contributions.length)
  assert.match(ui.host.querySelector('.snake-dark').getAttribute('href'),/^data:image\/svg\+xml;/)
  const surface=ui.host.querySelector('.contribution-surface')
  assert.equal(surface.getAttribute('viewBox'),`-16 -32 ${bundle.width} ${bundle.height}`)
  for(const image of surface.querySelectorAll('image')){
    assert.equal(image.getAttribute('width'),String(bundle.width));assert.equal(image.getAttribute('height'),String(bundle.height))
    assert.equal(image.getAttribute('x'),'-16');assert.equal(image.getAttribute('y'),'-32')
    assert.equal(image.ownerSVGElement,surface,'Animation and static cells share one viewport after refresh')
  }
  assert.equal(surface.querySelector('[data-date]').ownerSVGElement,surface)
  ui.button.click();ui.button.click()
  assert.equal(ui.host.querySelector('.contribution-surface'),surface,'Switching modes cannot resize or replace the viewport')
  const active=ui.host.querySelector('[data-level="1"]')
  active.dispatchEvent(new ui.window.MouseEvent('click',{bubbles:true}))
  assert.equal(ui.input.value,active.dataset.date)
  assert.ok(ui.output.textContent.includes(active.dataset.count))
  assert.equal(ui.host.dataset.playing,'false')
})

test('failed image decoding or network keeps the old visible pair and calendar intact',async context=>{
  const bundle=await fetchContributionBundle({fetcher:feed().fetcher,now})
  for(const options of [{remote:async()=>{throw new Error('Offline')}},{remote:async()=>bundle,decode:async()=>{throw new Error('Bad SVG')}}]) {
    const ui=view(context,options);await flush()
    assert.equal(ui.host.querySelector('.snake-light').getAttribute('href'),'/old-light.svg')
    assert.equal(ui.host.querySelector('.snake-dark').getAttribute('href'),'/old-dark.svg')
    assert.equal(ui.host.querySelectorAll('[data-date]').length,10)
    assert.equal(ui.host.querySelector('[data-contribution-total]').textContent,'old total')
  }
})

test('animated cell IDs are base 36, including letters, without relaxing color or coordinate validation', () => {
  const id = light.match(/\.c\.(c[0-9a-z]+)\{fill:/)[1]
  const renamed = light.replace(`.c.${id}{`, '.c.czz9{').replace(`class="c ${id}"`, 'class="c czz9"')
  assert.equal(validateProfileSnake(renamed,calendar,'light').width,metadata.width)
  assert.throws(()=>validateProfileSnake(renamed.replace('class="c czz9"','class="c c-unsafe"'),calendar,'light'))
})
test('a successful unchanged check updates the check time without advancing the data timestamp',async context=>{
 const ui=view(context,{remote:async()=>null});const original=ui.host.dataset.updated;await flush()
 assert.equal(ui.host.dataset.updated,original)
 assert.ok(ui.host.dataset.checkedAt)
 assert.match(ui.host.querySelector('[data-contribution-total]').title,/数据更新.*最近检查/)
 const offline=view(context,{remote:async()=>{throw Error('offline')},published:async()=>{throw Error('offline')}});await flush()
 assert.equal(offline.host.dataset.checkedAt,undefined)
})

test('GitHub API quota falls back to raw files only when the complete calendar and both animations agree', async () => {
  const calls=[]
  const fetcher=async(url,options)=>{
    calls.push({url,options})
    if(url.split('?')[0]===PROFILE_REF) return new Response('rate limited',{status:403})
    assert.ok(url.startsWith('https://raw.githubusercontent.com/Cyril-Fan/Cyril-Fan/main/assets/'))
    return response({'profile-data.json':profile,'github-contribution-grid-snake.svg':light,'github-contribution-grid-snake-dark.svg':dark}[url.split('?')[0].split('/').at(-1)])
  }
  const bundle=await fetchContributionBundle({fetcher,now,currentCommit:fixtureCommit})
  assert.equal(bundle.sourceCommit,null,'Do not invent a Git revision for a branch read')
  assert.equal(bundle.calendar.total,calendar.total)
  assert.equal((await validatePublishedContributionBundle({version:1,...bundle},now)).dataHash,bundle.dataHash)
  assert.ok(calls.every(call=>call.options.credentials==='omit'))
  await assert.rejects(fetchContributionBundle({now,fetcher:async(url,options)=>url.split('?')[0].endsWith('-dark.svg')?response(light):fetcher(url,options)}))
})

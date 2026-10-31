import { parseDocument, stringify } from 'yaml'

export const REPOSITORY = 'Cyril-Fan/Cyril-Fan.github.io'
export const BRANCH = 'main'
export const SHA = /^[a-f0-9]{40}$/
export const REQUEST_ID = /^[a-f0-9-]{36}$/
export type Entry = { path: string; sha: string; size: number; kind: string; writable: boolean }
export type Change = { path: string; baseSha: string | null; content: string | null; encoding?: 'utf-8' | 'base64' }
export const PROFILE = 'src/data/profile.json'
export const ACADEMIC = 'src/data/academic.json'
export const LINKS = 'public/links.json'
export const RELEASE = 'public/data/cms-release.json'
export const CONTENT_CATEGORIES = ['research','tech','daily'] as const
export function contentCategory(path:string,source?:string|null):string {
  const folder=path.match(/^src\/content\/(?:blogs|collection)\/(research|tech|daily)\//)?.[1]
  if(folder)return folder
  try{const category=readArticle(source||'').data.category;return ({research:'research',tech:'tech',technical:'tech',daily:'daily','科研':'research','技术':'tech','日常':'daily'} as Record<string,string>)[category]||'tech'}catch{return 'tech'}
}
const imageExt = /\.(?:png|jpe?g|webp|gif|avif)$/i
export function pathKind(path: string): string | null {
  if (path === PROFILE) return 'profile'
  if (path === ACADEMIC) return 'academic'
  if (path === LINKS) return 'friend'
  if (/^src\/content\/blogs\/(?:(?:research|tech|daily)\/)?[a-z0-9][a-z0-9-]{0,99}\/index(?:-en)?\.mdx?$/.test(path)) return 'post'
  if (/^src\/content\/collection\/(?:[a-z0-9][a-z0-9-]{0,99}|(?:research|tech|daily)\/[a-z0-9][a-z0-9-]{0,99}\/index)\.mdx?$/.test(path)) return 'collection'
  if (/^(?:public\/(?:media|links|avatar|images)|src\/assets\/(?:photos|projects))\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(path) && imageExt.test(path)) return 'media'
  if (/^src\/content\/(?:blogs|collection)\/(?:(?:research|tech|daily)\/)?[a-z0-9][a-z0-9-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(path) && imageExt.test(path)) return 'media'
  return null
}
export const publicImage = (path: string) => path.startsWith('public/') ? '/' + path.slice(7) : path.startsWith('src/') ? '/' + path : path
export function imageRepositoryPath(value:string,sourcePath='') {
  if(/^https:\/\//i.test(value))try{
    const url=new URL(value)
    if(!url.port&&['cyril-fan.top','www.cyril-fan.top'].includes(url.hostname))value=url.pathname
  }catch{ /* Leave invalid URLs for schema validation. */ }
  if(value.startsWith('/src/'))return value.slice(1)
  if(value.startsWith('/'))return 'public'+value.split(/[?#]/)[0]
  if(value.startsWith('src/')||value.startsWith('public/'))return value
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)||!sourcePath)return value
  try{return new URL(value,'https://content.invalid/'+sourcePath).pathname.slice(1)}catch{return value}
}
export function replaceImageReferences(source:string,imagePath:string,sourcePath:string,replacement:string) {
  return source.replace(/[^\s"'()<>`]+/g,token=>imageRepositoryPath(token,sourcePath)===imagePath?replacement:token)
}
export function readArticle(source: string) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const yaml = parseDocument(match?.[1] || '', { uniqueKeys: true })
  if (yaml.errors.length) throw new Error('YAML: ' + yaml.errors[0].message)
  const data = yaml.toJS({ maxAliasCount: 20 }) || {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid frontmatter')
  return { data, body: source.slice(match?.[0].length || 0), yaml }
}
// Update only edited keys. YAML comments, extra fields and nested image metadata survive.
export function writeArticle(source: string, updates: Record<string, unknown>, body?: string) {
  const parsed = readArticle(source)
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) parsed.yaml.delete(key)
    else parsed.yaml.set(key, value)
  }
  return '---\n' + parsed.yaml.toString() + '---\n' + (body ?? parsed.body)
}
export function safeUrl(value: string, image = false): boolean {
  if (typeof value !== 'string') return false
  if (image && /^\/src\/content\/(?:blogs|collection)\/(?:(?:research|tech|daily)\/)?[a-z0-9][a-z0-9-]*\/[\w.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(value)) return true
  if (image && /^(?:\/(?:media|links|avatar|images)\/[\w.-]+|\/src\/assets\/(?:photos|projects)\/[\w.-]+|\/src\/assets\/avatar\.png|\.\.?\/[\w./-]+)\.(?:png|jpe?g|webp|gif|avif)$/i.test(value)) return true
  if (image && /^\/(?:media|links|avatar|images)\/[\w.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(value)) return true
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !/[\u0000-\u0020]/.test(value) } catch { return false }
}
export function validateMarkdown(body: string, mdx = false) {
  if (body.length > 500000) throw new Error('Article exceeds 500 KB')
  if (!mdx) return
  // Safe MDX is data-only: a deliberately small set of static theme components.
  // Ignore fenced/inline code and math when checking literal example syntax.
  const text = body.replace(/(^|\n)([ \t]*)(```|~~~)[\s\S]*?\n\2\3[^\n]*/g, '\n')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|`[^`]*`/g, '')
  if (/^\s*(?:import|export)\s/m.test(text) || /[{}]/.test(text)) throw new Error('MDX imports, exports and JavaScript expressions are not editable. Use Markdown or static Aside / Collapse / Spoiler / Steps components.')
  const tags = text.match(/<[^>]*>/g) || []
  for (const tag of tags) {
    if (!/^<\/?(?:Aside|Collapse|Spoiler|Steps)(?:\s+(?:type|title)="[^"<>]*")*\s*\/?>$/.test(tag)) throw new Error('Unsupported MDX component or attribute')
  }
}
function checkLinks(value: unknown, key = '') {
  if (typeof value === 'string' && /^(?:url|href|link|feed|schoolUrl|homepage|source|cv)$/.test(key) && value && !safeUrl(value)) throw new Error('Only HTTPS links are allowed: ' + key)
  if (Array.isArray(value)) value.forEach(v => checkLinks(v, key))
  else if (value && typeof value === 'object') {
    for (const [k,v] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(k)) throw new Error('Invalid key')
      checkLinks(v,k)
    }
  }
}
export function validateText(path: string, text: string) {
  const kind = pathKind(path)
  if (!kind || kind === 'media' || text.length > 1500000 || text.includes('\0')) throw new Error('Invalid text file')
  if (kind === 'post' || kind === 'collection') {
    const { data, body } = readArticle(text)
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > (kind === 'post' ? 60 : 200)) throw new Error('A title is required')
    if (kind === 'post' && (typeof data.description !== 'string' || data.description.length > 160 || Number.isNaN(Date.parse(data.publishDate)))) throw new Error('Invalid description or publication date')
    if (data.tags && (!Array.isArray(data.tags) || data.tags.some((x: unknown) => typeof x !== 'string'))) throw new Error('Tags must be a list')
    for (const k of ['category','language','pixivLink','source','title_en','description_en']) if(data[k]!==undefined&&typeof data[k]!=='string')throw new Error('Expected text: '+k)
    if(data.updatedDate!==undefined&&Number.isNaN(Date.parse(data.updatedDate)))throw new Error('Invalid updated date')
    for(const k of ['draft','comment'])if(data[k]!==undefined&&typeof data[k]!=='boolean')throw new Error('Expected boolean: '+k)
    if(data.pixivLink&&!/^\d+$/.test(data.pixivLink))throw new Error('Pixiv artwork ID must be numeric')
    if(data.heroImage){if(typeof data.heroImage!=='object'||typeof data.heroImage.src!=='string')throw new Error('Cover source required');for(const k of ['width','height'])if(data.heroImage[k]!==undefined&&(!Number.isFinite(data.heroImage[k])||data.heroImage[k]<=0))throw new Error('Invalid image dimensions')}
    const folder=path.match(/^src\/content\/(?:blogs|collection)\/(research|tech|daily)\//)?.[1]
    if(folder&&data.category!==folder)throw new Error('Category must match its folder')
    if (data.bloglist && (!Array.isArray(data.bloglist) || data.bloglist.some((x: unknown) => typeof x !== 'string' || !/^(?:(?:research|tech|daily)\/)?[\w-]+$/.test(x)))) throw new Error('Invalid collection order')
    if (data.heroImage?.src && !safeUrl(data.heroImage.src, true) && !/^(?:\.\.?\/)?[\w.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(data.heroImage.src)) throw new Error('Invalid cover image')
    checkLinks(data); validateMarkdown(body, path.endsWith('.mdx'))
    return
  }
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON object')
  if (kind === 'friend') {
    if (!Array.isArray(data.friends)) throw new Error('Missing friend groups')
    const names = new Set()
    for (const group of data.friends) {
      if (!Array.isArray(group.link_list)) throw new Error('Missing friend entries')
      for (const f of group.link_list) {
        if (typeof f.name !== 'string' || !f.name.trim() || !safeUrl(f.link)) throw new Error('Friend name and HTTPS URL are required')
        if (names.has(f.link)) throw new Error('Duplicate friend URL')
        names.add(f.link)
        if (f.avatar && !safeUrl(f.avatar,true)) throw new Error('Invalid friend avatar')
      }
    }
  } else {
    if (!data.zh || !data.en) throw new Error('Both language objects must be preserved')
    for(const lang of ['zh','en'])if(typeof data[lang]!=='object'||Array.isArray(data[lang]))throw new Error('Invalid language object')
    if (kind === 'profile' && (typeof data.zh.name !== 'string' || typeof data.en.name !== 'string')) throw new Error('Profile names are required; use clear-content instead of deleting the page')
    if(kind==='profile'){
      for(const lang of ['zh','en']){
        for(const key of ['name','homeName','location','role','spoiler','intro','about','photoAlt','interests','contactIntro'])if(typeof data[lang][key]!=='string')throw new Error('Expected profile text: '+lang+'.'+key)
        const education=data[lang].education
        if(education!==undefined){
          if(!education||Array.isArray(education)||typeof education!=='object')throw new Error('Invalid education')
          for(const key of ['first','second'])if(typeof education[key]!=='string'||education[key].trimEnd().split(/\r?\n/).length>3)throw new Error('Education needs school, major and period on three lines: '+lang+'.'+key)
        }else for(const key of ['school','major','period'])if(typeof data[lang][key]!=='string')throw new Error('Expected profile text: '+lang+'.'+key)
      }
      for(const key of ['email','github','schoolUrl','avatar','photo'])if(typeof data[key]!=='string')throw new Error('Expected profile text: '+key)
      for(const key of ['avatar','photo'])if(data[key]&&!safeUrl(data[key],true))throw new Error('Invalid image: '+key)
      if(!data.avatar.trim())throw new Error('Choose a profile avatar before publishing')
      const avatarUrl=new URL(data.avatar,'https://cyril-fan.top')
      if(['cyril-fan.top','www.cyril-fan.top'].includes(avatarUrl.hostname)&&avatarUrl.pathname==='/avatar/avatar.png')throw new Error('Choose the source image, not the generated public avatar URL')
      if(data.github&&!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(data.github))throw new Error('Invalid GitHub username')
      if(data.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email))throw new Error('Invalid email')
    }
    if (kind === 'academic') for (const lang of ['zh','en']) {
      const a=data[lang]
      if(typeof a.background!=='string'||!['interests','publications','projects'].every(k=>Array.isArray(a[k])))throw new Error('Academic text and lists are required')
      for(const i of a.interests)if(typeof i.title!=='string'||!i.title.trim()||typeof i.description!=='string'||!['cpu','brain','image','robot','code','book','earth'].includes(i.icon))throw new Error('Invalid research interest')
      for(const p of [...a.publications,...a.projects]){
        if(typeof p.title!=='string'||!p.title.trim()||!Array.isArray(p.links))throw new Error('Academic title and links are required')
        for(const l of p.links)if(typeof l.type!=='string'||!safeUrl(l.href))throw new Error('Invalid academic link')
      }
      for(const p of a.publications){
        if(!['conference','journal','workshop','preprint'].includes(p.type)||!['published','accepted','under-review','preprint'].includes(p.status)||!Array.isArray(p.authors)||typeof p.venue!=='string'||typeof p.year!=='string')throw new Error('Invalid publication fields')
        for(const author of p.authors)if(typeof author.name!=='string'||!author.name.trim()||author.role&&!['corresponding','project-leader'].includes(author.role))throw new Error('Invalid author')
      }
      for(const p of a.projects)if(typeof p.description!=='string'||p.status&&!['active','completed','archived'].includes(p.status)||p.image&&!safeUrl(p.image,true)&&!/^[\w.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(p.image))throw new Error('Invalid project fields')
    }
  }
  checkLinks(data)
}
export function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new Error('Invalid base64')
  // Avoid Uint8Array.from(string, callback): its per-character iterator work
  // exceeds edge CPU budgets for full-resolution, lossless photos.
  const native=Uint8Array as typeof Uint8Array & {fromBase64?:(source:string)=>Uint8Array<ArrayBuffer>}
  if(native.fromBase64)return native.fromBase64(value)
  const binary=atob(value),bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
  return bytes
}
export function encodeBase64(data: Uint8Array) {
  let s=''; for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192)); return btoa(s)
}
export function validateImage(path: string, bytes: Uint8Array) {
  if (pathKind(path) !== 'media' || bytes.length < 12 || bytes.length > 8*1024*1024) throw new Error('Invalid image size (maximum 8 MB)')
  const ext=path.split('.').pop()!.toLowerCase(), ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end))
  const valid = ext==='png' ? ascii(1,4)==='PNG' && bytes[0]===137 :
    ['jpg','jpeg'].includes(ext) ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 :
    ext==='gif' ? /^GIF8[79]a$/.test(ascii(0,6)) :
    ext==='webp' ? ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP' :
    ext==='avif' ? ascii(4,8)==='ftyp' && /avif|avis/.test(ascii(8,32)) : false
  if (!valid) throw new Error('Image bytes do not match the extension')
}
export async function gitBlobHash(bytes: Uint8Array) {
  const header=new TextEncoder().encode('blob '+bytes.length+'\0'), all=new Uint8Array(header.length+bytes.length)
  all.set(header);all.set(bytes,header.length)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1',all))].map(x=>x.toString(16).padStart(2,'0')).join('')
}
export function fileReferences(source: string, imagePath: string, sourcePath = '') {
  const url=publicImage(imagePath), short=imagePath.split('/').pop()!
  if (source.includes(url) || source.includes(imagePath)) return true
  if ((source.match(/[^\s"'()<>`]+/g)||[]).some(value=>imageRepositoryPath(value,sourcePath)===imagePath))return true
  if (imagePath.startsWith('src/assets/') && source.includes(short)) return true
  if (imagePath.startsWith('src/content/') && sourcePath.startsWith(imagePath.slice(0,imagePath.lastIndexOf('/')+1)) && source.includes(short)) return true
  return false
}
export function newArticle(language='zh',category='tech') {
  return '---\n'+stringify({title:language==='en'?'Untitled':'未命名文章',description:'',publishDate:new Date().toISOString().slice(0,10),tags:[],category,language,comment:true,draft:false})+'---\n\n'
}

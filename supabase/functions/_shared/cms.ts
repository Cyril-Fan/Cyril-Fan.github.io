// Shared by the editor and the publisher. No privileged configuration belongs here.
export type Kind = 'post' | 'friend' | 'profile' | 'academic'
export type Payload = Record<string, any>
export type Document = { id: string; kind: Kind; revision: number; payload: Payload }
export type Field = { key: string; label: string; type?: 'text' | 'textarea' | 'markdown' | 'date' | 'checkbox' | 'image' | 'url' | 'email' | 'group' | 'list'; max?: number; required?: boolean; fields?: Field[]; hint?: string }
const text = (key: string, label: string, max = 200, required = false): Field => ({ key, label, max, required })
const md = (key: string, label: string): Field => ({ key, label, type: 'markdown', max: 100000 })
const url = (key: string, label: string, required = false): Field => ({ key, label, type: 'url', max: 2048, required })
const image = (key: string, label: string): Field => ({ key, label, type: 'image', max: 2048 })
const group = (key: string, label: string, fields: Field[]): Field => ({ key, label, type: 'group', fields })
const list = (key: string, label: string, fields: Field[]): Field => ({ key, label, type: 'list', fields, max: 60 })
const articleFields = [text('title', '标题', 60), text('description', '摘要', 160), md('body', '正文')]
const profileFields: Field[] = [
  text('name', '显示姓名', 80, true), text('homeName', '首页头像旁的名字', 80, true), text('location', '所在地', 80), text('role', '身份', 80), text('spoiler', '悬停显示的介绍', 80),
  { key: 'intro', label: '首页介绍', type: 'textarea', max: 3000 }, md('about', '关于页介绍'),
  text('photoAlt', '照片说明', 300), { key: 'interests', label: '研究兴趣（每行一项）', type: 'textarea', max: 2000 },
  text('school', '学校', 150), text('major', '专业', 150), text('period', '就读时间', 150), text('contactIntro', '联系区介绍', 500)
]
const academicFields: Field[] = [md('background', '学术背景'),
  { key: 'interests', label: '研究兴趣（每行一项）', type: 'textarea', max: 2000 },
  list('publications', '论文', [text('title', '标题', 300, true), text('authors', '作者', 500), text('venue', '出处 / 年份', 300), url('url', '论文网址'), md('summary', '补充说明')]),
  list('projects', '项目', [text('title', '名称', 200, true), url('url', '项目网址'), image('image', '图片'), md('summary', '说明')])]
export const schemas: Record<Kind, Field[]> = {
  post: [text('slug', '文章网址', 80, true), group('zh', '中文', articleFields), group('en', 'English（可留空）', articleFields),
    { key: 'publishDate', label: '发布日期', type: 'date', required: true }, text('category', '分类', 80), text('tags', '标签（逗号分隔）', 500), image('cover', '封面'), text('coverAlt', '封面说明', 300), { key: 'comment', label: '允许评论', type: 'checkbox' }],
  friend: [text('name', '名称', 100, true), text('intro', '简介', 300), url('link', '网站地址', true), image('avatar', '头像'), url('feed', 'RSS 地址（可留空）')],
  profile: [group('zh', '中文资料', profileFields), group('en', 'English profile', profileFields), image('avatar', '主页头像（留空沿用当前头像）'), image('photo', '关于页照片（留空沿用当前照片）'), { key: 'email', label: '公开联系邮箱', type: 'email', max: 254 }, text('github', 'GitHub 用户名', 39), url('schoolUrl', '学校链接')],
  academic: [group('zh', '中文', academicFields), group('en', 'English', academicFields)]
}
export const kindLabels: Record<Kind, string> = { post: '文章', friend: '友链', profile: '首页与关于', academic: '学术与项目' }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const mediaPattern = /^\/media\/([0-9a-f-]{36})\.webp$/
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function isKind(value: unknown): value is Kind { return typeof value === 'string' && Object.hasOwn(schemas, value) }
export function isId(value: string) { return value === 'profile' || value === 'academic' || UUID.test(value) }
export function safeUrl(value: string): boolean {
  try {
    const u = new URL(value), h = u.hostname.toLowerCase()
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && h.includes('.') && !h.startsWith('[') &&
      !/^[\d.]+$/.test(h) && !/\.(?:localhost|local|internal|test|invalid)$/.test(h) && !/[\s\u0000-\u001f]/.test(value)
  } catch { return false }
}
export function safeImage(value: string): boolean {
  return value === '' || /^\/links\/[a-z0-9-]+\.webp$/.test(value) || (mediaPattern.test(value) && UUID.test(value.match(mediaPattern)![1])) || safeUrl(value)
}
export function emptyPayload(kind: Kind): Payload {
  const fields = (items: Field[]): Payload => Object.fromEntries(items.map(f => [f.key, f.type === 'group' ? fields(f.fields!) : f.type === 'list' ? [] : f.type === 'checkbox' ? true : '']))
  const p = fields(schemas[kind])
  if (kind === 'post') p.publishDate = new Date().toISOString().slice(0, 10)
  return p
}
export function validatePayload(kind: Kind, input: unknown, publishing = false): Payload {
  if (JSON.stringify(input).length > 220000) throw new Error('内容过大，请将长文拆分为多篇文章。')
  const validate = (fields: Field[], value: any, prefix = ''): Payload => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${prefix}格式不正确`)
    if (Object.keys(value).some(k => !fields.some(f => f.key === k))) throw new Error(`${prefix}包含未知字段`)
    const result: Payload = {}
    for (const f of fields) {
      const v = value[f.key], label = `${prefix}${f.label}`
      if (f.type === 'group') { result[f.key] = validate(f.fields!, v ?? {}, `${label} · `); continue }
      if (f.type === 'list') {
        if (!Array.isArray(v) || v.length > (f.max || 60)) throw new Error(`${label}最多 ${f.max} 项`)
        result[f.key] = v.map(x => validate(f.fields!, x, `${label} · `)); continue
      }
      if (f.type === 'checkbox') { if (typeof v !== 'boolean') throw new Error(`${label}格式不正确`); result[f.key] = v; continue }
      if (typeof v !== 'string' || v.length > (f.max || 200) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error(`${label}过长或格式不正确`)
      const s = f.type === 'markdown' ? v.replace(/\r\n?/g, '\n') : v.trim()
      if (publishing && f.required && !s) throw new Error(`请填写${label}`)
      if (s && f.type === 'url' && !safeUrl(s)) throw new Error(`${label}须为公开网站的 HTTPS 地址`)
      if (f.type === 'image' && !safeImage(s)) throw new Error(`${label}须选择图片库图片或填写 HTTPS 图片地址`)
      if (s && f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s).toISOString().slice(0,10) !== s)) throw new Error(`${label}不是有效日期`)
      if (s && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error(`${label}格式不正确`)
      result[f.key] = s
    }
    return result
  }
  const p = validate(schemas[kind], input)
  if (kind === 'post') {
    if (p.slug && (!slugPattern.test(p.slug) || p.slug.length > 80)) throw new Error('文章网址请使用小写英文、数字及连字符。')
    if (publishing && (!p.zh.title || !p.zh.body || !p.zh.description)) throw new Error('发布文章需要中文标题、摘要和正文。')
    if (publishing && (p.en.title || p.en.body || p.en.description) && (!p.en.title || !p.en.body || !p.en.description)) throw new Error('英文版请填写完整的标题、摘要和正文，或全部留空。')
    if (publishing && p.publishDate > new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })) throw new Error('暂不支持定时发布，请选择今天或过去的日期。')
  }
  if (kind === 'profile' && p.github && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(p.github)) throw new Error('GitHub 用户名格式不正确。')
  if ((kind === 'friend' || kind === 'profile') && p.avatar && !/^\/(?:links\/[a-z0-9-]+|media\/[a-f0-9-]{36})\.webp$/.test(p.avatar)) throw new Error('头像请从图片库选择，统一使用本站的 WebP 图片。')
  return p
}
export function documentTitle(d: Pick<Document, 'kind' | 'payload'>): string { return String(d.kind === 'post' ? d.payload.zh?.title || '未命名文章' : d.kind === 'friend' ? d.payload.name || '未命名友链' : kindLabels[d.kind]) }
export function validateDocuments(input: unknown): Document[] {
  if (!Array.isArray(input) || input.length > 500) throw new Error('内容清单格式不正确或超过 500 项。')
  const ids = new Set<string>(), slugs = new Set<string>()
  return input.map(d => {
    if (!d || !isKind(d.kind) || !isId(d.id) || ids.has(d.id) || !Number.isSafeInteger(d.revision) || d.revision < 1) throw new Error('内容标识或版本号不正确。')
    if ((d.kind === 'profile' || d.kind === 'academic') ? d.id !== d.kind : !UUID.test(d.id)) throw new Error('内容标识与类型不一致。')
    ids.add(d.id)
    const payload = validatePayload(d.kind, d.payload, true)
    if (d.kind === 'post') { if (slugs.has(payload.slug)) throw new Error('文章网址重复。'); slugs.add(payload.slug) }
    return { id: d.id, kind: d.kind, revision: d.revision, payload }
  }).sort((a,b) => a.id.localeCompare(b.id, 'en'))
}
export function referencedMedia(input: unknown): string[] {
  const found = new Set<string>()
  const walk = (x: any) => {
    if (typeof x === 'string') for (const match of x.matchAll(/\/media\/([0-9a-f-]{36})\.webp/g)) { if (UUID.test(match[1])) found.add(match[1]) }
    else if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') Object.values(x).forEach(walk)
  }
  walk(input); return [...found].sort()
}
export function publicFiles(input: unknown, release: string): Map<string,string> {
  const docs = validateDocuments(input), files = new Map<string,string>()
  const json = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`
  const profile = docs.find(d => d.kind === 'profile'), academic = docs.find(d => d.kind === 'academic')
  if (!profile || !academic) throw new Error('个人资料和学术资料不能下架。')
  const manifest = json({ version: 1, documents: docs })
  if (new TextEncoder().encode(manifest).length > 14 * 1024 * 1024) throw new Error('已发布内容清单超过当前服务的 14 MB 容量，请先整理或联系维护者扩容。')
  files.set('src/data/cms-published.json', manifest)
  files.set('public/data/cms-release.json', json({ release }))
  const friends = docs.filter(d => d.kind === 'friend').map(d => { const p = d.payload; return { avatar: p.avatar, name: p.name, intro: p.intro, link: p.link, ...(p.feed ? { feed: p.feed } : {}) } }).sort((a,b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  files.set('public/links.json', json({ friends: [{ id_name: 'friends', desc: '', link_list: friends }] }))
  for (const d of docs.filter(d => d.kind === 'post')) {
    const p = d.payload
    for (const lang of ['zh', 'en']) {
      if (!p[lang].title) continue
      const front = { title: p[lang].title, description: p[lang].description, publishDate: p.publishDate, tags: [...new Set(p.tags.split(/[,，]/).map((t: string) => t.trim().toLowerCase()).filter(Boolean))], ...(p.category ? { category: p.category } : {}), language: lang, comment: p.comment, ...(p.cover ? { heroImage: { src: p.cover, alt: p.coverAlt } } : {}) }
      // YAML accepts JSON strings and objects; values can never break out of frontmatter.
      const header = Object.entries(front).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
      files.set(`src/content/blogs/${p.slug}/index${lang === 'en' ? '-en' : ''}.md`, `---\n${header}\n---\n\n${p[lang].body}\n`)
    }
  }
  return files
}
export function allowedPath(path: string): boolean {
  return ['src/data/cms-published.json', 'public/data/cms-release.json', 'public/links.json'].includes(path) || /^src\/content\/blogs\/[a-z0-9]+(?:-[a-z0-9]+)*\/index(?:-en)?\.md$/.test(path) || /^public\/media\/[0-9a-f-]{36}\.webp$/.test(path)
}
/** Reject metadata-bearing or malformed uploads before they enter public Git history. */
export function validateWebp(bytes: Uint8Array): void {
  const read = (p: number, n: number) => String.fromCharCode(...bytes.slice(p, p+n))
  if (bytes.length < 20 || bytes.length > 4*1024*1024 || read(0,4) !== 'RIFF' || read(8,4) !== 'WEBP') throw new Error('图片不是有效的 WebP 文件。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4,true) + 8 !== bytes.length) throw new Error('图片长度不正确。')
  let image = false, p = 12
  while (p + 8 <= bytes.length) {
    const tag = read(p,4), size = view.getUint32(p+4,true)
    if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(tag) || size > bytes.length - p - 8) throw new Error('图片含不支持的动画、元数据或损坏的数据。')
    if (tag === 'VP8 ' || tag === 'VP8L') image = true
    p += 8 + size + (size % 2)
  }
  if (!image || p !== bytes.length) throw new Error('图片不完整。')
}

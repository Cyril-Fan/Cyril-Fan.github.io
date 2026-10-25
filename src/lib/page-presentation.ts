import { Icons } from '../libs/icons'
import { articleMarkdown } from './article-markdown'
import { readingTime, tagUrl } from './blog-presentation'

export const escapeHTML = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const e = escapeHTML
export const safeDisplayUrl = (v: unknown, image = false) => {
  const s = String(v || '').trim()
  if (/[\u0000-\u001f\\]/.test(s)) return ''
  return /^https?:\/\//i.test(s) ||
    (!image && /^mailto:/i.test(s)) ||
    /^\/(?!\/)/.test(s) ||
    (image && /^blob:/.test(s))
    ? s
    : ''
}
export const iconHTML = (name: string) =>
  `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">${Object.hasOwn(Icons, name) ? Icons[name as keyof typeof Icons] : Icons.earth}</svg>`
export const dateHTML = (value: any, en = false) => {
  const d = new Date(value)
  return Number.isFinite(d.valueOf())
    ? `<time datetime="${d.toISOString()}">${e(new Intl.DateTimeFormat(en ? 'en-GB' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(d))}</time>`
    : '—'
}
export function renderArticleHeader(
  data: any,
  {
    en = false,
    minutes = '',
    image = '',
    fallback = false
  }: { en?: boolean; minutes?: string; image?: string; fallback?: boolean } = {}
) {
  const cover = safeDisplayUrl(image || data.heroImage?.src, true),
    published = new Date(data.publishDate),
    updated = new Date(data.updatedDate)
  const hasUpdate = Number.isFinite(updated.valueOf()) && updated > published
  return `${cover ? `<div class="hero-image"><img class="article-cover" src="${e(cover)}" alt="${e(data.heroImage?.alt || data.title)}" width="${Number(data.heroImage?.width) || 1200}" height="${Number(data.heroImage?.height) || 630}" fetchpriority="high" /></div>` : ''}
 <div class="article-info">${data.draft ? `<p class="content-notice">${en ? 'Unpublished draft' : '未公开草稿'}</p>` : ''}${fallback ? `<p class="content-notice" data-language-fallback>${en ? 'English translation is not available yet; the Chinese original is shown below.' : '暂无中文译文，以下展示原文。'}</p>` : ''}
 <div class="article-meta">${data.publishDate ? `<span>${iconHTML('calendar')}<span>${en ? 'Published ' : '发布于 '}${dateHTML(data.publishDate, en)}${hasUpdate ? ` / ${en ? 'Updated ' : '更新于 '}${dateHTML(data.updatedDate, en)}` : ''}</span></span>` : ''}${minutes ? `<span>${iconHTML('time')}${e(minutes)}</span>` : ''}
 ${data.language ? `<span>${iconHTML('earth')}${e(data.language)}</span>` : ''}
 ${(data.source || data.pixivLink) && safeDisplayUrl(data.source || 'https://www.pixiv.net/artworks/' + data.pixivLink) ? `<a href="${e(safeDisplayUrl(data.source || 'https://www.pixiv.net/artworks/' + data.pixivLink))}" target="_blank" rel="noopener noreferrer">${en ? 'Source' : '来源'} ↗</a>` : ''}
 </div>${data.tags?.length ? `<ul class="article-tags">${data.tags.map((tag: string) => `<li><a href="${tagUrl(tag, en)}" data-pagefind-filter="tag">${e(tag)}</a></li>`).join('')}</ul>` : ''}
 <h1>${e(data.title)}</h1>${data.description ? `<blockquote>${e(data.description)}</blockquote>` : ''}${data.comment && !data.draft ? `<a class="article-discussion-link" href="#comments">${en ? 'Join the conversation' : '参与讨论'}</a>` : ''}</div><div class="article-rule"></div>`
}
export const articleMinutes = readingTime
export function renderArticleNeighbors(
  items: { title: string; href: string; direction: string }[],
  en = false
) {
  return items
    .map(
      (item) =>
        `<a class="article-neighbor" data-direction="${item.direction === 'prev' ? 'prev' : 'next'}" href="${e(safeDisplayUrl(item.href))}"><span aria-hidden="true">${item.direction === 'prev' ? '←' : '→'}</span><span><small>${item.direction === 'prev' ? (en ? 'Previous' : '上一篇') : en ? 'Next' : '下一篇'}</small><strong>${e(item.title)}</strong></span></a>`
    )
    .join('')
}
const linkIcons: Record<string, string> = {
  code: 'github-circle',
  github: 'github-circle',
  pdf: 'document',
  paper: 'document',
  arxiv: 'document',
  doc: 'document',
  docs: 'document',
  video: 'play',
  dataset: 'database',
  slides: 'presentation',
  poster: 'image'
}
export function renderResourceLinks(links: any[] = []) {
  return `<div class="academic-links">${links
    .map((link) => {
      const href = safeDisplayUrl(link.href)
      return href
        ? `<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${iconHTML(linkIcons[link.type] || 'earth')}${e(link.label || link.type)}</a>`
        : ''
    })
    .join('')}</div>`
}
const types: Record<string, string> = {
  conference: '会议',
  journal: '期刊',
  workshop: '研讨会',
  preprint: '预印本'
}
const statuses: Record<string, string> = {
  published: '已发表',
  accepted: '已接收',
  'under-review': '审稿中',
  preprint: '预印本',
  active: '进行中',
  completed: '已完成',
  archived: '已归档'
}
const badge = (v: string, en: boolean) =>
  v
    ? `<span class="academic-badge" data-status="${e(v)}">${e(en ? v.replaceAll('-', ' ') : statuses[v] || types[v] || v)}</span>`
    : ''
export function renderPublication(p: any, en = false) {
  const authors = Array.isArray(p.authors) ? p.authors : [],
    image = safeDisplayUrl(p.image, true)
  const roles = [
    ['isEqual', '*', en ? 'Equal contribution' : '共同一作'],
    ['isCoreContributor', '§', en ? 'Core contributor' : '核心贡献者'],
    ['corresponding', '†', en ? 'Corresponding author' : '通讯作者'],
    ['project-leader', '‡', en ? 'Project leader' : '项目负责人']
  ]
  return `<article class="publication-card academic-card">${image ? `<img class="academic-image" src="${e(image)}" alt="${e(p.imageAlt || p.title)}" loading="lazy" />` : ''}<div class="academic-card-content"><h3>${e(p.title)}</h3><div class="academic-badges">${badge(p.type, en)}${p.status !== p.type ? badge(p.status, en) : ''}</div>
 <p class="academic-authors">${authors
   .map((a: any) => {
     const name = a.isMe ? `<strong>${e(a.name)}</strong>` : e(a.name),
       url = safeDisplayUrl(a.homepage)
     return (
       (url ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name) +
       roles
         .filter(([k]) => a[k] === true || a.role === k)
         .map(([, symbol]) => `<sup>${symbol}</sup>`)
         .join('')
     )
   })
   .join(', ')}</p>
 <p class="academic-author-notes">${roles
   .filter(([k]) => authors.some((a: any) => a[k] === true || a.role === k))
   .map(([, s, t]) => `<span><sup>${s}</sup>${t}</span>`)
   .join(
     ''
   )}${p.authorsAlphabetical ? `<span>${en ? 'Authors listed alphabetically' : '作者按字母顺序排列'}</span>` : ''}</p>
 <p class="academic-venue">${e(p.venue)}${p.venue && p.year ? ' · ' : ''}${e(p.year)}</p>${p.abstract ? `<p class="academic-description">${e(p.abstract)}</p>` : ''}${p.citations != null && p.citations > 0 ? `<p class="academic-citations">${Number(p.citations)} ${en ? 'citations' : '次引用'}</p>` : ''}${renderResourceLinks(p.links)}</div></article>`
}
export function groupAcademicYears(items: any[]) {
  const groups = new Map<string, any[]>()
  for (const p of items) {
    const year = String(p.year || '').trim()
    if (!groups.has(year)) groups.set(year, [])
    groups.get(year)!.push(p)
  }
  return [...groups].sort(([a], [b]) => Number(b || 0) - Number(a || 0) || b.localeCompare(a))
}
export function renderPublications(items: any[] = [], en = false, group = true) {
  return group
    ? groupAcademicYears(items)
        .map(
          ([year, pubs]) =>
            `<section class="publication-year"><h3 class="academic-year">${e(year || (en ? 'Other work' : '其他工作'))}</h3><div class="academic-stack">${pubs.map((p) => renderPublication(p, en)).join('')}</div></section>`
        )
        .join('')
    : `<div class="academic-stack">${items.map((p) => renderPublication(p, en)).join('')}</div>`
}
export function renderProjects(items: any[] = [], en = false) {
  return `<div class="academic-projects">${items
    .map((p) => {
      const image = safeDisplayUrl(p.image, true)
      return `<article class="project-card academic-card">${image ? `<img class="academic-image" src="${e(image)}" alt="${e(p.imageAlt || p.title)}" loading="lazy"/>` : ''}<div class="academic-card-content"><div class="project-heading"><h3>${e(p.title)}</h3>${p.status ? badge(p.status, en) : ''}</div>${p.category || p.year ? `<p class="academic-venue">${e([p.category, p.year].filter(Boolean).join(' · '))}</p>` : ''}<p class="academic-description">${e(p.description)}</p>${renderResourceLinks(p.links)}</div></article>`
    })
    .join('')}</div>`
}
export const academicHeadings = (en = false) => [
  { depth: 2, slug: 'about-me', text: en ? 'About Me' : '学术背景' },
  { depth: 2, slug: 'research-interests', text: en ? 'Research Interests' : '研究兴趣' },
  { depth: 2, slug: 'publications', text: en ? 'Selected Publications' : '论文' },
  { depth: 2, slug: 'open-source-projects', text: en ? 'Open-source Projects' : '开源项目' }
]
export function renderInterests(items: any[] = []) {
  return `<div class="interest-grid not-prose">${items.map((i) => `<div class="interest-card"><div class="interest-icon">${iconHTML(i.icon || 'cpu')}</div><div class="interest-text"><p class="interest-title">${e(i.title)}</p>${i.description ? `<p class="interest-description">${e(i.description)}</p>` : ''}</div></div>`).join('')}</div>`
}
export function renderAcademic(data: any, en = false) {
  const headings = academicHeadings(en),
    h = (n: number) =>
      `<h2 id="${headings[n].slug}">${headings[n].text}<a class="anchor" href="#${headings[n].slug}">#</a></h2>`,
    empty = (s: string) => `<p class="content-empty">${s}</p>`
  return (
    h(0) +
    `<div class="article-body">${articleMarkdown(data.background || '', en)}</div>` +
    (safeDisplayUrl(data.cv)
      ? `<a class="academic-cv" href="${e(safeDisplayUrl(data.cv))}" target="_blank" rel="noopener noreferrer">${en ? 'Download CV' : '下载简历'} ↗</a>`
      : '') +
    h(1) +
    ((data.interests || []).length
      ? renderInterests(data.interests)
      : empty(en ? 'Research interests will be added here.' : '研究兴趣将在这里更新。')) +
    h(2) +
    ((data.publications || []).length
      ? `<div class="not-prose">${renderPublications(data.publications, en)}</div>`
      : empty(en ? 'No publications to display yet.' : '暂无公开展示的论文。')) +
    h(3) +
    ((data.projects || []).length
      ? `<div class="not-prose">${renderProjects(data.projects, en)}</div>`
      : empty(en ? 'No projects to display yet.' : '暂无公开展示的项目。'))
  )
}

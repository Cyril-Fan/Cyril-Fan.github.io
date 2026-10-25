/** Stable Axi-style activity order; publication dates remain distinct in archives/metadata. */
export function postActivity(data: { publishDate: Date | string; updatedDate?: Date | string }) {
  return Math.max(
    new Date(data.publishDate).valueOf(),
    new Date(data.updatedDate || data.publishDate).valueOf()
  )
}
export function sortPosts<
  T extends { id: string; data: { publishDate: Date | string; updatedDate?: Date | string } }
>(posts: T[]): T[] {
  return [...posts].sort(
    (a, b) =>
      postActivity(b.data) - postActivity(a.data) ||
      new Date(b.data.publishDate).valueOf() - new Date(a.data.publishDate).valueOf() ||
      a.id.localeCompare(b.id, 'en')
  )
}
/** Reserved path separators need a filesystem-safe, reversible segment on GitHub Pages. */
export function tagSegment(tag: string) {
  return /[\/#?%\\~<>:"|*\u0000-\u001f]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
    tag
  )
    ? '~' + [...new TextEncoder().encode(tag)].map((x) => x.toString(16).padStart(2, '0')).join('')
    : tag
}
export function tagUrl(tag: string, en = false) {
  return (en ? '/en' : '') + '/tags/' + encodeURIComponent(tagSegment(tag))
}
export function readingTime(body: string, en = false) {
  const n = Math.max(1, Math.ceil((body.match(/[\u3400-\u9fff]|\b\w+\b/g) || []).length / 220))
  return en ? n + ' min read' : n + ' 分钟阅读'
}

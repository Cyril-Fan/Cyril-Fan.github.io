import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import type { Root as MarkdownRoot, RootContent as MarkdownContent } from 'mdast'
import type { Root, Element } from 'hast'

// Stored comments remain Markdown source. Never run raw HTML, user plugins,
// remote embeds, or KaTeX's trusted commands in a visitor's session.
function literalHtml() {
  return (tree: MarkdownRoot) => {
    const walk = (parent: { children: MarkdownContent[] }) => {
      parent.children = parent.children.map(node => {
        if (node.type === 'html') return { type: 'text', value: node.value }
        if ('children' in node) walk(node as { children: MarkdownContent[] })
        return node
      })
    }
    walk(tree)
  }
}

function boundedMathInput() {
  return (tree: MarkdownRoot) => {
    let formulas = 0
    const walk = (parent: { children: MarkdownContent[] }) => {
      parent.children = parent.children.map(node => {
        if (node.type === 'math' || node.type === 'inlineMath') {
          // Cap work before KaTeX runs, as well as bounding its resulting DOM.
          // Keep excess input readable without silently removing a user's text.
          if (++formulas > 32 || node.value.length > 1000) {
            const delimiter = node.type === 'math' ? '$$' : '$'
            return { type: 'text', value: `${delimiter}${node.value}${delimiter}` }
          }
        }
        if ('children' in node) walk(node as { children: MarkdownContent[] })
        return node
      })
    }
    walk(tree)
  }
}

const schema: SanitizeOptions = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'], src: ['https'] },
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
}

function elements(tree: Root, run: (node: Element) => void) {
  const walk = (node: Root | Element) => {
    if (node.type === 'element') run(node)
    for (const child of node.children) if (child.type === 'element') walk(child)
  }
  walk(tree)
}

function safeImage(source: string): string | null {
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    // Comments must not turn image clicks into requests to local services.
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.startsWith('[') || /^(?:0|10|127|169\.254|192\.168)\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null
    return url.href
  } catch { return null }
}

function commentHtml(options: { scope: string }) {
  return (tree: Root) => {
    // Footnotes from separate comments must never share IDs or steal focus
    // from a form field. Only parser-generated, sanitized IDs reach this step.
    const idMap = new Map<string, string>()
    let sequence = 0
    elements(tree, node => {
      if (!node.properties.id) return
      const original = String(node.properties.id)
      const scoped = `comment-md-${options.scope}-${++sequence}`
      idMap.set(original, scoped)
      idMap.set(original.replace(/^user-content-/, ''), scoped)
      node.properties.id = scoped
    })
    elements(tree, node => {
      if (node.tagName === 'a') {
        const href = String(node.properties.href ?? '')
        if (href.startsWith('#') && idMap.has(href.slice(1))) node.properties.href = `#${idMap.get(href.slice(1))}`
        else if (href) {
          try {
            const url = new URL(href, 'https://cyril-fan.top/')
            if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) delete node.properties.href
            else if (url.protocol !== 'mailto:' && !href.startsWith('#')) {
              node.properties.target = '_blank'
              node.properties.rel = ['noopener', 'noreferrer', 'nofollow', 'ugc']
            }
          } catch { delete node.properties.href }
        }
        if (node.properties.ariaDescribedBy) {
          const values = Array.isArray(node.properties.ariaDescribedBy) ? node.properties.ariaDescribedBy : [node.properties.ariaDescribedBy]
          node.properties.ariaDescribedBy = values.map(value => idMap.get(String(value)) ?? String(value))
        }
      }
      if (node.tagName === 'img') {
        const source = safeImage(String(node.properties.src ?? ''))
        const alt = String(node.properties.alt ?? '')
        node.tagName = 'span'
        node.properties = source ? { className: ['comment-markdown-image'], dataMarkdownImage: source, dataImageAlt: alt } : {}
        node.children = [{ type: 'text', value: alt }]
      }
    })
  }
}

function boundedMath() {
  return (tree: Root) => {
    let totalElements = 0
    elements(tree, node => {
      if (!Array.isArray(node.properties.className) || !node.properties.className.includes('katex')) return
      let unsafe = false, count = 0, original = ''
      elements({ type: 'root', children: [node] }, part => {
        if (++count > 4000) unsafe = true
        if (part.tagName === 'annotation' && part.properties.encoding === 'application/x-tex') {
          original = part.children.filter(child => child.type === 'text').map(child => child.value).join('')
        }
        // KaTeX maxSize caps positive user sizes only. Reject a formula with
        // excessive generated lengths (including negative kern/raisebox values)
        // instead of letting its layout escape the comment or silently changing it.
        const styles = String(part.properties.style ?? '')
        if (/(?:NaN|Infinity)/i.test(styles)) unsafe = true
        for (const match of styles.matchAll(/(-?(?:\d*\.?\d+)(?:e[+-]?\d+)?)\s*(em|ex|px|pt|cm|mm|in|pc|%)(?![a-z])/gi)) {
          const value = Math.abs(Number(match[1]))
          const limit = /^(?:em|ex)$/i.test(match[2]) ? 50 : match[2] === '%' ? 100 : 800
          if (!Number.isFinite(value) || value > limit) unsafe = true
        }
      })
      if (unsafe) {
        node.tagName = 'code'
        node.properties = { className: ['comment-math-fallback'] }
        node.children = [{ type: 'text', value: original ? `$${original}$` : '[Formula is too large to display]' }]
      }
      else if (totalElements + count > 5000) {
        node.tagName = 'code'
        node.properties = { className: ['comment-math-fallback'] }
        node.children = [{ type: 'text', value: `$${original}$` }]
      }
      else totalElements += count
    })
  }
}

let scopeSequence = 0

// Keep KaTeX's inner layout intact. Only the outer wrapper may scroll, so a
// fraction's strut or integral depth never creates a scrollbar beside a formula.
function mathLayout() {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      parent.children = parent.children.map(node => {
        if (node.type !== 'element') return node
        const classes = node.properties.className
        if (Array.isArray(classes) && classes.includes('katex')) {
          if (parent.type === 'element' && Array.isArray(parent.properties.className) && parent.properties.className.includes('katex-display')) return node
          return { type: 'element', tagName: 'span', properties: { className: ['comment-math-inline'] }, children: [node] }
        }
        walk(node)
        return node
      })
    }
    walk(tree)
  }
}

/** Safe CommonMark + GFM + TeX, with no network requests during rendering. */
export function commentMarkdownHtml(source: string, en: boolean, scope = String(++scopeSequence)): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || String(++scopeSequence)
  return String(unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(literalHtml)
    .use(boundedMathInput)
    .use(remarkBreaks)
    .use(remarkRehype, {
      footnoteLabel: en ? 'Footnotes' : '注释',
      footnoteBackLabel: (index: number) => en ? `Back to reference ${index + 1}` : `返回第 ${index + 1} 处引用`,
    })
    .use(rehypeSanitize, schema)
    .use(commentHtml, { scope: safeScope })
    // Official rehype-sanitize guidance: sanitize first, then the trusted math
    // renderer. Allowing arbitrary input styles/MathML in the schema is unsafe.
    .use(rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 100, maxSize: 10 })
    .use(boundedMath)
    .use(mathLayout)
    .use(rehypeStringify)
    .processSync(Array.from(source).slice(0, 2000).join('')))
}

export function renderCommentMarkdown(target: HTMLElement, source: string, en: boolean, scope?: string) {
  try { target.innerHTML = commentMarkdownHtml(source, en, scope) }
  catch { target.textContent = source }
  target.classList.add('article-body')
  if(target.querySelector('pre code'))void import('./content-render').then(({enhanceArticle})=>enhanceArticle(target)).catch(()=>{/* Plain code remains readable if highlighting cannot load. */})
  target.querySelectorAll<HTMLElement>('[data-markdown-image]').forEach(placeholder => {
    const url = placeholder.dataset.markdownImage!
    const host = new URL(url).hostname
    const doc = target.ownerDocument
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'comment-load-image'
    button.textContent = en ? `Load image from ${host}` : `加载来自 ${host} 的图片`
    button.title = en ? 'Loading contacts this external website. Your page address is not sent.' : '点击后会连接图片网站，不会发送当前页面地址。'
    const alt = placeholder.dataset.imageAlt ?? ''
    placeholder.replaceChildren()
    if (alt) {
      const description = doc.createElement('span')
      description.textContent = alt
      placeholder.append(description)
    }
    placeholder.append(button)
    button.addEventListener('click', event => {
      // A Markdown image may itself be wrapped in a link. Loading the image
      // must not also follow that surrounding link.
      event.preventDefault()
      event.stopPropagation()
      const image = doc.createElement('img')
      image.alt = alt
      image.loading = 'lazy'
      image.decoding = 'async'
      image.referrerPolicy = 'no-referrer'
      image.src = url
      image.addEventListener('error', () => {
        image.remove()
        button.hidden = false
        button.textContent = en ? `Image could not load · Retry ${host}` : `图片加载失败 · 重试 ${host}`
      }, { once: true })
      button.hidden = true
      placeholder.append(image)
    })
  })
}

import type { MarkdownHeading } from 'astro'

export interface TocItem extends MarkdownHeading {
  subheadings: TocItem[]
}

/** Tolerate skipped levels and documents beginning with h3/h4. */
export function generateToc(headings: readonly MarkdownHeading[]) {
  const toc: TocItem[] = [],
    stack: TocItem[] = []
  for (const h of headings.filter((h) => h.depth > 1)) {
    const item: TocItem = { ...h, text: h.text.replace(/\s*#\s*$/, ''), subheadings: [] }
    while (stack.length && stack[stack.length - 1].depth >= item.depth) stack.pop()
    if (stack.length) stack[stack.length - 1].subheadings.push(item)
    else toc.push(item)
    stack.push(item)
  }
  return toc
}

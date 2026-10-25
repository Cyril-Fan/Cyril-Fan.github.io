import { generateToc } from '../plugins/toc'
import { escapeHTML as e } from './page-presentation'

export function tocMarkup(headings: { depth: number; slug: string; text: string }[], en = false) {
  const list = (items: ReturnType<typeof generateToc>): string =>
    items
      .map(
        (h) =>
          `<li><div class="relative"><span data-toc-progress aria-hidden="true" class="absolute top-[5%] w-[2px] rounded transition-colors duration-300 [&.highlight-bg]:bg-primary [&.readed]:bg-input"></span><a aria-label="${en ? 'Go to section' : '跳转到章节'}：${e(h.text)}" class="toc-link line-clamp-2 px-3 py-1 ms-2 flex-1 text-foreground/75 transition-all hover:text-foreground [&.highlight]:font-medium [&.highlight]:text-primary [&.readed]:text-input [&.highlight-bg-translucent]:bg-muted" style="padding-inline-start:${Math.min(4, Math.max(0, h.depth - 2)) * 0.8 + 0.75}rem" href="#${encodeURIComponent(h.slug)}">${e(h.text)}</a></div>${h.subheadings.length ? '<ul>' + list(h.subheadings) + '</ul>' : ''}</li>`
      )
      .join('')
  return `<h2 class="font-semibold">${en ? 'CONTENTS' : '目录'}</h2><ul class="mt-4 text-card-foreground">${list(generateToc(headings))}</ul>`
}

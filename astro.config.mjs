// @ts-check

import { rehypeHeadingIds, unified } from '@astrojs/markdown-remark'
import tailwindcss from '@tailwindcss/vite'
// Integrations
import AstroAxiIntegration from './src/axi-integration.ts'
import { defineConfig } from 'astro/config'
// Rehype & remark packages
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import { literalArticleHtml, boundedArticleMath, articleMathOptions } from './src/lib/article-markdown.ts'

// Others
// import { visualizer } from 'rollup-plugin-visualizer'

// Local integrations
// Local rehype & remark plugins
import rehypeAutolinkHeadings from './src/plugins/rehype-auto-link-headings.ts'
// Shiki
import {
  addCopyButton,
  addLanguage,
  addTitle,
  transformerNotationDiff,
  transformerNotationHighlight,
  updateStyle
} from './src/plugins/shiki-transformers.ts'
import config from './src/site.config.ts'
import { codeThemes } from './src/lib/code-themes.ts'

// https://astro.build/config
export default defineConfig({
  // Top-Level Options
  site: 'https://cyril-fan.top',
  // base: '/docs',
  trailingSlash: 'never',
  redirects: {
    '/blog': '/blog/all',
    '/en/blog': '/en/blog/all',
    '/blog/journal': '/blog/daily',
    '/blog/month-journal': '/blog/daily',
    '/en/blog/journal': '/en/blog/daily',
    '/en/blog/month-journal': '/en/blog/daily'
  },

  // Internationalization
  i18n: {
    locales: ['zh', 'en'],
    defaultLocale: 'zh',
    routing: {
      prefixDefaultLocale: false
    }
  },

  output: 'static',
  compressHTML: true,

  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp'
    }
  },

  integrations: [
    // astro-axi will automatically add sitemap, mdx & tailwind
    // sitemap(),
    // mdx(),
    // tailwind({ applyBaseStyles: false }),
    AstroAxiIntegration(config)
    // (await import('@playform/compress')).default({
    //   SVG: false,
    //   Exclude: ['index.*.js']
    // }),

    // Temporary fix vercel adapter
    // static build method is not needed
  ],
  // root: './my-project-directory',

  // Prefetch Options
  prefetch: true,
  // Server Options
  server: {
    host: '127.0.0.1'
  },
  // Markdown Options
  markdown: {
    processor: unified({
    remarkPlugins: [remarkMath, remarkGfm, literalArticleHtml, boundedArticleMath],
    rehypePlugins: [
      rehypeHeadingIds,
      [rehypeKatex, articleMathOptions],
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          properties: { className: ['anchor'] },
          content: { type: 'text', value: '#' }
        }
      ]
    ],
    remarkRehype: {
      footnoteLabel: '脚注',
      footnoteBackLabel: '返回内容',
      footnoteBackContent: '↑'
    },
    }),
    // https://docs.astro.build/en/guides/syntax-highlighting/
    shikiConfig: {
      themes: codeThemes,
      defaultColor: false,
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        updateStyle(),
        addTitle(),
        addLanguage(),
        addCopyButton(2000)
      ]
    }
  },
  vite: {
    plugins: [tailwindcss()],
    // plugins: [
    //   visualizer({
    //     emitFile: true,
    //     filename: 'stats.html'
    //   })
    // ]
  }
})

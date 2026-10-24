import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pagefind from 'pagefind'
// Astro
import type { AstroIntegration, RehypePlugins, RemarkPlugins } from 'astro'
// Integrations
import { isUnifiedProcessor, unified } from '@astrojs/markdown-remark'
import sitemap from '@astrojs/sitemap'
import rehypeExternalLinks from 'rehype-external-links'

import { remarkAddZoomable, remarkReadingTime } from './plugins/remark-plugins'
import { vitePluginUserConfig } from './plugins/virtual-user-config'
import { UserConfigSchema, type UserInputConfig } from './types/user-config'
import { parseWithFriendlyErrors } from './utils/error-map'
import { generateBranding } from '../scripts/generate-branding.mjs'
import { verifySiteOutput } from '../scripts/verify-site-output.mjs'

export default function AstroAxiIntegration(opts: UserInputConfig): AstroIntegration {
  let integrations: AstroIntegration[] = []
  let remarkPlugins: RemarkPlugins = []
  let rehypePlugins: RehypePlugins = []
  return {
    name: 'astro-axi',
    hooks: {
      'astro:config:setup': async ({ config, updateConfig }) => {
        await generateBranding()
        let userConfig = parseWithFriendlyErrors(
          UserConfigSchema,
          opts,
          'Invalid config passed to astro-axi integration'
        )

        // Add built-in integrations only if they are not already added by the user through the
        // config or by a plugin.
        const allIntegrations = [...config.integrations, ...integrations]
        if (!allIntegrations.find(({ name }) => name === '@astrojs/sitemap')) {
          integrations.push(sitemap({ filter: (page) => !/^\/(?:en\/)?(?:auth\/|admin(?:\/|$))/.test(new URL(page).pathname) }))
        }
        // Owner-authored MDX is data, never compiled as JavaScript.

        // Add supported remark plugins based on user config.
        if (userConfig.integ.mediumZoom.enable)
          remarkPlugins.push([remarkAddZoomable, userConfig.integ.mediumZoom.options])
        remarkPlugins.push(remarkReadingTime)

        // Add supported rehype plugins based on user config.
        rehypePlugins.push([
          rehypeExternalLinks,
          {
            content: { type: 'text', value: userConfig.content?.externalLinksContent || ' ↗' },
            target: '_blank',
            rel: ['nofollow', 'noopener', 'noreferrer']
          }
        ])
        // Add Starlight directives restoration integration at the end of the list so that remark
        // plugins injected by Starlight plugins through Astro integrations can handle text and
        // leaf directives before they are transformed back to their original form.
        // integrations.push(starlightDirectivesRestorationIntegration())

        // Add integrations immediately after Starlight in the config array.
        // e.g. if a user has `integrations: [starlight(), tailwind()]`, then the order will be
        // `[starlight(), expressiveCode(), sitemap(), mdx(), tailwind()]`.
        // This ensures users can add integrations before/after Starlight and we respect that order.
        const selfIndex = config.integrations.findIndex((i) => i.name === 'astro-axi')
        config.integrations.splice(selfIndex + 1, 0, ...integrations)

        const processor = config.markdown.processor
        if (!isUnifiedProcessor(processor)) throw new Error('Axi Markdown plugins require the unified processor.')
        updateConfig({
          vite: {
            // @ts-ignore
            plugins: [vitePluginUserConfig(userConfig, config)]
          },
          markdown: {
            processor: unified({
              ...processor.options,
              remarkPlugins: [...processor.options.remarkPlugins, ...remarkPlugins],
              rehypePlugins: [...processor.options.rehypePlugins, ...rehypePlugins]
            })
            // rehypePlugins: [rehypeRtlCodeSupport()],
            // shikiConfig:
            // Configure Shiki theme if the user is using the default github-dark theme.
            //   config.markdown.shikiConfig.theme !== 'github-dark' ? {} : { theme: 'css-variables' }
          },
          scopedStyleStrategy: 'where',
          // If not already configured, default to prefetching all links on hover.
          prefetch: config.prefetch ?? { prefetchAll: true }
        })
      },

      'astro:build:done': async ({ dir }) => {
        await verifySiteOutput(fileURLToPath(dir))
        if (!opts.integ.pagefind) return
        const targetDir = fileURLToPath(dir)
        try {
          const created = await pagefind.createIndex()
          if (!created.index || created.errors.length) {
            throw new Error(`Pagefind: ${created.errors.join('; ')}`)
          }
          const indexed = await created.index.addDirectory({ path: targetDir })
          if (indexed.errors.length) throw new Error(indexed.errors.join('; '))
          const written = await created.index.writeFiles({ outputPath: join(targetDir, 'pagefind') })
          if (written.errors.length) throw new Error(written.errors.join('; '))
          console.log(`[pagefind] Indexed ${indexed.page_count} pages.`)
        } finally {
          await pagefind.close()
        }
      }
    }
  }
}

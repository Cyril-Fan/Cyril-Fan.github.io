import type { APIRoute, ImageMetadata } from 'astro'
import { getImage } from 'astro:assets'
import type { CollectionEntry } from 'astro:content'
import rss from '@astrojs/rss'
import type { Root } from 'mdast'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import config from '@/site-config'

import { getBlogCollection, sortMDByDate } from '@/server'

// Get dynamic import of images as a map collection
const imagesGlob = import.meta.glob<{ default: ImageMetadata }>(
  '/src/content/blogs/**/*.{jpeg,jpg,png,gif}' // add more image formats if needed
)

const renderContent = async (post: CollectionEntry<'blog'>, site: URL) => {
  // Replace image links with the correct path
  function remarkReplaceImageLink() {
    /**
     * @param {Root} tree
     */
    return async function (tree: Root) {
      const promises: Promise<void>[] = []
      visit(tree, 'image', (node) => {
        if (node.url.startsWith('/images')) {
          node.url = `${site}${node.url.replace('/', '')}`
        } else {
          const imagePathPrefix = `/src/content/blogs/${post.id}/${node.url.replace('./', '')}`
          const promise = imagesGlob[imagePathPrefix]?.().then(async (res) => {
            const imagePath = res?.default
            if (imagePath) {
              node.url = `${site}${(await getImage({ src: imagePath })).src.replace('/', '')}`
            }
          })
          if (promise) promises.push(promise)
        }
      })
      await Promise.all(promises)
    }
  }

  const file = await unified()
    .use(remarkParse)
    .use(remarkReplaceImageLink)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(post.body || '')

  return String(file)
}

const GET: APIRoute = async (context) => {
  const allPostsByDate = sortMDByDate(await getBlogCollection()) as CollectionEntry<'blog'>[]
  const siteUrl = context.site ?? new URL(import.meta.env.SITE)

  return rss({
    // Basic configs
    trailingSlash: false,
    xmlns: { h: 'http://www.w3.org/TR/html4/' },
    stylesheet: '/scripts/pretty-feed-v3.xsl',

    // Contents
    title: config.title,
    description: config.description || 'A blog built with Astro',
    site: siteUrl,
    items: await Promise.all(
      allPostsByDate.map(async (post) => {
        const heroImage = post.data.heroImage?.src
        const imageSrc = typeof heroImage === 'string' ? heroImage : heroImage?.src
        const imageUrl = imageSrc ? new URL(imageSrc, siteUrl).href.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : undefined
        return {
          ...post.data,
          pubDate: post.data.publishDate,
          link: `/blog/${post.id}`,
          ...(imageUrl ? { customData: `<h:img src="${imageUrl}" />` } : {}),
          content: await renderContent(post, siteUrl)
        }
      })
    )
  })
}

export { GET }

import type { APIRoute } from 'astro'
import type { CollectionEntry } from 'astro:content'
import rss from '@astrojs/rss'
import config from '@/site-config'
import { getBlogCollection,sortMDByDate } from '@/server'
import { articleMarkdown } from '../lib/article-markdown'
import { contentImage,resolveArticleImages } from '../lib/content-image'
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
        const imageSrc = contentImage(heroImage,post.filePath)
        const imageUrl = imageSrc ? new URL(imageSrc, siteUrl).href.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : undefined
        return {
          title:post.data.title,
          description:post.data.description,
          pubDate: post.data.publishDate,
          link: `/blog/${post.id}`,
          ...(imageUrl ? { customData: `<h:img src="${imageUrl}" />` } : {}),
          content: resolveArticleImages(articleMarkdown(post.body||''),post.filePath).replace(/(src|href)="\//g,'$1="'+siteUrl.href)
        }
      })
    )
  })
}

export { GET }

import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { contentFiles } from './lib/content-loader'
const heroImage=z.object({src:z.string(),alt:z.string().optional(),inferSize:z.boolean().optional(),width:z.number().positive().optional(),height:z.number().positive().optional(),color:z.string().optional()}).passthrough().optional()
const blogSchema=z.object({title:z.string().max(60),description:z.string().max(160),publishDate:z.coerce.date(),updatedDate:z.coerce.date().optional(),heroImage,tags:z.array(z.string()).default([]).transform(tags=>[...new Set(tags.map(t=>t.toLowerCase()))]),category:z.string().optional(),language:z.string().optional(),draft:z.boolean().default(false),comment:z.boolean().default(true),pixivLink:z.string().optional(),source:z.string().optional()}).passthrough()
const blog=defineCollection({loader:contentFiles('blog'),schema:blogSchema})
const blogEn=defineCollection({loader:contentFiles('blogEn'),schema:blogSchema})
const postCollections=defineCollection({loader:contentFiles('collection'),schema:z.object({title:z.string(),title_en:z.string().optional(),description:z.string().optional(),description_en:z.string().optional(),heroImage,bloglist:z.array(z.string()).default([])}).passthrough()})
export const collections={blog,blogEn,postCollections}

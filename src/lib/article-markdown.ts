import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'

/** Raw HTML is text, not executable content, in both previews and published posts. */
export function literalArticleHtml() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node.children) return
      node.children = node.children.map((n: any) => n.type === 'html' ? { type:'text', value:n.value } : (walk(n),n))
    }; walk(tree)
  }
}
export function boundedArticleMath() {
  return (tree: any) => {
    let count=0
    const walk=(node: any)=>{
      if(!node.children)return
      node.children=node.children.map((n: any)=>{
        if((n.type==='math'||n.type==='inlineMath')&&(++count>256||n.value.length>2000))return {type:'text',value:`${n.type==='math'?'$$':'$'}${n.value}${n.type==='math'?'$$':'$'}`}
        walk(n);return n
      })
    };walk(tree)
  }
}
export const articleMathOptions = { trust:false, strict:'ignore' as const, maxExpand:100, maxSize:10 }
export function articleMarkdown(source: string): string {
  return String(unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(literalArticleHtml).use(boundedArticleMath)
    .use(remarkRehype).use(rehypeSanitize,{...defaultSchema,attributes:{...defaultSchema.attributes,code:[['className',/^language-./,'math-inline','math-display']]}})
    .use(rehypeKatex,articleMathOptions).use(rehypeStringify).processSync(source.slice(0,100000)))
}

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'

/** Data-only theme syntax shared by the editor and published articles. */
export function prepareThemeSource(source: string): string {
  let fence='',math=false
  return source.split('\n').map(line=>{
    const marker=line.match(/^\s*(```+|~~~+)/)
    if(marker){fence=fence?'':marker[1];return line}
    if(fence)return line
    if(/^\s*\$\$/.test(line)&&((line.match(/\$\$/g)||[]).length%2))math=!math
    if(math)return line
    let value=line
    const open=line.match(/^\s*<(Aside|Collapse|Steps|Spoiler)((?:\s+(?:type|title)="[^"<>]*")*)\s*>\s*$/)
    if(open){
      const title=open[2].match(/\btitle="([^"]*)"/)?.[1]||'',type=open[2].match(/\btype="([^"]*)"/)?.[1]||'note'
      value=':::'+(open[1]==='Aside'?type:open[1]==='Collapse'?'details':open[1].toLowerCase())+' '+title
    }else if(/^\s*<\/(?:Aside|Collapse|Steps|Spoiler)>\s*$/.test(line))value=':::'
    if(/^\s*:::(?:(?:note|tip|caution|danger|details|steps|spoiler)(?:\s.*)?)?\s*$/.test(value))return '\n'+value+'\n'
    return value
  }).join('\n')
}
function themeBlocks(){
  return (tree:any)=>{
    const marker=(n:any)=>n.type==='paragraph'&&n.children?.length===1&&n.children[0].type==='text'?n.children[0].value.trim():null
    const process=(children:any[]):any[]=>{
      const output:any[]=[]
      for(let i=0;i<children.length;i++){
        const m=marker(children[i])?.match(/^:::(note|tip|caution|danger|details|steps|spoiler)(?:\s+(.*))?$/)
        if(m){
          let depth=1,j=i+1
          for(;j<children.length;j++){const value=marker(children[j]);if(/^:::\w/.test(value||''))depth++;else if(value===':::')depth--;if(!depth)break}
          if(!depth){
            const kind=m[1],title=m[2]|| (kind==='details'?'Details':kind.toUpperCase()),content=process(children.slice(i+1,j))
            const heading={type:'paragraph',data:{hName:kind==='details'?'summary':'p',hProperties:{className:['theme-block-title']}},children:[{type:'text',value:title}]}
            output.push({type:'blockquote',data:{hName:kind==='details'?'details':kind==='steps'?'div':'aside',hProperties:{className:['theme-block','theme-'+kind]}},children:kind==='steps'?content:[heading,...content]});i=j;continue
          }
        }
        const n=children[i];if(n.children)n.children=process(n.children);output.push(n)
      }
      return output
    };tree.children=process(tree.children)
  }
}
function codeMetadata(){return (tree:any)=>{const walk=(n:any)=>{if(n.type==='code'&&n.meta){n.data||={};n.data.hProperties={...n.data.hProperties,dataMeta:n.meta}};for(const c of n.children||[])walk(c)};walk(tree)}}
function articleStructure(options:{en?:boolean}={}){
  return (tree:any)=>{
    const used=new Map<string,number>()
    const text=(n:any):string=>n.type==='text'?n.value:(n.children||[]).map(text).join('')
    const visit=(n:any)=>{
      if(n.type==='element'&&/^h[1-6]$/.test(n.tagName)){
        const base=text(n).trim().toLowerCase().replace(/[\s]+/g,'-').replace(/[^\p{L}\p{N}_-]/gu,'')||'section',count=used.get(base)||0
        used.set(base,count+1);const id=n.properties?.id||(base==='comments'?'article-comments':base)+(count?'-'+count:'');n.properties||={};n.properties.id=id
        n.children.push({type:'element',tagName:'a',properties:{href:'#'+id,className:['anchor'],'ariaLabel':options.en?'Link to section':'跳转到此章节'},children:[{type:'text',value:'#'}]})
      }
      if(n.type==='element'&&n.tagName==='img'){n.properties||={};n.properties.className=['zoomable'];n.properties.loading='lazy'}
      if(n.type==='element'&&n.tagName==='a'&&/^https:\/\//.test(n.properties?.href||'')){n.properties.target='_blank';n.properties.rel=['noopener','noreferrer'];n.properties.className=['external-link']}
      for(const c of n.children||[])visit(c)
    };visit(tree)
  }
}

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
export function articleMarkdown(source: string,en=false): string {
  return String(unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(literalArticleHtml).use(themeBlocks).use(codeMetadata).use(boundedArticleMath)
    // remark-rehype already prefixes footnote IDs. Raw HTML is literal text, so
    // sanitizing a second prefix would break every footnote/back-reference link.
    .use(remarkRehype,{footnoteLabel:en?'Footnotes':'脚注',footnoteBackLabel:en?'Back to reference':'返回引用'}).use(rehypeSanitize,{...defaultSchema,clobberPrefix:'',tagNames:[...defaultSchema.tagNames!,'aside','details','summary'],attributes:{...defaultSchema.attributes,'*':[...(defaultSchema.attributes?.['*']||[]),['className',/^theme-/]],code:[['className',/^language-./,'math-inline','math-display'],'dataMeta']}})
    .use(rehypeKatex,articleMathOptions).use(articleStructure,{en}).use(rehypeStringify).processSync(prepareThemeSource(source.slice(0,500000))))
}

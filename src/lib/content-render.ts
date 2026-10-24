import { articleMarkdown } from './article-markdown'
import { createHighlighter, bundledLanguages } from 'shiki/bundle/web'
import rust from '@shikijs/langs/rust'
import go from '@shikijs/langs/go'
import latex from '@shikijs/langs/latex'
import csharp from '@shikijs/langs/csharp'
import kotlin from '@shikijs/langs/kotlin'
import swift from '@shikijs/langs/swift'
import powershell from '@shikijs/langs/powershell'
import dockerfile from '@shikijs/langs/dockerfile'
import toml from '@shikijs/langs/toml'
import diff from '@shikijs/langs/diff'
import mediumZoom from 'medium-zoom'
import { codeThemes } from './code-themes'
import { transformerNotationDiff, transformerNotationHighlight } from '../plugins/shiki-official-transformers'
const extraLanguages={rust,go,latex,csharp,kotlin,swift,powershell,dockerfile,toml,diff}
let highlighter:ReturnType<typeof createHighlighter>|undefined
const decode=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|#39|#x27);|&#(?:x[0-9a-f]+|\d+);/gi,v=>{
  const known:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'"}
  return known[v]??String.fromCodePoint(v.startsWith('&#x')?parseInt(v.slice(3,-1),16):parseInt(v.slice(2,-1),10))
})
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
export async function highlightCode(code:string,language:string,meta=''){
  language=language.trim().toLowerCase()
  // Unlabelled existing C++ comments are recognizable without guessing at prose.
  if(language==='text'&&/^\s*#include\s*[<"](?:iostream|bits\/stdc\+\+\.h|vector|string|cstdio)[>"]/m.test(code))language='cpp'
  language=({js:'javascript',ts:'typescript',sh:'bash',shell:'bash',py:'python',yml:'yaml',md:'markdown','c++':'cpp',cc:'cpp',cxx:'cpp',cs:'csharp','c#':'csharp',rs:'rust',kt:'kotlin',ps1:'powershell',tex:'latex',txt:'text',plaintext:'text'} as Record<string,string>)[language]||language
  highlighter??=createHighlighter({themes:Object.values(codeThemes),langs:[]})
  const h=await highlighter,extra=Object.hasOwn(extraLanguages,language)?extraLanguages[language as keyof typeof extraLanguages]:undefined
  const lang=extra||Object.hasOwn(bundledLanguages,language)?language:'text'
  // Load only the grammar being used; all surfaces still share the same theme.
  if(lang!=='text'&&!h.getLoadedLanguages().includes(lang))await h.loadLanguage(extra||lang as keyof typeof bundledLanguages)
  const html=h.codeToHtml(code,{lang,themes:codeThemes,defaultColor:false,meta:{__raw:meta},transformers:[transformerNotationDiff(),transformerNotationHighlight()]})
  const title=meta.match(/\btitle=["']([^"']+)["']/)?.[1]||''
  return '<div class="article-code'+(title?' has-title':'')+'" data-code-language="'+lang+'"><div class="article-code-bar">'+(title?'<span class="code-title">'+escape(title)+'</span>':'')+'<span class="code-language">'+lang+'</span><button type="button" data-copy-code aria-label="Copy code">Copy</button></div>'+html+'</div>'
}
export async function renderArticleDocument(source:string,en=false){
  let html=articleMarkdown(source,en)
  const blocks=[...html.matchAll(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g)]
  for(const match of blocks)html=html.replace(match[0],await highlightCode(decode(match[2]),match[1].match(/class="language-([^"]+)"/)?.[1]||'text',decode(match[1].match(/data-meta="([^"]+)"/)?.[1]||'')))
  const headings=[...html.matchAll(/<h([1-6]) id="([^"]+)">([\s\S]*?)<\/h[1-6]>/g)].map(m=>({depth:Number(m[1]),slug:m[2],text:decode(m[3].replace(/<a class="anchor"[\s\S]*?<\/a>|<a href="#[\s\S]*?<\/a>/g,'').replace(/<[^>]*>/g,''))}))
  return {html,headings}
}
export async function enhanceArticle(root:HTMLElement){
  for(const pre of root.querySelectorAll<HTMLPreElement>('pre:not(.shiki)')){
    const code=pre.querySelector('code');if(!code)continue
    const html=await highlightCode(code.textContent||'',(code.className.match(/language-(\S+)/)||[])[1]||'text',code.dataset.meta||'')
    if(!pre.isConnected)continue
    const wrap=document.createElement('div');wrap.innerHTML=html;pre.replaceWith(wrap.firstElementChild!)
  }
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-copy-code]')){
    if(button.dataset.bound)continue;button.dataset.bound='true'
    button.onclick=async()=>{try{await navigator.clipboard.writeText(button.closest('.article-code')!.querySelector('code')!.textContent||'');button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1600)}catch{button.textContent='Select & copy'}}
  }
  const images=[...root.querySelectorAll<HTMLImageElement>('img.zoomable:not([data-preview-zoom])')]
  images.forEach(img=>img.dataset.previewZoom='true')
  if(images.length)mediumZoom(images,{background:'hsl(var(--background) / 0.85)'})
}

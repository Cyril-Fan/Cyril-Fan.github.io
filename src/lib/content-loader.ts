import type { Loader } from 'astro/loaders'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readArticle, validateText } from '../../supabase/functions/_shared/git-content'
import { renderArticleDocument } from './content-render'

/** Never import/compile author files as JavaScript, including the .mdx extension. */
export function contentFiles(kind:'blog'|'blogEn'|'collection'):Loader {
  return {name:'safe-files-'+kind,async load({config,store,parseData,generateDigest,watcher}) {
    const base='src/content/'+(kind==='collection'?'collection':'blogs'),root=fileURLToPath(config.root)
    const sync=async()=>{
      const files:string[]=[]
      const walk=async(dir:string)=>{for(const item of await readdir(dir,{withFileTypes:true})){
        const path=join(dir,item.name)
        if(item.isDirectory())await walk(path)
        else if(kind==='collection'?/\.mdx?$/.test(item.name):(kind==='blog'?/^index\.mdx?$/:/^index-en\.mdx?$/).test(item.name))files.push(path)
      }}
      await walk(join(root,base));const loaded=[]
      for(const file of files){
        const source=await readFile(file,'utf8'),filePath=relative(root,file).replaceAll('\\','/'),id=kind==='collection'?filePath.slice(base.length+1).replace(/\.mdx?$/,'').replace(/\/index$/,''):filePath.slice(base.length+1).replace(/\/index(?:-en)?\.mdx?$/,'')
        validateText(filePath,source)
        const {data,body}=readArticle(source),parsed=await parseData({id,data,filePath}),rendered=await renderArticleDocument(body,kind==='blogEn')
        const count=(body.match(/[\u3400-\u9fff]|\b\w+\b/g)||[]).length,minutes=Math.max(1,Math.ceil(count/220))
        loaded.push({id,data:parsed,body,filePath,digest:generateDigest(source),rendered:{html:rendered.html,metadata:{headings:rendered.headings,frontmatter:{minutesRead:kind==='blogEn'?minutes+' min read':minutes+' 分钟阅读'}}}})
      }
      store.clear();for(const item of loaded)store.set(item)
    }
    await sync()
    if(watcher){let queue=Promise.resolve();const changed=(file:string)=>{if(file.replaceAll('\\','/').includes('/'+base+'/'))queue=queue.then(sync).catch(error=>console.error(error))};watcher.on('add',changed);watcher.on('change',changed);watcher.on('unlink',changed)}
  }}
}

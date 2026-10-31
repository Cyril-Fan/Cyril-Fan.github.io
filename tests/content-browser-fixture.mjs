/** Local-only acceptance sandbox. All edits and publishing stay in memory. */
import { createServer } from 'node:http'
import { readFile,stat,readdir } from 'node:fs/promises'
import { resolve,extname,sep } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import sharp from 'sharp'
import { parse } from 'node-html-parser'
import { pathKind,validateText,validateImage,decodeBase64,fileReferences } from '../supabase/functions/_shared/git-content.ts'
const root=process.cwd(),dist=resolve(root,process.env.CONTENT_FIXTURE_DIST||'.content-check-dist'),port=Number(process.env.CONTENT_FIXTURE_PORT||9361)
const hash=data=>createHash('sha1').update('blob '+Buffer.byteLength(data)+'\0').update(data).digest('hex')
const files=new Map()
const siteLinks=JSON.parse(await readFile(resolve(root,'public/links.json'),'utf8'))
const fixtureImages=[...new Set([...siteLinks.friends.flatMap(g=>g.link_list.filter(f=>f.avatar?.startsWith('/')).map(f=>'public'+f.avatar)),...(await readdir(resolve(root,'public/media'))).filter(name=>/\.(png|webp|gif|jpe?g)$/i.test(name)).map(name=>'public/media/'+name),'src/assets/avatar.png'])]
for(const path of ['src/data/profile.json','src/data/academic.json','public/links.json',...fixtureImages]){const bytes=await readFile(resolve(root,path));files.set(path,{path,sha:hash(bytes),content:bytes.toString(pathKind(path)==='media'?'base64':'utf8'),encoding:pathKind(path)==='media'?'base64':'utf-8'})}
// Optional synthetic images exist only in this in-memory server, never GitHub.
if(process.env.CONTENT_FIXTURE_IMAGE_SHAPES==='1')for(const [name,width,height]of [['portrait',120,360],['wide',360,120]]){
 const path='public/media/fixture-'+name+'.png',bytes=await sharp({create:{width,height,channels:4,background:'#57879c80'}}).png().toBuffer()
 files.set(path,{path,sha:hash(bytes),content:bytes.toString('base64'),encoding:'base64'})
}
const html=parse(await readFile(resolve(dist,'admin/index.html'),'utf8'))
const editor=html.querySelector('content-editor').outerHTML,styles='<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+html.querySelectorAll('link[rel=stylesheet],head style').map(x=>x.outerHTML).join('')
const fixturePost='src/content/blogs/tech/preview-fixture/index.md';
const fixtureBody='---\ntitle: Isolated reading preview\ndescription: Local acceptance only, never published\npublishDate: 2026-10-18\nupdatedDate: 2026-10-24\ncategory: tech\ntags: [C++, C#, a/b]\ncomment: true\nheroImage:\n  src: /avatar/avatar.png\n  alt: Preview image\n---\n\n## Reading test\n\nLong text with **emphasis**, [a link](https://example.org) and $x^2$.\n\n### Code\n\n```cpp\n#include <iostream>\nint main() { std::cout << 42; }\n```\n\n## Table and math\n\n| Name | Value |\n| --- | --- |\n| Example | 42 |\n\n$$\nE = mc^2\n$$\n\n![Local image](/avatar/avatar.png)\n';
files.set(fixturePost,{path:fixturePost,sha:hash(fixtureBody),content:fixtureBody,encoding:'utf-8'});
const entry=`import {LocalContentStore} from './src/lib/content-local.ts';
import { installContentEditor } from './src/lib/content-editor.ts';
let role=localStorage.getItem('fixture-role')||'owner';
document.querySelector('[data-fixture-role]').value=role;
document.querySelector('[data-fixture-role]').onchange=event=>{role=event.target.value;localStorage.setItem('fixture-role',role);window.dispatchEvent(new Event('fixture-auth'));};
document.querySelector('[data-fixture-theme]').onclick=()=>document.documentElement.classList.toggle('dark');
for(const button of document.querySelectorAll('[data-fixture-control]'))button.onclick=async()=>{await fetch('/fixture/control',{method:'POST',body:JSON.stringify({mode:button.dataset.fixtureControl})});document.querySelector('[data-fixture-state]').textContent=button.textContent+' ready';};
document.querySelector('[data-fixture-seed]').onclick=async()=>{
 const store=await LocalContentStore.open('fixture-owner','${Buffer.alloc(32,23).toString('base64')}');
 for(const state of ['committed','live','failed']){const id='acceptance-'+state+'-'+crypto.randomUUID();await store.save({id,owner:'fixture-owner',repository:'Cyril-Fan/Cyril-Fan.github.io',updated:new Date().toISOString(),files:[],submission:{requestId:id,commitSha:'cccccccccccccccccccccccccccccccccccccccc',state,changes:[],revisions:{}}});}
 store.close();document.querySelector('[data-fixture-state]').textContent='Seeded 2 completed copies + 1 failed copy';
};
document.querySelector('[data-fixture-clear]').onclick=async()=>{
 role='guest';localStorage.setItem('fixture-role',role);window.dispatchEvent(new Event('fixture-auth'));
 const store=await LocalContentStore.open('fixture-owner','${Buffer.alloc(32,23).toString('base64')}');for(const copy of await store.list())await store.remove(copy.id);store.close();document.querySelector('[data-fixture-state]').textContent='Isolated copies cleared';
};
installContentEditor();`
const bundled=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',define:{'import.meta.env.PUBLIC_SUPABASE_URL':'location.origin','import.meta.env.PUBLIC_SUPABASE_ANON_KEY':'"fixture"'},plugins:[{name:'isolated-auth',setup(b){
 b.onResolve({filter:/\/comment-auth$|^\.\/comment-auth$/},()=>({path:'auth',namespace:'fixture'}))
 b.onResolve({filter:/^\.\/cms-image$/},()=>({path:'image',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?`export const COMMENT_AUTH_EVENT='fixture-auth';export function getCommentClient(){return {auth:{getSession:async()=>{const role=localStorage.getItem('fixture-role')||'owner';return {data:{session:role==='guest'?null:{user:{id:'fixture-'+role},access_token:'fixture-'+role}}}}}}}`:`export async function encodeCMSImage(canvas){return new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.88))}`,loader:'ts'}))
}}]})
const bundle=bundled.outputFiles[0].contents
let head='1'.repeat(40),mode='',last=null
const requests=new Map()
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
const readBody=async req=>{let value='';for await(const c of req)value+=c;return JSON.parse(value||'{}')}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+port),path=decodeURIComponent(url.pathname)
  if(path==='/fixture.mjs'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(bundle);return}
  if(path==='/fixture/control'){const input=await readBody(req);mode=input.mode;if(mode==='conflict'){const f=files.get('src/data/profile.json'),p=JSON.parse(f.content);p.zh.intro='Remote fixture change';f.content=JSON.stringify(p,null,2)+'\n';f.sha=hash(f.content)}json(res,{mode});return}
  if(path==='/functions/v1/content-github'){
   if(req.headers.authorization!=='Bearer fixture-owner'){json(res,{error:'Owner access required'},403);return}
   const input=await readBody(req)
   if(input.action==='list'){json(res,{head,owner:'fixture-owner',repository:'Cyril-Fan/Cyril-Fan.github.io',localKey:Buffer.alloc(32,23).toString('base64'),entries:[...files.values()].map(f=>({path:f.path,sha:f.sha,size:f.content.length,kind:pathKind(f.path),writable:true}))});return}
   if(input.action==='read'){json(res,{head,files:input.paths.map(path=>files.get(path)||{path,sha:null,content:null})});return}
   if(input.action==='references'){json(res,{head,references:[...files.values()].filter(f=>f.encoding!=='base64'&&fileReferences(f.content,input.path,f.path)).map(f=>f.path)});return}
   if(input.action==='status'){if(mode==='status-offline'){json(res,{error:'Offline deployment check'},503);return}json(res,{state:mode==='build-failed'?'build-failed':mode==='building'?'committed':'live'});return}
   if(input.action==='publish'){
    if(requests.has(input.requestId)){json(res,requests.get(input.requestId));return}
    if(mode==='offline'){mode='';json(res,{error:'Connection interrupted; retry the same submission'},400);return}
    const conflict=input.changes.filter(c=>(files.get(c.path)?.sha||null)!==c.baseSha).map(c=>({path:c.path,currentSha:files.get(c.path)?.sha||null,current:files.get(c.path)?.content||null}))
    if(conflict.length){json(res,{error:'Files changed on GitHub',detail:conflict},409);return}
    for(const c of input.changes)if(c.content!==null){if(c.encoding==='base64')validateImage(c.path,decodeBase64(c.content));else validateText(c.path,c.content)}
    const candidate=new Map(files);for(const c of input.changes){if(c.content===null)candidate.delete(c.path);else candidate.set(c.path,c)}
    for(const c of input.changes)if(c.content===null&&pathKind(c.path)==='media'&&[...candidate.values()].some(f=>f.encoding!=='base64'&&fileReferences(f.content,c.path,f.path))){json(res,{error:'Image still referenced'},409);return}
    await new Promise(r=>setTimeout(r,1500))
    for(const c of input.changes){if(c.content===null)files.delete(c.path);else files.set(c.path,{...c,sha:hash(Buffer.from(c.content,c.encoding==='base64'?'base64':'utf8'))})}
    head=hash(input.requestId);last={state:'committed',commitSha:head,files:input.changes.map(c=>({path:c.path,sha:files.get(c.path)?.sha||null}))};requests.set(input.requestId,last)
    if(mode==='uncertain'){mode='';json(res,{error:'Network response lost after commit'},400);return}json(res,last);return
   }
  }
  if(path==='/admin'||path==='/en/admin'){
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><html lang="'+(path.startsWith('/en/')?'en':'zh')+'"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated editor acceptance</title>'+styles+'</head><body><div style="max-width:1120px;margin:auto;padding:16px"><aside class="cms-inline"><strong>隔离验收：不会写入真实 GitHub</strong><select data-fixture-role><option value=owner>站长</option><option value=member>普通用户</option><option value=guest>访客</option></select><button data-fixture-theme>深浅色</button><button data-fixture-control=offline>下一次断网失败</button><button data-fixture-control=uncertain>下一次提交后丢响应</button><button data-fixture-control=conflict>模拟远端修改</button><button data-fixture-control=build-failed>模拟构建失败</button><button data-fixture-control=building>模拟构建中</button><button data-fixture-control=live>模拟已上线</button><button data-fixture-control=status-offline>状态检查断网</button><button data-fixture-seed>建立隔离残留任务</button><button data-fixture-clear>清理隔离副本</button><span data-fixture-state></span></aside><main class=cms-page>'+(path.startsWith('/en/')?parse(await readFile(resolve(dist,'en/admin/index.html'),'utf8')).querySelector('content-editor').outerHTML:editor)+'</main></div><script type=module src=/fixture.mjs></script></body></html>');return
  }
  let file=resolve(dist,'.'+path);if(!file.startsWith(dist+sep)){res.writeHead(403);res.end();return}if((await stat(file)).isDirectory())file=resolve(file,'index.html')
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'}
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file))
 }catch(e){json(res,{error:e.message},400)}
}).listen(port,'127.0.0.1',()=>console.log('Isolated acceptance: http://127.0.0.1:'+port+'/admin'))


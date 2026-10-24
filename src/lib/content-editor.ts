import { COMMENT_AUTH_EVENT, getCommentClient } from './comment-auth'
import { articleMarkdown } from './article-markdown'
import { enhanceArticle } from './content-render'
import { encodeCMSImage } from './cms-image'
import { LocalContentStore, markCommitted, type Workspace, type LocalFile } from './content-local'
import { REPOSITORY, PROFILE, ACADEMIC, LINKS, CONTENT_CATEGORIES, contentCategory, fileReferences, pathKind, publicImage, imageRepositoryPath, replaceImageReferences, readArticle, writeArticle, newArticle, encodeBase64, decodeBase64, gitBlobHash, type Entry } from '../../supabase/functions/_shared/git-content'
import { jsonFields, friendFields, articleFields, collectionFields, type Field } from './content-fields'

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n}
const clone=<T>(x:T):T=>structuredClone(x)
type Remote={path:string;sha:string|null;content:string|null;encoding?:'utf-8'|'base64'}
export class ContentEditor extends HTMLElement{
  private client=getCommentClient()
  private en=location.pathname.startsWith('/en/')
  private owner=''
  private epoch=0
  private abort?:AbortController
  private store?:LocalContentStore
  private space?:Workspace
  private entries:Entry[]=[]
  private remote=new Map<string,Remote>()
  private current=''
  private view='profile'
  private category=''
  private sectionGeneration=0
  private head=''
  private saving=Promise.resolve()
  private busy=false
  private blobUrls=new Map<string,string>()
  private previewTimer?:number
  private statusTimer?:number
  private previewGeneration=0
  private dialogCancel?:()=>void
  private t(zh:string,en:string){return this.en?en:zh}
  private q<T extends HTMLElement=HTMLElement>(s:string){return this.querySelector<T>(s)!}
  private notice(text:string,error=false){const p=this.q('[data-message]');p.textContent=text;p.dataset.error=String(error)}
  private btn(text:string,action:()=>unknown,cls=''){const b=el('button',text,cls);b.type='button';b.onclick=async()=>{b.disabled=true;b.setAttribute('aria-busy','true');try{await action()}catch(e:any){this.notice(e.message||String(e),true)}finally{b.disabled=false;b.removeAttribute('aria-busy')}};return b}
  connectedCallback(){
    if(this.abort)return
    this.abort=new AbortController();const signal=this.abort.signal
    this.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.addEventListener('click',()=>void this.selectView(b.dataset.kind!), {signal}))
    this.q('[data-create]').onclick=()=>void this.create('post')
    this.q('[data-create-collection]').onclick=()=>void this.create('collection')
    this.q('[data-back-blog]').onclick=()=>void this.selectView('blog')
    this.q('[data-import-trigger]').onclick=()=>this.q<HTMLInputElement>('[data-import]').click()
    const search=this.q<HTMLInputElement>('[data-search]'),box=this.q('[data-search-box]'),toggle=this.q('[data-search-toggle]')
    toggle.onclick=()=>{box.dataset.open='true';toggle.setAttribute('aria-expanded','true');search.focus()}
    this.q('[data-search-clear]').onclick=()=>{search.value='';this.searchChanged();search.focus()}
    search.onkeydown=e=>{if(e.key==='Escape'){search.value='';box.dataset.open='false';toggle.setAttribute('aria-expanded','false');this.searchChanged();toggle.focus()}}
    search.onblur=()=>{if(!search.value){box.dataset.open='false';toggle.setAttribute('aria-expanded','false')}}
    this.q('[data-refresh]').onclick=()=>void this.refresh().catch(e=>this.notice(e.message,true))
    this.q('[data-review]').onclick=()=>void this.review()
    this.q('[data-recover]').onclick=()=>void this.recover()
    this.q('[data-export]').onclick=()=>this.exportLocal()
    this.q<HTMLInputElement>('[data-import]').onchange=()=>{const f=this.q<HTMLInputElement>('[data-import]').files?.[0];if(f)void this.importLocal(f)}
    this.q('[data-search]').addEventListener('input',()=>this.searchChanged(),{signal})
    window.addEventListener(COMMENT_AUTH_EVENT,()=>void this.authorize(),{signal})
    window.addEventListener('beforeunload',event=>{if(this.space?.files.length||this.space?.submission?.state==='sending'){event.preventDefault();event.returnValue=''}},{signal})
    window.addEventListener('offline',()=>this.notice(this.t('已离线，修改仍在本机暂存。联网后可以发布。','Offline. Changes remain local; publish after reconnecting.')),{signal})
    window.addEventListener('online',()=>this.notice(this.t('网络已恢复。请检查本地修改后发布。','Back online. Review local changes before publishing.')),{signal})
    window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&this.owner){e.preventDefault();void this.persist()}},{signal})
    void this.authorize()
  }
  disconnectedCallback(){this.abort?.abort();this.abort=undefined;this.clear()}
  private clear(){
    this.epoch++;this.owner='';this.store?.close();this.store=undefined;this.space=undefined
    this.dialogCancel?.();this.q<HTMLDialogElement>('dialog').close();this.q('[data-dialog]').replaceChildren()
    this.q('[data-shell]').hidden=true;this.q('[data-gate]').hidden=false;this.q('[data-list]').replaceChildren();this.q('[data-editor]').replaceChildren();this.q('[data-submission]').replaceChildren()
    this.remote.clear();this.entries=[];this.current='';this.busy=false
    for(const u of this.blobUrls.values())URL.revokeObjectURL(u);this.blobUrls.clear()
    clearTimeout(this.previewTimer);clearTimeout(this.statusTimer);this.previewGeneration++
  }
  private async call(action:string,data:Record<string,unknown>={}){
    const epoch=this.epoch,{data:{session}}=await this.client!.auth.getSession()
    if(!session)throw new Error(this.t('登录已失效，请重新登录。','Session expired. Please sign in.'))
    const response=await fetch(import.meta.env.PUBLIC_SUPABASE_URL+'/functions/v1/content-github',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:import.meta.env.PUBLIC_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(90000)})
    const result=await response.json()
    if(epoch!==this.epoch)throw new Error(this.t('账号已改变，操作已停止。','Account changed; operation stopped.'))
    if(!response.ok){const error=new Error(result.error||'Request failed') as Error&{detail?:any;status?:number};error.detail=result.detail;error.status=response.status;throw error}
    return result
  }
  private async authorize(){
    if(!this.client){this.q('[data-gate]').textContent=this.t('账号服务暂不可用。','Account service unavailable.');return}
    const {data:{session}}=await this.client.auth.getSession()
    if(!session){this.clear();this.q('[data-gate]').textContent=this.t('请使用站长账号登录。','Sign in with the owner account.');return}
    if(session.user.id===this.owner)return
    this.clear();const epoch=this.epoch
    try{
      const snapshot=await this.call('list')
      if(epoch!==this.epoch)return
      this.owner=snapshot.owner;this.head=snapshot.head;this.entries=snapshot.entries
      this.space={id:crypto.randomUUID(),owner:this.owner,repository:REPOSITORY,updated:new Date().toISOString(),files:[]}
      try{this.store=await LocalContentStore.open(this.owner,snapshot.localKey)}catch{this.notice(this.t('浏览器无法暂存修改。请保留此页面，并及时导出本地副本。','Local storage unavailable. Keep this page open and export your edits.'),true)}
      this.q('[data-gate]').hidden=true;this.q('[data-shell]').hidden=false
      await this.loadTextFiles();await this.selectView(this.view)
      if(this.store&&(await this.store.list()).length)this.notice(this.t('发现之前的本地副本。点击“恢复本地副本”选择恢复；不会自动覆盖 GitHub。','Local copies found. Choose Restore local copy; GitHub is unchanged.'))
    }catch(e){this.owner='';this.q('[data-gate]').textContent=this.t('仅站长可使用。请确认登录和网络后刷新。','Owner access only. Check your session and connection, then reload.');this.notice((e as Error).message,true)}
  }
  private async loadTextFiles(){
    const paths=this.entries.filter(e=>e.kind!=='media').map(e=>e.path)
    for(let i=0;i<paths.length;i+=40){const r=await this.call('read',{paths:paths.slice(i,i+40)});for(const f of r.files)this.remote.set(f.path,f);this.head=r.head}
  }
  private async refresh(){
    if(!this.owner)return
    const snapshot=await this.call('list');this.entries=snapshot.entries;this.head=snapshot.head;this.remote.clear();await this.loadTextFiles()
    this.renderList();if(this.current)await this.open(this.current);this.notice(this.t('已重新读取 GitHub；本地修改仍保留。','GitHub refreshed. Local edits are preserved.'))
  }
  private file(path=this.current):LocalFile|Remote|undefined{return this.space?.files.find(f=>f.path===path)||this.remote.get(path)}
  private edit(path:string,content:string|null,encoding:'utf-8'|'base64'='utf-8'){
    if(!this.space)return
    let f=this.space.files.find(f=>f.path===path)
    if(!f){const base=this.remote.get(path);f={path,baseSha:base?.sha||this.entries.find(e=>e.path===path)?.sha||null,baseText:base?.content??null,content,encoding,revision:0};this.space.files.push(f)}
    f.content=content;f.encoding=encoding;f.revision++;this.space.updated=new Date().toISOString()
    if(path===this.current){const heading=this.querySelector('.cms-editor-head h2');if(heading)heading.textContent=this.label(path)}
    void this.persist();this.updateStatus();this.renderList()
  }
  private async persist(){
    if(!this.space)return
    const snapshot=clone(this.space),epoch=this.epoch,store=this.store
    if(!store){this.q('[data-save]').textContent=this.t('未能暂存，请导出副本','Not saved locally — export a copy');return}
    this.q('[data-save]').textContent=this.t('正在本地暂存…','Saving locally…')
    this.saving=this.saving.catch(()=>{}).then(()=>!snapshot.files.length&&(!snapshot.submission||snapshot.submission.state==='live')?store.remove(snapshot.id):store.save(snapshot))
    try{await this.saving;if(epoch===this.epoch){this.q('[data-save]').textContent=this.t('本地已暂存 · 尚未提交','Saved locally · not submitted');this.updateStatus()}}catch{if(epoch===this.epoch){this.q('[data-save]').textContent=this.t('本地暂存失败','Local save failed');this.notice(this.t('浏览器存储已满或不可用；请导出修改，不要关闭页面。','Storage unavailable or full. Export your edits before closing.'),true)}}
  }
  private updateStatus(){
    const count=this.space?.files.length||0
    this.q('[data-review]').textContent=this.t('检查并发布','Review & publish')+(count?' ('+count+')':'')
    this.q<HTMLButtonElement>('[data-review]').disabled=!count||this.busy
    if(!count)this.q('[data-save]').textContent=this.t('与 GitHub 一致','Matches GitHub')
  }
  private label(path:string){
    if(path===LINKS)return this.t('友链','Friends')
    if(path===PROFILE)return this.t('首页与关于','Home & About')
    if(path===ACADEMIC)return this.t('学术与项目','Academic & projects')
    const f=this.file(path)
    if(pathKind(path)!=='media'&&f?.content)try{return readArticle(f.content).data.title+' · '+(path.includes('index-en')?'EN':'ZH')}catch{}
    return path.split('/').pop()!
  }
  private categoryLabel(category:string){return ({research:this.t('科研','Research'),tech:this.t('技术','Technical'),daily:this.t('日常','Daily Life')} as Record<string,string>)[category]||category}
  private async selectView(view:string,category=''){
    const generation=++this.sectionGeneration
    this.view=view;this.category=category;this.current='';this.q<HTMLInputElement>('[data-search]').value=''
    this.renderList()
    if(view==='profile'||view==='academic'||view==='friend'){await this.open(view==='profile'?PROFILE:view==='academic'?ACADEMIC:LINKS);return}
    if(view==='media'){await this.mediaLibrary();return}
    if(generation===this.sectionGeneration)this.renderEmpty()
  }
  private searchChanged(){this.renderList();if(this.view==='media')void this.mediaLibrary()}
  private renderList(){
    const list=this.q('[data-list]');list.replaceChildren()
    this.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===this.view)))
    this.q('[data-category-tools]').hidden=this.view!=='blog'||!this.category
    this.q('[data-category-name]').textContent=this.categoryLabel(this.category)
    this.q('[data-search-box]').hidden=!((this.view==='blog'&&this.category)||this.view==='media')
    const query=this.q<HTMLInputElement>('[data-search]').value.toLowerCase()
    const paths=[...new Set([...this.entries.map(e=>e.path),...this.space?.files.map(f=>f.path)||[]])].filter(p=>this.view==='blog'&&['post','collection'].includes(pathKind(p)||'')&&contentCategory(p,this.file(p)?.content)===this.category).sort((a,b)=>this.label(a).localeCompare(this.label(b)))
    const shown=paths.filter(p=>(p+' '+this.label(p)).toLowerCase().includes(query))
    const sidebar=this.q('.cms-sidebar');sidebar.hidden=this.view!=='blog'||!this.category||!paths.length
    this.q('.cms-workspace').classList.toggle('cms-has-list',!sidebar.hidden)
    for(const p of shown){
      const changed=this.space?.files.find(f=>f.path===p),b=this.btn('',()=>this.open(p)),kind=pathKind(p)==='collection'?this.t('合集','Collection'):this.t('文章','Article')
      b.append(el('span',this.label(p)),el('small',kind+' · '+(changed?changed.content===null?this.t('待删除','To delete'):this.t('本地修改','Local changes'):p.split('/').slice(-2,-1)[0])))
      b.setAttribute('aria-current',String(p===this.current));list.append(b)
    }
    if(!list.childElementCount&&paths.length)list.append(el('p',this.t('没有匹配的内容。','No matching content.'),'cms-muted'))
    this.updateStatus()
  }
  private folderIcon(){
    const span=el('span','','cms-folder-icon');span.setAttribute('aria-hidden','true')
    span.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>';return span
  }
  private renderEmpty(){
    const target=this.q('[data-editor]');target.replaceChildren()
    if(this.view==='blog'&&!this.category){
      target.append(el('h2',this.t('博客','Blog')),el('p',this.t('选择一个目录，管理其中的文章与合集。','Choose a folder to manage its articles and collections.'),'cms-muted'))
      const folders=el('div','','cms-folders')
      for(const category of CONTENT_CATEGORIES){const b=this.btn('',()=>this.selectView('blog',category),'cms-folder');b.append(this.folderIcon(),el('strong',this.categoryLabel(category)),el('small','blog/'+category+'/'));folders.append(b)}
      target.append(folders);return
    }
    target.append(el('div',this.t('选择已有内容，或在右上角创建文章与合集。','Select existing content, or create an article or collection above.'),'cms-empty'))
  }
  private async open(path:string){
    this.current=path;const kind=pathKind(path)!;this.view=['post','collection'].includes(kind)?'blog':kind;if(this.view==='blog')this.category=contentCategory(path,this.file(path)?.content);this.renderList()
    if(!this.file(path)){const r=await this.call('read',{paths:[path]});this.remote.set(path,r.files[0])}
    if(this.current!==path)return
    const f=this.file(path)!;if(pathKind(path)==='media'){await this.mediaLibrary(path);return}
    const target=this.q('[data-editor]');target.replaceChildren()
    const header=el('div','','cms-editor-head');header.append(el('h2',this.label(path)),el('code',path,'cms-path'));target.append(header)
    const actions=el('div','','cms-actions')
    actions.append(this.btn(this.t('放弃本地修改','Discard local edits'),()=>this.discard(path)),this.btn(this.t('重新读取 GitHub','Reload from GitHub'),()=>this.refresh()),this.btn(this.t('编辑原文件','Edit source'),()=>this.sourceEditor(path)))
    if(path!==PROFILE&&path!==ACADEMIC&&path!==LINKS)actions.append(this.btn(this.t('删除文件','Delete file'),()=>this.stageDelete(path),'cms-danger'))
    else actions.append(this.btn(this.t('清空内容…','Clear content…'),()=>this.clearFixed(path)))
    if(kind==='post'&&!/index-en\.mdx?$/.test(path))actions.append(this.btn(this.t('编辑英文版','Edit English version'),async()=>{
      const translated=path.replace(/index(\.mdx?)$/,'index-en$1')
      if(!this.file(translated)&&!this.entries.some(e=>e.path===translated))this.edit(translated,writeArticle(this.file(path)!.content!,{language:'en'}))
      await this.open(translated)
    }))
    target.append(actions)
    if(f.content===null){target.append(el('p',this.t('此文件等待删除；发布前可以放弃修改。','This file is staged for deletion. Discard to undo before publishing.')));return}
    try{
      if(kind==='post'||kind==='collection')this.articleEditor(path,f.content,target)
      else this.jsonEditor(path,f.content,target)
    }catch(e){target.append(el('p',this.t('无法解析表单，请用原文件编辑器修正。','Cannot parse the form. Correct it in the source editor.'),'cms-message'));this.sourceEditor(path)}
  }
  private async discard(path:string){
    if(!await this.confirm(this.t('放弃本地修改？','Discard local edits?'),[path,this.t('删除当前浏览器副本中此文件的暂存内容，GitHub 不变。单独上传的图片请在图片库清理；其它窗口的恢复副本和已导出的备份不受影响。','Removes this file from this browser copy; GitHub is unchanged. Separately uploaded images can be cleaned in the image library. Other tabs’ recovery copies and exported backups remain.')]))return
    this.space!.files=this.space!.files.filter(f=>f.path!==path);this.releaseUnusedImageUrls();await this.persist();this.renderList()
    if(this.remote.has(path))await this.open(path);else if(this.view==='media')await this.mediaLibrary();else this.renderEmpty()
  }
  private async clearFixed(path:string){
    if(!await this.confirm(this.t('清空内容，保留页面','Clear content, keep the page'),[path,this.t('固定页面不会被删除。清空操作先本地暂存，发布后才生效。','Fixed pages remain. Clearing is staged locally until published.')]))return
    const data=JSON.parse(this.file(path)!.content!)
    if(path===LINKS)for(const g of data.friends)g.link_list=[]
    else if(path===ACADEMIC)for(const lang of ['zh','en'])data[lang]={...data[lang],background:'',interests:[],publications:[],projects:[],cv:''}
    else for(const lang of ['zh','en'])for(const key of ['intro','about','interests','contactIntro','spoiler'])data[lang][key]=''
    this.edit(path,JSON.stringify(data,null,2)+'\n');await this.open(path)
  }
  private async stageDelete(path:string){
    let refs:string[]=[]
    if(pathKind(path)==='media'){this.notice(this.t('正在检查图片引用…','Checking image references…'));refs=(await this.call('references',{path})).references}
    const yes=await this.confirm(this.t('删除确认','Confirm deletion'),[this.label(path),path,...refs.map(r=>this.t('引用：','Reference: ')+r),this.t('先加入本地删除清单。发布后删除 GitHub 当前文件；恢复依靠 Git 历史，原评论不删除。','Staged locally first. Publishing deletes the current GitHub file. Restore through Git history; comments remain.')])
    if(!yes)return
    this.edit(path,null,pathKind(path)==='media'?'base64':'utf-8');await this.open(path)
  }
  private form(fields:Field[],value:any,changed:()=>void,prefix=''):HTMLElement{
    const box=el('div','','cms-form')
    for(const f of fields){
      const title=this.en?(f.en||f.label):f.label
      if(f.type==='group'){
        const details=el('details');details.open=!prefix&&(!['zh','en'].includes(f.key)||f.key===(this.en?'en':'zh'));details.append(el('summary',title));value[f.key]??={}
        details.append(this.form(f.fields!,value[f.key],changed,prefix+f.key+'.'));box.append(details);continue
      }
      if(f.type==='list'){
        value[f.key]??=[];const section=el('section','','cms-array');section.append(el('h3',title))
        const rows=el('div');section.append(rows)
        const render=()=>{rows.replaceChildren();value[f.key].forEach((item:any,i:number)=>{
          const row=el('details','','cms-row');row.open=false;row.append(el('summary',(i+1)+'. '+(item.title||item.name||item.type||title)))
          const controls=el('div','','cms-row-footer')
          const move=(delta:number)=>{const j=i+delta;if(j<0||j>=value[f.key].length)return;[value[f.key][i],value[f.key][j]]=[value[f.key][j],value[f.key][i]];changed();render()}
          controls.append(this.btn('↑',()=>move(-1)),this.btn('↓',()=>move(1)),this.btn(this.t('移除','Remove'),async()=>{if(await this.confirm(this.t('移除此条目？','Remove this item?'),[item.title||item.name||title])){value[f.key].splice(i,1);changed();render()}}))
          row.append(this.form(f.fields!,item,changed,prefix+f.key+'.'+i+'.'),controls);rows.append(row)
        })};render()
        const footer=el('div','','cms-row-footer');footer.append(this.btn(this.t('添加条目','Add item'),()=>{const defaults=(fields:Field[]):any=>Object.fromEntries(fields.map(x=>[x.key,x.type==='group'?defaults(x.fields!):x.type==='list'?[]:x.type==='checkbox'?false:x.type==='select'?x.options?.[0]||'':x.type==='number'?undefined:'']));value[f.key].push(defaults(f.fields!));changed();render();(rows.lastElementChild as HTMLDetailsElement).open=true}));section.append(footer);box.append(section);continue
      }
      const label=el('label',title),id='field-'+prefix+f.key
      if(f.type==='markdown'){const area=this.markdownArea(String(value[f.key]||''),text=>{value[f.key]=text;changed()});const input=area.querySelector('textarea')!;input.id=id;label.htmlFor=id;const group=el('div');group.append(label,area);box.append(group);continue}
      const input=f.type==='textarea'?el('textarea'):f.type==='select'?el('select'):el('input')
      input.id=id;input.name=prefix+f.key;label.htmlFor=id
      if(input instanceof HTMLSelectElement)for(const option of f.options||[]){const o=el('option',option||'—');o.value=option;input.append(o)}
      if(input instanceof HTMLInputElement)input.type=f.type==='checkbox'?'checkbox':f.type==='date'?'date':f.type==='number'?'number':'text'
      if(f.type==='checkbox')(input as HTMLInputElement).checked=value[f.key]===true
      else input.value=value[f.key]??''
      input.addEventListener('input',()=>{
        if(f.type==='checkbox')value[f.key]=(input as HTMLInputElement).checked
        else if(f.type==='number')value[f.key]=input.value===''?undefined:Number(input.value)
        else value[f.key]=input.value
        changed()
        if(f.type==='image')void showImage()
      })
      label.append(input)
      let showImage=async()=>{}
      if(f.type==='image'){
        const image=el('img');image.alt=title;image.className='cms-field-image';image.hidden=!value[f.key]
        showImage=async()=>{image.hidden=!value[f.key];if(value[f.key])try{image.src=await this.imageUrl(value[f.key])}catch{image.alt=this.t('暂时无法预览','Preview unavailable')}}
        const controls=el('div','','cms-field-actions')
        controls.append(this.btn(this.t('选择 / 上传图片','Select / upload image'),()=>this.imagePicker(path=>{value[f.key]=path;input.value=path;changed();void showImage()},f.key==='avatar')),
          this.btn(this.t('清除','Clear'),()=>{value[f.key]='';input.value='';changed();void showImage()}))
        const group=el('div','','cms-image-field');group.append(label,controls,image);box.append(group);void showImage();continue
      }
      box.append(label)
    }
    return box
  }
  private jsonEditor(path:string,source:string,target:HTMLElement){
    const data=JSON.parse(source),changed=()=>{this.edit(path,JSON.stringify(data,null,2)+'\n')}
    if(path===LINKS){
      for(const group of data.friends){
        const rows=el('div','','cms-form');target.append(rows)
        const render=()=>{rows.replaceChildren();group.link_list.sort((a:any,b:any)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));group.link_list.forEach((f:any,i:number)=>{
          const section=el('details');section.append(el('summary',f.name||this.t('新友链','New friend')),this.form(friendFields,f,changed,'friend.'+i+'.'))
          const footer=el('div','','cms-row-footer');footer.append(this.btn(this.t('删除这条友链','Delete this friend'),async()=>{if(await this.confirm(this.t('删除友链？','Delete friend?'),[f.name,f.link,path])){group.link_list.splice(i,1);changed();render()}},'cms-danger'));section.append(footer);rows.append(section)
        })};render()
        const add=el('div','','cms-row-footer');target.append(add);add.append(this.btn(this.t('添加友链','Add friend'),()=>{const friend={name:'',intro:'',link:'https://',avatar:'',feed:''};group.link_list.push(friend);changed();render();(rows.children[group.link_list.indexOf(friend)] as HTMLDetailsElement).open=true}))
      }
    }else target.append(this.form(jsonFields[path===PROFILE?'profile':'academic'],data,changed))
  }
  private articleEditor(path:string,source:string,target:HTMLElement){
    const parsed=readArticle(source),form=clone(parsed.data)
    if(pathKind(path)==='post')form.tags=(form.tags||[]).join(', ')
    else form.bloglist=(form.bloglist||[]).join('\n')
    const info=el('details','','cms-metadata');info.open=!parsed.body.trim();info.append(el('summary',this.t('文章信息','Document information')))
    const metadataChange=()=>{
      const updates=clone(form)
      if(pathKind(path)==='post')updates.tags=String(form.tags||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean)
      else updates.bloglist=String(form.bloglist||'').split('\n').map(x=>x.trim()).filter(Boolean)
      if(!updates.updatedDate)updates.updatedDate=undefined
      if(updates.heroImage&&!updates.heroImage.src)updates.heroImage=undefined
      for(const k of ['source','pixivLink'])if(!updates[k])updates[k]=undefined
      this.edit(path,writeArticle(this.file(path)!.content!,updates))
    }
    info.append(this.form(pathKind(path)==='post'?articleFields.filter(f=>f.key!=='category'||!/^src\/content\/blogs\/(research|tech|daily)\//.test(path)):collectionFields,form,metadataChange));target.append(info)
    target.append(this.markdownArea(parsed.body,text=>this.edit(path,writeArticle(this.file(path)!.content!,{},text))))
  }
  private markdownArea(value:string,change:(v:string)=>void){
    const wrap=el('div','','content-compose'),tools=el('div','','cms-toolbar'),tabs=el('div','','cms-preview-tabs'),panes=el('div','','cms-compose-panes')
    const area=el('textarea');area.className='cms-md-editor';area.value=value;area.setAttribute('aria-label',this.t('Markdown 正文','Markdown body'))
    const preview=el('div','','prose dark:prose-invert max-w-none cms-md-preview article-body');preview.setAttribute('aria-label',this.t('实时预览','Live preview'))
    let previewRevision=0
    const render=()=>{const revision=++previewRevision,epoch=this.epoch;preview.innerHTML=articleMarkdown(area.value,this.en);void this.previewImages(preview).then(()=>{if(revision===previewRevision&&epoch===this.epoch&&preview.isConnected)void enhanceArticle(preview)})}
    const insert=(before:string,after='',placeholder='text')=>{const start=area.selectionStart,end=area.selectionEnd,selected=area.value.slice(start,end)||placeholder;area.setRangeText(before+selected+after,start,end,'select');area.focus();change(area.value);render()}
    const commands:[string,string,string,string][]=[
      ['H2','\n## ','\n',this.t('标题','Heading')],['H3','\n### ','\n',this.t('小标题','Subheading')],['B','**','**',this.t('粗体','bold')],['I','*','*',this.t('斜体','italic')],['S','~~','~~',this.t('删除线','strike')],
      [this.t('引用','Quote'),'\n> ','\n',this.t('引用内容','Quotation')],[this.t('列表','List'),'\n- ','\n',this.t('条目','Item')],['1.','\n1. ','\n',this.t('条目','Item')],['☑','\n- [ ] ','\n',this.t('任务','Task')],
      [this.t('链接','Link'),'[','](https://example.com)',this.t('链接文字','Link text')],
      [this.t('表格','Table'),'\n','\n','| A | B |\n| --- | --- |\n| 1 | 2 |'],
      [this.t('脚注','Footnote'),'','',this.t('说明[^note]\n\n[^note]: 脚注内容','Text[^note]\n\n[^note]: Footnote')],
      [this.t('代码','Code'),'\n'+String.fromCharCode(96).repeat(3)+'python\n','\n'+String.fromCharCode(96).repeat(3)+'\n','print("Hello")'],
      ['∑','$$\n','\n$$','E = mc^2'],['x²','$','$','x^2'],
      [this.t('提示块','Aside'),'\n:::note '+this.t('提示','Note')+'\n','\n:::\n',this.t('提示内容','Your note')],
      [this.t('折叠块','Collapse'),'\n:::details '+this.t('点击展开','Show details')+'\n','\n:::\n',this.t('折叠内容','Details')],
      [this.t('步骤','Steps'),'\n:::steps\n','\n:::\n',this.t('1. 第一步\n2. 第二步','1. First step\n2. Second step')]
    ]
    for(const [label,before,after,sample]of commands)tools.append(this.btn(label,()=>insert(before,after,sample)))
    tools.append(this.btn(this.t('图片','Image'),()=>this.imagePicker(path=>insert('\n![',']('+path+')\n\n*'+this.t('图片说明','Caption')+'*\n',this.t('替代文字','Alt text')))))
    const examples=el('details','','cms-examples');examples.append(el('summary',this.t('语法与示例','Syntax & examples')),el('p',this.t('支持 Markdown、GFM 表格/任务/脚注、数学公式，以及 :::note / tip / caution / danger、:::details、:::steps。MDX 仅支持不含脚本的静态 Aside、Collapse、Spoiler、Steps；不执行 import、表达式或事件属性。','Markdown, GFM tables/tasks/footnotes, math, :::note / tip / caution / danger, :::details and :::steps. MDX accepts static Aside, Collapse, Spoiler and Steps only; imports, expressions and event handlers do not execute.')))
    for(const [mode,label]of [['edit',this.t('编辑','Edit')],['preview',this.t('预览','Preview')],['split',this.t('并排','Split')]])tabs.append(this.btn(label,()=>{wrap.dataset.mode=mode;tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===label)))}))
    wrap.dataset.mode='split'
    area.addEventListener('input',()=>{change(area.value);clearTimeout(this.previewTimer);this.previewTimer=window.setTimeout(render,180)})
    panes.append(area,preview);wrap.append(tools,tabs,panes,examples);render();return wrap
  }
  private sourceEditor(path:string){
    const body=this.dialog(this.t('原文件编辑器','Source editor')),area=el('textarea');area.className='cms-source';area.value=this.file(path)!.content||'';area.setAttribute('aria-label',path)
    body.append(el('p',this.t('保留未知字段和原有语法。应用后仅在本地暂存，发布前仍会校验。','Unknown fields and syntax are preserved. Applying saves locally; validation still runs before publishing.')),area,
      this.btn(this.t('应用到本地副本','Apply locally'),async()=>{this.edit(path,area.value);this.q<HTMLDialogElement>('dialog').close();await this.open(path)}))
  }
  private dialog(title:string){const dialog=this.q<HTMLDialogElement>('dialog'),body=this.q('[data-dialog]');dialog.classList.remove('cms-dialog-compact');body.replaceChildren(el('h2',title));if(!dialog.open)dialog.showModal();return body}
  private confirm(title:string,lines:string[]):Promise<boolean>{
    const body=this.dialog(title);for(const line of lines)body.append(el('p',line))
    return new Promise(resolve=>{
      const dialog=this.q<HTMLDialogElement>('dialog');let settled=false
      const finish=(yes:boolean)=>{if(settled)return;settled=true;dialog.removeEventListener('close',closed);this.dialogCancel=undefined;dialog.close();resolve(yes)}
      const closed=()=>finish(false);dialog.addEventListener('close',closed,{once:true});this.dialogCancel=()=>finish(false)
      const controls=el('div','','cms-inline'),cancel=this.btn(this.t('取消','Cancel'),()=>finish(false))
      controls.append(cancel,this.btn(this.t('确认','Confirm'),()=>finish(true),'cms-primary'));body.append(controls);cancel.focus()
    })
  }
  private async create(kind:'post'|'collection'='post'){
    if(this.view!=='blog'||!CONTENT_CATEGORIES.includes(this.category as any))return
    const category=this.category,body=this.dialog(kind==='collection'?this.t('新建合集','New collection'):this.t('新建文章','New article'))
    this.q('dialog').classList.add('cms-dialog-compact')
    body.append(el('p',this.t('博客 / ','Blog / ')+this.categoryLabel(category),'cms-muted'))
    const label=el('label',this.t('文件夹名','Folder name')),slug=el('input');slug.placeholder='my-first-post';slug.autocomplete='off';slug.setAttribute('aria-describedby','cms-folder-help');label.append(slug)
    const help=el('p',this.t('使用小写字母、数字和连字符。创建后只保存在本机。','Use lowercase letters, digits and hyphens. Creation only saves locally.'),'cms-muted');help.id='cms-folder-help'
    const error=el('p','','cms-message');error.setAttribute('role','alert')
    const actions=el('div','','cms-dialog-actions')
    actions.append(this.btn(this.t('取消','Cancel'),()=>this.q<HTMLDialogElement>('dialog').close()),this.btn(this.t('建立本地副本','Create local copy'),async()=>{
      const name=slug.value.trim()
      if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(name)){error.textContent=this.t('请填写有效的文件夹名。','Enter a valid folder name.');slug.focus();return}
      const path='src/content/'+(kind==='post'?'blogs':'collection')+'/'+category+'/'+name+'/index.md'
      if(this.entries.some(e=>e.path===path)||this.space?.files.some(f=>f.path===path)){error.textContent=this.t('此目录中已有同名内容。','This folder name already exists.');return}
      this.edit(path,kind==='collection'?'---\ntitle: '+name+'\ncategory: '+category+'\nbloglist: []\n---\n':newArticle('zh',category))
      this.q<HTMLDialogElement>('dialog').close();await this.open(path)
    },'cms-primary'))
    body.append(label,help,error,actions);slug.focus()
  }
  private async review(){
    if(this.busy||!this.space?.files.length)return
    if(this.space.submission&&!['live','build-failed','committed'].includes(this.space.submission.state)){this.notice(this.t('上一提交的结果还未确定，请先重试同一提交。','Resolve the pending submission with Retry before creating another.'),true);return}
    const body=this.dialog(this.t('检查要发布的文件','Review selected files')),selected=new Set(this.space.files.map(f=>f.path))
    body.append(el('p',this.t('只写入勾选的文件；新图片与正文一起提交。删除直接影响 GitHub 当前版本，可从 Git 历史恢复。','Only checked files will be written. Include new referenced images. Deletions affect the current GitHub version and can be restored from Git history.')))
    for(const f of this.space.files){
      const label=el('label','','cms-review-row'),check=el('input');check.type='checkbox';check.checked=true;check.onchange=()=>check.checked?selected.add(f.path):selected.delete(f.path)
      label.append(check,el('span',(f.content===null?this.t('删除','Delete'):f.baseSha?this.t('修改','Modify'):this.t('新增','Add'))+' · '+f.path));body.append(label)
      if(f.encoding!=='base64'){const diff=el('details');diff.append(el('summary',this.t('查看原文件 / 本地差异','Compare GitHub / local')),this.diff(f.baseText||'',f.content||''));body.append(diff)}
    }
    body.append(this.btn(this.t('提交所选修改','Submit selected changes'),async()=>{
      const changes=this.space!.files.filter(f=>selected.has(f.path));if(!changes.length)return
      this.space!.submission={requestId:crypto.randomUUID(),baseHead:this.head,changes:changes.map(({path,baseSha,content,encoding})=>({path,baseSha,content,encoding})),revisions:Object.fromEntries(changes.map(f=>[f.path,f.revision])),state:'sending'}
      await this.persist();this.q<HTMLDialogElement>('dialog').close();await this.submit()
    },'cms-primary'))
  }
  private diff(before:string,after:string){
    const box=el('div','','cms-diff');for(const [title,text]of [[this.t('GitHub 原文件','GitHub original'),before],[this.t('本地内容','Local content'),after]]){const col=el('section');col.append(el('h3',title),el('pre',text));box.append(col)}return box
  }
  private async submit(){
    if(this.busy||!this.space?.submission)return
    this.busy=true;const sub=this.space.submission;sub.state='sending';this.updateStatus();this.renderSubmission()
    try{
      const result=await this.call('publish',{requestId:sub.requestId,baseHead:sub.baseHead,changes:sub.changes})
      if(result.state==='unchanged'){this.space.files=markCommitted(this.space.files,sub,result.files);this.space.submission=undefined;await this.persist();this.renderList();this.notice(this.t('所选文件与 GitHub 一致，无需提交。','Selected files already match GitHub.'));return}
      sub.commitSha=result.commitSha;sub.files=result.files;sub.state='committed'
      this.space.files=markCommitted(this.space.files,sub,result.files)
      for(const c of sub.changes){const sha=result.files.find((f:any)=>f.path===c.path)?.sha;this.entries=this.entries.filter(e=>e.path!==c.path);if(c.content===null)this.remote.delete(c.path);else{this.remote.set(c.path,{path:c.path,sha,content:c.content,encoding:c.encoding});this.entries.push({path:c.path,sha,size:c.content.length,kind:pathKind(c.path)!,writable:true})}}
      this.releaseUnusedImageUrls()
      if(this.view==='media')void this.mediaLibrary()
      sub.changes=[];sub.revisions={}
      await this.persist();this.notice(this.t('已提交 GitHub，正在构建。你可以继续编辑，新修改会单独保留。','Committed to GitHub; building. You may keep editing; newer changes remain local.'));this.renderList();this.renderSubmission();void this.checkStatus()
    }catch(e:any){
      sub.state='failed';await this.persist();this.notice(e.message||this.t('提交结果未确定，请安全重试。','Submission result unknown. Retry safely.'),true);this.renderSubmission()
      if(e.status===409&&Array.isArray(e.detail)&&e.detail[0]?.path)this.showConflicts(e.detail)
    }finally{this.busy=false;this.updateStatus();this.renderSubmission()}
  }
  private showConflicts(conflicts:any[]){
    const body=this.dialog(this.t('GitHub 文件冲突','GitHub file conflict'))
    for(const conflict of conflicts){
      const local=this.space!.files.find(f=>f.path===conflict.path)
      body.append(el('h3',conflict.path),this.diff(conflict.current||'',local?.content||''))
      if(local&&local.encoding!=='base64'){
        const label=el('label',this.t('手动合并后的内容','Manually merged content')),area=el('textarea');area.value=local.content||'';area.className='cms-source';label.append(area);body.append(label,this.btn(this.t('采用此合并结果','Use this merged result'),async()=>{
          local.baseSha=conflict.currentSha;local.baseText=conflict.current;local.content=area.value;local.revision++;this.space!.submission=undefined
          this.remote.set(local.path,{path:local.path,sha:conflict.currentSha,content:conflict.current});await this.persist();this.q<HTMLDialogElement>('dialog').close();await this.open(local.path);this.renderSubmission()
        }))
      }else body.append(el('p',this.t('图片冲突：请先导出本地副本，再放弃这一项并重新读取 GitHub。','Image conflict: export your local copy, discard this item, and reload GitHub.')))
    }
  }
  private renderSubmission(){
    const box=this.q('[data-submission]');box.replaceChildren();const sub=this.space?.submission;if(!sub)return
    const labels:Record<string,string>={sending:this.t('正在提交…','Submitting…'),failed:this.t('失败 / 结果未确定，本地副本已保留','Failed / uncertain — local copy preserved'),committed:this.t('已提交 GitHub、构建中','Committed to GitHub · building'),live:this.t('已发布上线','Published live'), 'build-failed':this.t('构建失败，GitHub 提交仍保留','Build failed — GitHub commit preserved')}
    box.append(el('strong',labels[sub.state]||sub.state))
    if(sub.commitSha){const a=el('a',this.t('查看 GitHub 提交','View commit'));a.href='https://github.com/'+REPOSITORY+'/commit/'+sub.commitSha;a.target='_blank';a.rel='noopener';box.append(a,this.btn(this.t('刷新上线状态','Refresh deployment'),()=>this.checkStatus()))}
    if(sub.state==='failed')box.append(this.btn(this.t('安全重试同一提交','Retry same submission'),()=>this.submit()),this.btn(this.t('返回修改清单','Back to local changes'),async()=>{
      if(!await this.confirm(this.t('结束本次提交请求？','End this submission request?'),[this.t('先重新读取 GitHub，保留所有本地修改。若先前提交其实成功了，下一次发布会提示版本冲突，不会覆盖。','Reload GitHub and keep every local edit. If the previous request committed, the next publish detects a conflict instead of overwriting.')]))return
      await this.refresh();this.space!.submission=undefined;await this.persist();this.renderSubmission()
    }))
    if(sub.state==='build-failed'){const a=el('a',this.t('打开构建并重试','Open build / rerun'));a.href='https://github.com/'+REPOSITORY+'/actions';a.target='_blank';a.rel='noopener';box.append(a)}
  }
  private async checkStatus(){
    const sub=this.space?.submission;if(!sub?.commitSha)return
    try{const r=await this.call('status',{requestId:sub.requestId,commitSha:sub.commitSha});if(this.space?.submission!==sub)return;sub.state=r.state;await this.persist();this.renderSubmission()
      if(r.state==='live')this.notice(this.t('已确认正式网站上线。之后的新修改仍保留在本地。','Confirmed live on the website. Newer edits remain local.'))
      clearTimeout(this.statusTimer);if(r.state==='committed')this.statusTimer=window.setTimeout(()=>{if(document.visibilityState==='visible')void this.checkStatus()},30000)
    }catch(e){this.notice((e as Error).message,true)}
  }
  private async recover(){
    if(!this.store)return
    const body=this.dialog(this.t('恢复本地副本','Restore local copy')),spaces=await this.store.list()
    body.append(el('p',this.t('各窗口使用独立副本。恢复会复制到本窗口，不覆盖其他窗口或 GitHub；废弃副本可单独移除。','Each tab has an independent copy. Restore copies it into this tab, preserving other tabs and GitHub.')))
    const recoverable=spaces.filter(s=>s.id!==this.space?.id&&(s.files.length||s.submission))
    for(const s of recoverable){
      const row=el('section','','cms-local-copy');row.append(el('p',new Date(s.updated).toLocaleString(this.en?'en-GB':'zh-CN',{hour12:false})),el('p',s.files.map(f=>f.path).join('\n')||this.t('仅提交状态','Submission status only')))
      row.append(this.btn(this.t('恢复此副本','Restore this copy'),async()=>{
        if(this.space?.files.length&&!await this.confirm(this.t('保留当前副本并切换？','Keep current copy and switch?'),[this.t('当前内容仍保存在另一个本地副本中。','Current content stays in its separate local copy.')]))return
        await this.persist();this.space={...clone(s),id:crypto.randomUUID(),updated:new Date().toISOString()};await this.persist();this.q<HTMLDialogElement>('dialog').close();this.renderList();this.renderSubmission();if(this.space.files[0])await this.open(this.space.files[0].path);if(this.space.submission?.commitSha)void this.checkStatus()
      }),this.btn(this.t('移除此本地副本','Remove this local copy'),async()=>{if(await this.confirm(this.t('移除本地副本？','Remove local copy?'),[s.files.map(f=>f.path).join('\n'),this.t('只影响此浏览器的这个副本。','Only this browser copy is affected.')])){await this.store!.remove(s.id);await this.recover()}}));body.append(row)
    }
    if(!recoverable.length)body.append(el('p',this.t('没有其它可恢复的副本。','No other local copies.')))
  }
  private download(name:string,text:string){
    const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob);this.blobUrls.set('export-'+Date.now(),url)
    const body=this.dialog(this.t('导出本地副本','Export local copy')),a=el('a',this.t('下载完整副本','Download complete copy'),'cms-download');a.href=url;a.download=name
    const area=el('textarea');area.readOnly=true;area.value=text;area.className='cms-source';area.setAttribute('aria-label',this.t('备份内容','Backup content'))
    body.append(el('p',this.t('包含未公开内容，请妥善保存。也可复制下面的完整文本保存为 JSON。','Contains unpublished content. Keep it private. You can also copy the complete JSON below.')),a,area,this.btn(this.t('复制完整备份','Copy full backup'),async()=>{await navigator.clipboard.writeText(text);this.notice(this.t('已复制备份。','Backup copied.'))}))
  }
  private exportLocal(){if(this.space)this.download('cyril-local-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:2,repository:REPOSITORY,workspace:this.space},null,2))}
  private async importLocal(file:File){
    try{
      if(file.size>40*1024*1024)throw new Error('Import exceeds 40 MB')
      const data=JSON.parse(await file.text())
      if(data.version!==2||data.repository!==REPOSITORY||!Array.isArray(data.workspace?.files))throw new Error(this.t('不是此编辑器的本地副本。旧 CMS 备份请通过迁移工具转换。','Not a local editor export. Convert legacy CMS backups with the migration tool.'))
      if(!await this.confirm(this.t('导入本地副本？','Import local copy?'),data.workspace.files.map((f:LocalFile)=>f.path)))return
      for(const f of data.workspace.files)if(!pathKind(f.path)||!Number.isInteger(f.revision))throw new Error('Invalid imported file')
      await this.persist();this.space={...data.workspace,id:crypto.randomUUID(),owner:this.owner,repository:REPOSITORY,updated:new Date().toISOString()}
      await this.persist();this.renderList();this.renderSubmission();this.notice(this.t('已导入本地副本，尚未提交。','Imported locally; not submitted.'))
    }catch(e){this.notice((e as Error).message,true)}
    this.q<HTMLInputElement>('[data-import]').value=''
  }
  private async upload(file:File){
    let bytes=new Uint8Array(await file.arrayBuffer()),ext=file.name.split('.').pop()?.toLowerCase()||''
    if(!['png','jpg','jpeg','webp','gif','avif'].includes(ext)||bytes.length>32*1024*1024)throw new Error(this.t('请选择不超过 32 MB 的 PNG/JPEG/WebP/GIF/AVIF 图片。','Choose PNG/JPEG/WebP/GIF/AVIF up to 32 MB.'))
    // Animated formats retain their bytes, frames and transparency. Never flatten them.
    const ascii=new TextDecoder('latin1').decode(bytes)
    const animated=ext==='gif'||ext==='avif'||(ext==='webp'&&ascii.includes('ANIM'))||(ext==='png'&&ascii.includes('acTL'))
    if(!animated){
      const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw new Error('Image exceeds 40 megapixels')}
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
      bytes=new Uint8Array(await (await encodeCMSImage(canvas)).arrayBuffer());ext='webp';canvas.width=canvas.height=1
    }
    if(bytes.length>8*1024*1024)throw new Error(this.t('处理后的图片超过 8 MB，请缩小后再上传。','Processed image exceeds 8 MB. Reduce its size.'))
    const hash=(await gitBlobHash(bytes)).slice(0,20),path='public/media/image-'+hash+'.'+ext
    if(!this.entries.some(e=>e.path===path))this.edit(path,encodeBase64(bytes),'base64')
    this.notice(this.t('图片已本地暂存，发布前不会上传。','Image saved locally; not uploaded until Publish.'));return publicImage(path)
  }
  private uploader(use:(path:string)=>unknown,_avatar=false){
    const wrap=el('div','','cms-upload'),label=el('label',this.t('上传本机图片','Upload image'),'cms-file'),input=el('input'),status=el('span','','cms-muted');status.setAttribute('role','status');input.type='file';input.className='cms-file-input';input.accept='image/png,image/jpeg,image/webp,image/gif,image/avif'
    input.onchange=async()=>{const file=input.files?.[0];input.value='';if(!file)return;input.disabled=true;label.setAttribute('aria-busy','true');status.textContent=this.t('正在无损处理，请稍候…','Processing losslessly…');try{await use(await this.upload(file));status.textContent=this.t('已本地暂存','Saved locally')}catch(e){status.textContent=(e as Error).message;this.notice((e as Error).message,true)}finally{input.disabled=false;label.removeAttribute('aria-busy')}}
    label.append(input);wrap.append(label,status);return wrap
  }
  private async imageUrl(url:string):Promise<string>{
    if(/^https:/.test(url))return url
    const path=imageRepositoryPath(url,this.current)
    let f=this.file(path)
    if(f?.content&&f.encoding==='base64'){
      const key=path+':'+('revision'in f?f.revision:f.sha)
      if(!this.blobUrls.has(key)){const ext=path.split('.').pop()!,type='image/'+(ext==='jpg'?'jpeg':ext);this.blobUrls.set(key,URL.createObjectURL(new Blob([decodeBase64(f.content)],{type})))}
      return this.blobUrls.get(key)!
    }
    if(!this.entries.some(e=>e.path===path))return url
    const r=await this.call('read',{paths:[path]});this.remote.set(path,r.files[0]);return this.imageUrl(url)
  }
  private async previewImages(root:HTMLElement){await Promise.all([...root.querySelectorAll<HTMLImageElement>('img')].map(async img=>{try{img.src=await this.imageUrl(img.getAttribute('src')||'')}catch{}}))}
  private releaseUnusedImageUrls(){
    for(const [key,url]of this.blobUrls){if(!key.startsWith('export-')){URL.revokeObjectURL(url);this.blobUrls.delete(key)}}
  }
  private async cleanLocalImages(){
    const files=this.space?.files||[]
    const candidates=files.filter(f=>f.encoding==='base64'&&!f.baseSha&&f.content&&!this.space?.submission?.changes.some(c=>c.path===f.path))
    const textPaths=[...new Set([...this.entries.filter(e=>e.kind!=='media').map(e=>e.path),...files.filter(f=>f.encoding!=='base64').map(f=>f.path)])]
    const unused=candidates.filter(image=>!textPaths.some(p=>fileReferences(this.file(p)?.content||'',image.path,p)))
    if(!unused.length){this.notice(this.t('没有未引用的本地图片。','No unreferenced local images.'));return}
    if(!await this.confirm(this.t('清理未引用的本地图片？','Remove unused local images?'),unused.map(f=>f.path)))return
    const paths=new Set(unused.map(f=>f.path));this.space!.files=files.filter(f=>!paths.has(f.path));this.releaseUnusedImageUrls();await this.persist();this.renderList();await this.mediaLibrary()
  }
  private async imagePicker(use:(path:string)=>unknown,avatar=false){
    const body=this.dialog(this.t('选择图片','Choose image')),select=(path:string)=>{use(path);this.q<HTMLDialogElement>('dialog').close()}
    body.append(this.uploader(select,avatar));const grid=el('div','','cms-media-grid');body.append(grid);await this.mediaCards(grid,select)
  }
  private async mediaLibrary(selected=''){
    const target=this.q('[data-editor]');target.replaceChildren(el('h2',this.t('网站图片','Website images')),el('p',this.t('替换会创建带内容指纹的新图片，并与所选引用一起提交。可同时清理无引用旧图；仍被其他内容引用的图片会保留。','Replacing creates a new content-addressed image and updates selected references in the same commit. Unused originals can be removed in the same commit; shared references keep the original safe.'),'cms-hint'),this.uploader(()=>this.mediaLibrary()),this.btn(this.t('清理未引用的本地图片','Clean unused local images'),()=>this.cleanLocalImages()))
    const grid=el('div','','cms-media-grid');target.append(grid);await this.mediaCards(grid,undefined,selected)
  }
  private async mediaCards(grid:HTMLElement,select?:(path:string)=>unknown,selected=''){
    const query=select?'':this.q<HTMLInputElement>('[data-search]').value.toLowerCase()
    const paths=[...new Set([...this.entries.filter(e=>e.kind==='media').map(e=>e.path),...this.space!.files.filter(f=>pathKind(f.path)==='media').map(f=>f.path)])].filter(p=>(p+' '+this.imageLabel(p)).toLowerCase().includes(query)&&(!select||this.file(p)?.content!==null))
    for(const path of paths){
      if(this.file(path)?.content===null){const card=el('section','','cms-media-card');card.append(el('p',path),el('p',this.t('待删除 · 发布前可撤销','To delete · undo before publishing'),'cms-muted'),this.btn(this.t('撤销删除','Undo deletion'),()=>this.discard(path)));grid.append(card);continue}
      const card=el('section','','cms-media-card'),img=el('img');img.alt=this.imageLabel(path);img.loading='lazy';card.append(img,el('strong',this.imageLabel(path)),el('p',path,'cms-path'));grid.append(card)
      try{img.src=await this.imageUrl(publicImage(path))}catch{img.alt=this.t('暂时无法预览','Preview unavailable')}
      if(select)card.append(this.btn(this.t('使用图片','Use image'),()=>select(publicImage(path))))
      else{
        card.append(this.btn(this.t('查看引用','References'),async()=>{const r=await this.call('references',{path});const body=this.dialog(path);body.append(el('p',r.references.join('\n')||this.t('未发现源码引用。','No source references found.')))}),
          this.btn(this.t('替换图片…','Replace image…'),()=>this.replaceImage(path)),
          this.btn(this.t('删除图片…','Delete image…'),()=>this.stageDelete(path),'cms-danger'))
        if(this.space!.files.some(f=>f.path===path))card.append(this.btn(this.t('放弃本地修改','Discard local edits'),()=>this.discard(path)))
      }
      if(selected===path)card.dataset.selected='true'
    }
  }
  private imageLabel(path:string){
    try{
      const profile=JSON.parse(this.file(PROFILE)?.content||'{}')
      if(imageRepositoryPath(profile.photo||'')===path)return this.t('关于页照片','About photo')
      if(imageRepositoryPath(profile.avatar||'')===path)return this.t('主页头像','Profile avatar')
      const friends=JSON.parse(this.file(LINKS)?.content||'{}').friends||[]
      const names=friends.flatMap((g:any)=>g.link_list||[]).filter((f:any)=>imageRepositoryPath(f.avatar||'')===path).map((f:any)=>f.name)
      if(names.length)return names.join(' / ')+this.t(' · 友链头像',' · friend avatar')
    }catch{}
    return path.split('/').pop()!
  }
  private async replaceImage(path:string){
    const result=await this.call('references',{path}),body=this.dialog(this.t('替换图片与引用','Replace image and references')),selected=new Set<string>()
    body.append(el('p',this.t('勾选要更新的内容文件。程序中的固定引用不能在后台改动，原图会保留。','Select content references to update. Hard-coded application references stay unchanged and keep the original image.')))
    for(const ref of result.references){
      const label=el('label','','cms-review-row'),check=el('input');check.type='checkbox';check.disabled=!pathKind(ref)||pathKind(ref)==='media';check.checked=!check.disabled;if(check.checked)selected.add(ref)
      check.onchange=()=>check.checked?selected.add(ref):selected.delete(ref);label.append(check,el('span',ref));body.append(label)
    }
    const cleanupLabel=el('label','','cms-review-row'),removeOld=el('input');removeOld.type='checkbox';removeOld.checked=true;cleanupLabel.append(removeOld,el('span',this.t('一并删除替换后不再被引用的旧图','Also delete the old image if no references remain')));body.append(cleanupLabel)
    body.append(this.uploader(async replacement=>{
      for(const ref of selected){
        const f=this.file(ref);if(!f?.content)continue
        const text=replaceImageReferences(f.content,path,ref,replacement)
        if(text!==f.content)this.edit(ref,text)
      }
      const newPath=imageRepositoryPath(replacement),remaining=result.references.filter((ref:string)=>!selected.has(ref)||fileReferences(this.file(ref)?.content||'',path,ref))
      const localRef=this.space!.files.some(f=>f.encoding!=='base64'&&f.content&&fileReferences(f.content,path,f.path))
      const cleanup=removeOld.checked&&newPath!==path&&!remaining.length&&!localRef
      if(cleanup)this.edit(path,null,'base64')
      this.q<HTMLDialogElement>('dialog').close();this.notice(cleanup?this.t('新图、引用和无引用旧图删除已一起暂存，检查后一次发布。','New image, references and unused original deletion staged for one commit.'):this.t('新图片与引用已暂存。旧图仍有引用或未选择清理，已保留。','Replacement staged. The original was retained because references remain or cleanup was not selected.'));await this.mediaLibrary()
    }))
  }
}
export function installContentEditor(){if(!customElements.get('content-editor'))customElements.define('content-editor',ContentEditor)}

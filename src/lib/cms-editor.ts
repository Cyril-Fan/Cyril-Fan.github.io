import { COMMENT_AUTH_EVENT, getCommentClient, type CommentAuthChangeDetail } from './comment-auth'
import { articleMarkdown } from './article-markdown'
import { encodeCMSImage } from './cms-image'
import baseline from '../data/cms-published.json'
import { schemas, kindLabels, emptyPayload, validatePayload, documentTitle, isKind, validateWebp, mediaPattern, type Field, type Kind, type Payload } from '../../supabase/functions/_shared/cms'

type Entry = { id:string; kind:Kind; revision:number; payload:Payload; deleted?:boolean; published_payload?:Payload|null; published_revision?:number; locked_slug?:string }
type Summary = { id:string; kind:Kind; title:string; revision:number; deleted:boolean; published:boolean; changed:boolean; updated_at:string }
type Media = { id:string; name:string; alt:string; deleted:boolean }
type View = Kind|'media'|'trash'|'jobs'
const messages:Record<string,string> = {
  cms_conflict:'这项内容已在另一个窗口修改。请导出或复制当前内容，再刷新读取最新版。',cms_publish_pending:'有发布任务尚未完成，请到“发布记录”继续或取消该任务。',
  cms_slug_locked:'文章首次发布后网址固定，以保留旧链接和评论。标题仍可修改。',cms_slug_taken:'这个文章网址已经使用，请换一个。',cms_in_trash:'这项内容在回收站中，请先恢复。',
  cms_unpublish_first:'已上线内容需要先撤回。',cms_fixed_document:'固定页面不能删除；可以编辑或恢复历史版本。',cms_media_in_use:'图片仍被草稿、已发布内容或待处理发布引用。请先替换这些引用。',
  cms_limit:'已达到当前后台容量限制。请整理不再需要的内容。',admin_required:'当前账号没有站长权限。',authentication_required:'请先登录站长账号。',session_expired:'登录已失效，请重新登录。',
  cms_not_found:'这项内容已不存在，请刷新列表。'
}
function errorText(error:any):string {
  if(messages[error?.message])return messages[error.message]
  if(error?.code==='PGRST202')return '后台服务尚未升级完成。请稍后刷新，当前输入仍保留。'
  if(error instanceof Error && !/fetch|network|abort|timeout/i.test(error.message))return error.message.slice(0,500)
  return '操作未完成，请检查网络后重试；当前填写内容仍保留。'
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node}
const button=(text:string,run:()=>unknown,className='')=>{const b=el('button',text,className);b.type='button';b.addEventListener('click',()=>void run());return b}
const clone=<T>(value:T):T=>structuredClone(value)
const timestamp=(s:string)=>new Date(s).toLocaleString('zh-CN',{hour12:false})
const bytesBase64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)}

export class OwnerCMS extends HTMLElement {
  private client=getCommentClient()
  private epoch=0
  private userId:string|null=null
  private abort?:AbortController
  private docs:Summary[]=[]
  private view:View='post'
  private current:Entry|null=null
  private saved=''
  private saving?:Promise<boolean>
  private timer?:number
  private privateUrls=new Map<string,string>()
  private previews=new Map<HTMLElement,()=>void>()
  private pendingRequest?:{id:string;revision:number;action:string;request:string}
  private publishing=false
  private jobsTimer?:number
  private confirmCancel?:()=>void
  private q<T extends HTMLElement=HTMLElement>(selector:string):T { return this.querySelector<T>(selector)! }
  private notify(message:string,error=false){const p=this.q('[data-cms-message]');p.textContent=message;p.dataset.error=String(error)}
  private get dirty(){return !!this.current&&JSON.stringify(this.current.payload)!==this.saved}
  connectedCallback(){
    if(this.abort)return
    this.abort=new AbortController();const signal=this.abort.signal
    this.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.addEventListener('click',()=>void this.switchView(b.dataset.kind as View),{signal}))
    this.q('[data-create]').addEventListener('click',()=>void this.create(),{signal})
    this.q('[data-refresh]').addEventListener('click',()=>void this.refresh(),{signal})
    this.q<HTMLInputElement>('[data-search]').addEventListener('input',()=>this.renderList(),{signal})
    this.q('[data-export]').addEventListener('click',()=>void this.exportBackup(),{signal})
    this.q<HTMLInputElement>('[data-import]').addEventListener('change',event=>{const input=event.target as HTMLInputElement;const file=input.files?.[0];input.value='';if(file)void this.importFile(file)},{signal})
    window.addEventListener(COMMENT_AUTH_EVENT,event=>{
      const next=(event as CustomEvent<CommentAuthChangeDetail>).detail?.userId??null
      if(next!==this.userId)this.clearPrivate()
      void this.authorize()
    },{signal})
    window.addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue=''}},{signal})
    window.addEventListener('online',()=>{if(this.dirty)this.scheduleSave()},{signal})
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void this.authorize(true)},{signal})
    void this.authorize()
  }
  disconnectedCallback(){this.abort?.abort();this.abort=undefined;this.clearPrivate()}
  private clearPrivate(){
    this.confirmCancel?.()
    this.epoch++;this.userId=null;this.current=null;this.saved='';this.docs=[];this.previews.clear();this.pendingRequest=undefined;this.publishing=false
    window.clearTimeout(this.timer);window.clearTimeout(this.jobsTimer);this.saving=undefined
    for(const url of this.privateUrls.values())URL.revokeObjectURL(url)
    this.privateUrls.clear();this.q('[data-cms-shell]').hidden=true;this.q('[data-list]').replaceChildren();this.q('[data-editor]').replaceChildren();this.q('[data-dialog-body]').replaceChildren();this.q<HTMLDialogElement>('dialog').close();this.notify('')
  }
  private async rpc(name:string,args:Record<string,unknown>={}) {
    if(!this.client)throw new Error('账户服务暂不可用。')
    const epoch=this.epoch;const {data,error}=await this.client.rpc(name,args)
    if(epoch!==this.epoch)throw new Error('账号已切换，本次操作已停止。')
    if(error)throw error
    return data
  }
  private async authorize(force=false){
    const gate=this.q('[data-cms-gate]'),epoch=this.epoch
    if(!this.client){gate.textContent='账户服务暂不可用，请稍后刷新。';return}
    try{
      const {data:{session}}=await this.client.auth.getSession()
      if(epoch!==this.epoch)return
      if(!session){gate.hidden=false;gate.textContent='登录站长账号后，即可管理内容。';return}
      if(this.userId===session.user.id&&!force)return
      const me=await this.rpc('comment_me')
      if(epoch!==this.epoch)return
      if(me?.is_admin!==true){this.clearPrivate();gate.hidden=false;gate.textContent='当前账号没有站长权限。请退出后使用站长账号登录。';return}
      const wasReady=!!this.userId;this.userId=session.user.id
      gate.hidden=true;this.q('[data-cms-shell]').hidden=false
      if(!wasReady){await this.rpc('cms_initialize',{p_documents:baseline.documents});await this.refresh()}
    }catch(error){if(epoch===this.epoch){gate.hidden=false;gate.textContent=errorText(error)}}
  }
  private async refresh(){try{this.docs=await this.rpc('cms_list');this.renderList();if(this.view==='jobs')await this.renderJobs();else if(this.view==='media')await this.renderMedia()}catch(error){this.notify(errorText(error),true)}}
  private async switchView(view:View){
    if(!await this.leaveEditor())return
    window.clearTimeout(this.jobsTimer)
    this.view=view;this.current=null;this.saved='';this.previews.clear();this.q('[data-editor]').replaceChildren(el('div','选择内容开始编辑。','cms-empty'))
    this.querySelectorAll<HTMLElement>('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===view)))
    const create=this.q('[data-create]');create.hidden=view!=='post'&&view!=='friend';create.textContent=view==='friend'?'添加友链':'新建文章'
    this.q('[data-search]').closest('aside')!.hidden=view==='media'||view==='jobs'
    this.q('[data-editor]').parentElement!.style.gridTemplateColumns=(view==='media'||view==='jobs')?'minmax(0,1fr)':''
    this.renderList();if(view==='media')await this.renderMedia();else if(view==='jobs')await this.renderJobs();else if(view==='profile'||view==='academic')await this.open(view)
  }
  private renderList(){
    const target=this.q('[data-list]'),search=this.q<HTMLInputElement>('[data-search]').value.toLocaleLowerCase()
    const filtered=this.docs.filter(d=>(this.view==='trash'?d.deleted:!d.deleted&&d.kind===this.view)&&`${d.title} ${kindLabels[d.kind]}`.toLocaleLowerCase().includes(search))
    if(this.view==='friend')filtered.sort((a,b)=>a.title.localeCompare(b.title,'en',{sensitivity:'base'}))
    target.replaceChildren()
    for(const d of filtered){const item=button('',()=>this.open(d.id));item.setAttribute('aria-current',String(this.current?.id===d.id));item.append(el('span',d.kind==='profile'||d.kind==='academic'?kindLabels[d.kind]:d.title||'未命名'),el('small',d.deleted?'回收站':d.published?(d.changed?'已发布 · 有未发布修改':'已发布'):'草稿'));target.append(item)}
    if(!filtered.length)target.append(el('p',this.view==='trash'?'回收站是空的。':'暂无匹配内容。','cms-muted'))
  }
  private async leaveEditor():Promise<boolean>{
    if(!this.dirty)return true
    if(await this.save())return true
    return this.confirmAction('当前更改尚未保存。离开会放弃这些更改。','放弃并离开')
  }
  private async open(id:string){if(!await this.leaveEditor())return;try{this.current=await this.rpc('cms_get',{p_id:id});this.saved=JSON.stringify(this.current!.payload);this.renderEditor();this.renderList()}catch(error){this.notify(errorText(error),true)}}
  private async create(){
    if(!['post','friend'].includes(this.view)||!await this.leaveEditor())return
    const kind=this.view as Kind;this.current={id:crypto.randomUUID(),kind,revision:0,payload:emptyPayload(kind)};this.saved='';this.renderEditor();this.renderList();this.q<HTMLElement>('[data-editor] input')?.focus();this.notify('新建草稿。填写后会自动保存，也可以手动保存。')
  }
  private scheduleSave(){window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>void this.save(),2500);this.setSaveStatus('有未保存更改')}
  private setSaveStatus(text:string){const p=this.querySelector('[data-save-status]');if(p)p.textContent=text}
  private save():Promise<boolean>{
    if(this.saving)return this.saving.then(ok=>ok?(this.dirty?this.save():true):false)
    if(!this.current||!this.dirty||this.current.deleted)return Promise.resolve(true)
    const doc=this.current,epoch=this.epoch,captured=JSON.stringify(doc.payload)
    window.clearTimeout(this.timer);this.setSaveStatus('正在保存…')
    const run=async()=>{
      try{
        const payload=validatePayload(doc.kind,JSON.parse(captured))
        const result=await this.rpc('cms_save',{p_id:doc.id,p_kind:doc.kind,p_revision:doc.revision,p_payload:payload})
        if(epoch!==this.epoch||this.current?.id!==doc.id)return false
        this.current.revision=result.revision;this.current.locked_slug=result.locked_slug;this.saved=captured
        this.setSaveStatus(this.dirty?'有未保存更改':`已保存 · ${new Date().toLocaleTimeString('zh-CN',{hour12:false})}`)
        this.docs=await this.rpc('cms_list');this.renderList();if(this.dirty)this.scheduleSave();return true
      }catch(error){if(epoch===this.epoch){this.setSaveStatus('保存失败 · 输入仍保留');this.notify(errorText(error),true)}return false}
      finally{if(epoch===this.epoch)this.saving=undefined}
    }
    this.saving=run();return this.saving
  }
  private changed(){if(!this.current)return;this.scheduleSave();for(const render of this.previews.values())render();this.renderOverview()}
  private renderEditor(){
    const target=this.q('[data-editor]'),d=this.current!;target.replaceChildren();this.previews.clear()
    const head=el('div','','cms-editor-head'),title=el('h2',documentTitle(d));title.dataset.editorTitle='';head.append(title,el('span',d.deleted?'回收站':d.revision?'已保存':'尚未保存','cms-muted'));head.lastElementChild!.setAttribute('data-save-status','');target.append(head)
    const actions=el('div','','cms-actions')
    if(d.deleted){actions.append(button('恢复到草稿',()=>this.restore(), 'cms-primary'));target.append(actions,el('p','恢复后不会自动发布。','cms-hint'));return}
    actions.append(button('保存草稿',()=>this.save()),button('发布',()=>this.publish('publish'),'cms-primary'))
    if(d.published_payload&&d.kind!=='profile'&&d.kind!=='academic')actions.append(button('撤回',()=>this.publish('unpublish')))
    if(d.kind==='post'||d.kind==='friend')actions.append(button('复制',()=>this.duplicate()),button('移入回收站',()=>this.trash(),'cms-danger'))
    actions.append(button('历史版本',()=>this.history()))
    actions.append(button('导出此项',()=>this.exportCurrent()),button('放弃未保存更改',()=>this.discard()))
    target.append(actions)
    if(d.locked_slug)target.append(el('p',`固定网址：/blog/${d.locked_slug}。修改标题不会改变网址和评论。`,'cms-hint'))
    const form=el('div','','cms-form');this.renderFields(form,schemas[d.kind],d.payload,[]);target.append(form)
    const preview=el('section','','cms-preview');preview.dataset.overview='';target.append(preview);this.renderOverview()
  }
  private renderFields(parent:HTMLElement,fields:Field[],model:Payload,path:string[]){
    for(const f of fields){
      const key=[...path,f.key],id=`cms-${key.join('-')}`
      if(f.type==='group'){
        const details=el('details');details.open=f.key!=='en';details.append(el('summary',f.label));const group=el('div','','cms-group');this.renderFields(group,f.fields!,model[f.key],key);details.append(group);parent.append(details);continue
      }
      if(f.type==='list'){
        const wrap=el('section');wrap.append(el('h3',f.label));const items=el('div');wrap.append(items)
        const render=()=>{items.replaceChildren();model[f.key].forEach((item:Payload,i:number)=>{const row=el('div','','cms-row');this.renderFields(row,f.fields!,item,[...key,String(i)]);const controls=el('div','','cms-inline');controls.append(button('上移',()=>{if(i>0){[model[f.key][i-1],model[f.key][i]]=[item,model[f.key][i-1]];render();this.changed()}}),button('下移',()=>{if(i<model[f.key].length-1){[model[f.key][i],model[f.key][i+1]]=[model[f.key][i+1],item];render();this.changed()}}),button('删除此项',async()=>{if(await this.confirmAction('从当前草稿中移除这一项，可在历史版本恢复。','确认移除条目')){model[f.key].splice(i,1);render();this.changed()}}));row.append(controls);items.append(row)})}
        render();wrap.append(button(`添加${f.label}`,()=>{if(model[f.key].length>=60)return this.notify('每组最多 60 项。',true);model[f.key].push(Object.fromEntries(f.fields!.map(x=>[x.key,''])));render();this.changed()}));parent.append(wrap);continue
      }
      const wrap=el('div'),label=el('label',f.label);label.htmlFor=id;wrap.append(label)
      const input=(f.type==='textarea'||f.type==='markdown')?el('textarea'):el('input');input.id=id;input.name=key.join('.');input.autocomplete='off'
      if(input instanceof HTMLInputElement)input.type=f.type==='checkbox'?'checkbox':f.type==='date'?'date':f.type==='email'?'email':f.type==='url'?'url':'text'
      if(f.type==='checkbox')(input as HTMLInputElement).checked=!!model[f.key];else input.value=model[f.key]??''
      if(f.max)input.maxLength=f.max
      if(f.key==='slug'&&this.current?.locked_slug)input.readOnly=true
      input.addEventListener('input',()=>{model[f.key]=f.type==='checkbox'?(input as HTMLInputElement).checked:input.value;this.changed()})
      if(f.type==='markdown'){
        input.className='cms-md-editor';const area=input as HTMLTextAreaElement;wrap.append(this.toolbar(area));wrap.append(input)
        const title=el('p','实时预览','cms-preview-label'),preview=el('div','','cms-md-preview prose dark:prose-invert')
        let timer:number|undefined;const render=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>{if(!preview.isConnected)return;this.setPreviewHtml(preview,articleMarkdown(area.value));void this.resolvePreviewImages(preview)},180)}
        this.previews.set(preview,render);wrap.append(title,preview);render()
        area.addEventListener('paste',event=>{const file=Array.from(event.clipboardData?.files||[]).find(x=>x.type.startsWith('image/'));if(file){event.preventDefault();void this.upload(file,false).then(m=>{if(m)this.insert(area,`![${m.alt||m.name}](/media/${m.id}.webp)`)}).catch(error=>this.notify(errorText(error),true))}})
      }else if(f.type==='image'){
        const row=el('div','','cms-inline');row.append(input,button('选择图片',()=>this.mediaPicker(m=>{input.value=`/media/${m.id}.webp`;model[f.key]=input.value;this.changed()},this.current?.kind==='friend')),button('清除',()=>{input.value='';model[f.key]='';this.changed()}));wrap.append(row)
      }else wrap.append(input)
      if(f.key==='slug')wrap.append(el('p','小写英文、数字和连字符，如 first-research-note；首次发布后固定。','cms-hint'))
      if(f.key==='publishDate')wrap.append(el('p','按北京时间；暂不支持未来日期定时发布。','cms-hint'))
      parent.append(wrap)
    }
  }
  private insert(area:HTMLTextAreaElement,before:string,after=''){
    const start=area.selectionStart,end=area.selectionEnd,selected=area.value.slice(start,end);area.focus()
    // Native insertText retains the browser's text undo stack. The fallback
    // still preserves the selection on engines without this editing command.
    const text=before+selected+after
    if(!document.execCommand('insertText',false,text)){area.setRangeText(text,start,end,'end');area.dispatchEvent(new Event('input',{bubbles:true}))}
  }
  private toolbar(area:HTMLTextAreaElement){
    const bar=el('div','','cms-toolbar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Markdown 格式')
    const formats=[['标题','\n## ',''],['加粗','**','**'],['斜体','*','*'],['删除线','~~','~~'],['引用','\n> ',''],['列表','\n- ',''],['编号','\n1. ',''],['任务','\n- [ ] ',''],['链接','[','](https://example.com)'],['代码','`','`'],['代码块','\n```text\n','\n```\n'],['表格','\n| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n',''],['公式','$','$'],['块公式','\n$$\n','\n$$\n'],['脚注','[^1]\n\n[^1]: 注释内容',''],['分隔线','\n\n---\n\n','']]
    formats.forEach(([name,before,after])=>bar.append(button(name,()=>this.insert(area,before,after))))
    bar.append(button('图片',()=>this.mediaPicker(m=>this.insert(area,`![${m.alt||m.name}](/media/${m.id}.webp)`))),button('撤销',()=>{area.focus();document.execCommand('undo')}),button('重做',()=>{area.focus();document.execCommand('redo')}));return bar
  }
  private async resolvePreviewImages(target:HTMLElement){
    const epoch=this.epoch
    for(const img of target.querySelectorAll<HTMLImageElement>('img')){
      const source=img.dataset.cmsImage||img.getAttribute('src')||'',match=source.match(mediaPattern)
      img.referrerPolicy='no-referrer';img.loading='lazy'
      if(match){img.removeAttribute('src');try{const url=await this.mediaUrl(match[1]);if(epoch===this.epoch&&img.isConnected)img.src=url}catch{img.alt=`图片尚不可用：${img.alt}`}}
    }
    target.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a=>{if(!a.getAttribute('href')?.startsWith('#')){a.target='_blank';a.rel='noopener noreferrer'}})
  }
  private setPreviewHtml(target:HTMLElement,html:string){
    const template=document.createElement('template');template.innerHTML=html
    template.content.querySelectorAll<HTMLImageElement>('img').forEach(img=>{const src=img.getAttribute('src')||'';if(mediaPattern.test(src)){img.dataset.cmsImage=src;img.removeAttribute('src')}img.referrerPolicy='no-referrer'})
    target.replaceChildren(template.content)
  }
  private previewImage(source:string,alt:string){const img=el('img');img.alt=alt;img.referrerPolicy='no-referrer';if(mediaPattern.test(source))img.dataset.cmsImage=source;else img.src=source;return img}
  private renderOverview(){
    const target=this.querySelector<HTMLElement>('[data-overview]'),d=this.current;if(!target||!d)return
    target.replaceChildren(el('p','内容预览 · 正式页面保留现有布局','cms-preview-label'))
    const p=d.payload
    const title=this.querySelector('[data-editor-title]');if(title)title.textContent=documentTitle(d)
    if(d.kind==='friend'){
      const card=el('div','','cms-friend-preview');if(p.avatar)card.append(this.previewImage(p.avatar,p.name))
      const text=el('div');text.append(el('strong',p.name||'友链名称'),el('p',p.intro||p.link,'cms-muted'));card.append(text);target.append(card)
    }else if(d.kind==='post'){
      target.append(el('h3',p.zh.title||'文章标题'),el('p',p.zh.description||'文章摘要','cms-muted'));if(p.cover)target.append(this.previewImage(p.cover,p.coverAlt))
    }else{
      const preview=el('div','','cms-md-preview prose dark:prose-invert');this.setPreviewHtml(preview,articleMarkdown(d.kind==='profile'?p.zh.about:p.zh.background));target.append(preview)
    }
    void this.resolvePreviewImages(target)
  }
  private async discard(){if(!this.current)return;window.clearTimeout(this.timer);if(!await this.confirmAction('放弃当前未保存的更改，重新读取上次保存的内容。','放弃未保存更改')){if(this.dirty)this.scheduleSave();return}if(this.saving)await this.saving;if(this.current.revision){this.saved=JSON.stringify(this.current.payload);await this.open(this.current.id)}else{this.current=null;this.saved='';this.q('[data-editor]').replaceChildren(el('div','草稿已放弃。','cms-empty'))}}
  private async duplicate(){if(!this.current||!await this.save())return;const old=this.current;this.current={id:crypto.randomUUID(),kind:old.kind,revision:0,payload:clone(old.payload)};if(old.kind==='post'){this.current.payload.slug='';this.current.payload.zh.title=`${old.payload.zh.title}（副本）`.slice(0,60)}else this.current.payload.name=`${old.payload.name}（副本）`;this.saved='';this.renderEditor();this.notify('副本为私有草稿，请修改后保存。')}
  private async trash(){if(!this.current)return;if(this.current.published_payload){await this.publish('trash');return}if(!await this.confirmAction('将这项草稿移入回收站，之后可以恢复。','确认移入回收站'))return;if(!await this.save())return;try{this.current=await this.rpc('cms_trash',{p_id:this.current.id,p_revision:this.current.revision,p_deleted:true});this.saved=JSON.stringify(this.current!.payload);this.renderEditor();await this.refresh();this.notify('已移入回收站。')}catch(error){this.notify(errorText(error),true)}}
  private async restore(){if(!this.current)return;try{this.current=await this.rpc('cms_trash',{p_id:this.current.id,p_revision:this.current.revision,p_deleted:false});this.saved=JSON.stringify(this.current!.payload);await this.switchView(this.current!.kind);this.notify('已恢复为草稿，尚未发布。')}catch(error){this.notify(errorText(error),true)}}
  private dialog(title:string){const dialog=this.q<HTMLDialogElement>('dialog'),body=this.q('[data-dialog-body]');body.replaceChildren(el('h2',title));if(!dialog.open)dialog.showModal();return body}
  private confirmAction(message:string,label='确认'):Promise<boolean>{
    this.confirmCancel?.()
    const epoch=this.epoch,dialog=el('dialog','','cms-dialog cms-confirm'),title=el('h2',label),controls=el('div','','cms-inline')
    dialog.setAttribute('aria-label',label);dialog.append(title,el('p',message),controls);this.append(dialog)
    return new Promise(resolve=>{
      let settled=false
      const finish=(accepted:boolean)=>{if(settled)return;settled=true;this.confirmCancel=undefined;dialog.close();dialog.remove();resolve(accepted&&epoch===this.epoch)}
      const cancel=button('取消',()=>finish(false))
      controls.append(cancel,button(label,()=>finish(true),'cms-primary'))
      this.confirmCancel=()=>finish(false)
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)})
      dialog.addEventListener('close',()=>finish(false))
      dialog.showModal();cancel.focus()
    })
  }
  private async history(){
    if(!this.current?.revision){this.notify('先保存一次草稿，就能查看历史版本。');return}const id=this.current.id,body=this.dialog('历史版本'),epoch=this.epoch
    const load=async(before=2147483647)=>{try{const versions=await this.rpc('cms_history',{p_id:id,p_before:before});if(epoch!==this.epoch)return;for(const v of versions){const row=el('div','','cms-job');row.append(el('p',`版本 ${v.revision} · ${timestamp(v.created_at)}${v.deleted?' · 回收站':''}`),button('查看 / 恢复',async()=>{try{const historical=await this.rpc('cms_get',{p_id:id,p_version:v.revision});if(epoch!==this.epoch)return;const area=this.dialog(`版本 ${v.revision}`);area.append(el('p','恢复会生成新的草稿版本，已上线内容不会立即改变。','cms-muted'));const pre=el('pre',JSON.stringify(historical.payload,null,2));pre.style.cssText='max-height:45vh;overflow:auto;white-space:pre-wrap;font-size:.75rem';area.append(pre,button('恢复为草稿',async()=>{if(this.current?.id!==id)return;this.current.payload=clone(historical.payload);this.q<HTMLDialogElement>('dialog').close();this.renderEditor();await this.save();this.notify('历史内容已恢复为草稿，请预览后发布。')},'cms-primary'))}catch(error){this.notify(errorText(error),true)}}));body.append(row)}if(versions.length===30)body.append(button('加载更早版本',()=>load(versions.at(-1).revision)))}catch(error){body.append(el('p',errorText(error)))}}
    await load()
  }
  private async publish(action:'publish'|'unpublish'|'trash'){
    if(this.publishing||!this.current)return
    this.publishing=true
    if(!await this.save()){this.publishing=false;return}
    const d=this.current
    const epoch=this.epoch
    try{if(action==='publish')validatePayload(d.kind,d.payload,true)}catch(error){this.notify(errorText(error),true);this.publishing=false;return}
    const label=action==='publish'?'发布这项内容':action==='unpublish'?'从网站撤回这项内容':'从网站下架并移入回收站'
    if(!await this.confirmAction(`${label}：${documentTitle(d)}。网站将在构建完成后更新，其他草稿保持私有。${action!=='publish'?' 已公开内容可能保留在 Git 历史中。':''}`,action==='publish'?'确认发布':action==='unpublish'?'确认撤回':'确认下架并回收')){this.publishing=false;return}
    const controls=Array.from(this.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement>('[data-cms-shell] button,[data-cms-shell] input,[data-cms-shell] textarea')).filter(x=>!x.disabled)
    controls.forEach(x=>x.disabled=true)
    try{
      const previous=this.pendingRequest
      const request=previous?.id===d.id&&previous.revision===d.revision&&previous.action===action?previous.request:crypto.randomUUID()
      this.pendingRequest={id:d.id,revision:d.revision,action,request}
      const job=await this.rpc('cms_prepare_publish',{p_id:d.id,p_revision:d.revision,p_action:action,p_request_id:request})
      this.pendingRequest=undefined
      this.notify('正在提交发布，请稍候…')
      await this.invoke(job.id,'publish');this.saved=JSON.stringify(d.payload);this.current=null;await this.switchView('jobs');await this.refresh();this.notify('已提交发布。部署完成后网站会更新，可在这里查看进度。')
    }catch(error){if(epoch===this.epoch)this.notify(errorText(error),true)}
    finally{this.publishing=false;controls.forEach(x=>x.disabled=false)}
  }
  private async invoke(id:string,action:string):Promise<any>{
    const epoch=this.epoch
    const {data:{session}}=await this.client!.auth.getSession()
    if(!session||session.user.id!==this.userId||epoch!==this.epoch)throw new Error('登录状态已改变，请重新登录。')
    const res=await fetch(`${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/cms-publish`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.PUBLIC_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({id,action}),signal:AbortSignal.timeout(90000)})
    const data=await res.json()
    if(epoch!==this.epoch)throw new Error('账号已切换，本次操作已停止。')
    if(!res.ok)throw new Error(typeof data?.error==='string'?data.error:'发布服务暂不可用，草稿和任务记录已保留。')
    if(data?.error)throw new Error(data.error)
    if(action==='publish'&&data.state==='queued'&&Number.isInteger(data.remaining)){
      this.notify(`正在准备图片，剩余 ${data.remaining} 张。页面关闭后可在发布记录继续。`)
      return this.invoke(id,action)
    }
    return data
  }
  private async renderJobs(){
    const target=this.q('[data-editor]');target.replaceChildren(el('h2','发布记录'),el('p','提交成功后仍需构建；只有正式站点确认版本后，才显示“已上线”。','cms-hint'))
    try{
      const jobs=await this.rpc('cms_jobs');if(this.view!=='jobs')return
      if(!jobs.length)target.append(el('div','还没有发布记录。','cms-empty'))
      const states:Record<string,string>={queued:'等待提交',publishing:'正在提交',failed:'提交未完成',committed:'已提交 · 等待部署',live:'已上线',cancelled:'已取消'}
      for(const j of jobs){const row=el('div','','cms-job'),doc=this.docs.find(d=>d.id===j.document_id),status=el('p',states[j.state]||j.state);row.append(el('strong',`${doc?.title||j.document_id} · ${j.action==='publish'?'发布':j.action==='trash'?'删除':'撤回'}`),el('p',timestamp(j.created_at),'cms-muted'),status)
        if(j.error)row.append(el('p',j.error))
        const controls=el('div','','cms-inline')
        if(['queued','publishing','failed'].includes(j.state)){
          controls.append(button('继续 / 重试',async()=>{try{await this.invoke(j.id,'publish');await this.refresh()}catch(error){this.notify(errorText(error),true)}}),button('取消此任务',async()=>{if(!await this.confirmAction('取消尚未提交的发布任务。若提交已完成，会显示真实状态。','确认取消任务'))return;try{await this.invoke(j.id,'cancel');await this.refresh()}catch(error){this.notify(errorText(error),true)}}))
        }
        if(j.state==='committed')controls.append(button('刷新部署状态',async()=>{try{const result=await this.invoke(j.id,'status');if(result.state==='live')await this.renderJobs();else{status.textContent=result.deploy?.conclusion&&result.deploy.conclusion!=='success'?`部署未成功（${result.deploy.conclusion}），网站保留上一版本。`:'正在等待部署完成，请稍后刷新。';if(result.deploy?.url){const a=el('a','查看构建详情 ↗');a.href=result.deploy.url;a.target='_blank';a.rel='noopener noreferrer';row.append(a)}}}catch(error){this.notify(errorText(error),true)}}))
        if(j.state==='committed')controls.append(button('重新部署',async()=>{if(!await this.confirmAction('重新构建这次已经提交的内容，其他草稿保持私有。','确认重新部署'))return;try{await this.invoke(j.id,'redeploy');await this.renderJobs();this.notify('已重新触发部署。')}catch(error){this.notify(errorText(error),true)}}))
        if(j.state==='live')controls.append(el('span','✓ 正式站已确认','cms-muted'))
        row.append(controls);target.append(row)
      }
      window.clearTimeout(this.jobsTimer)
      const pending=jobs.find((j:any)=>j.state==='committed')
      if(pending)this.jobsTimer=window.setTimeout(async()=>{if(this.view!=='jobs'||document.visibilityState!=='visible')return;try{await this.invoke(pending.id,'status');await this.renderJobs()}catch{/* Manual retry stays available without a noisy error loop. */}},30000)
    }catch(error){this.notify(errorText(error),true)}
  }
  private async mediaUrl(id:string){
    if(this.privateUrls.has(id))return this.privateUrls.get(id)!
    const epoch=this.epoch,{data,error}=await this.client!.storage.from('cms-media').download(`${id}.webp`)
    if(epoch!==this.epoch)throw new Error('登录状态已改变。')
    if(error||!data)throw new Error('图片无法读取。')
    const url=URL.createObjectURL(data);this.privateUrls.set(id,url);return url
  }
  private async upload(file:File,avatar=false):Promise<Media|null>{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw new Error('请选择不超过 15 MB 的 JPEG、PNG 或 WebP 图片。')
    const epoch=this.epoch;this.notify('正在优化并上传图片…')
    const bitmap=await createImageBitmap(file),limit=avatar?320:2400,scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height))
    if(bitmap.width*bitmap.height>40000000){bitmap.close();throw new Error('图片尺寸过大，请先缩小后上传。')}
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
    let blob:Blob
    try { blob=await encodeCMSImage(canvas) } finally { canvas.width=canvas.height=1 }
    if(epoch!==this.epoch)return null
    const m:Media={id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'').slice(0,120)+'.webp',alt:'',deleted:false}
    await this.rpc('cms_media_save',{p_id:m.id,p_name:m.name,p_alt:m.alt})
    const {error}=await this.client!.storage.from('cms-media').upload(`${m.id}.webp`,blob,{contentType:'image/webp',upsert:false})
    if(epoch!==this.epoch)return null
    if(error)throw new Error('图片上传未完成，请重试。未完成记录可在图片库移入回收站。')
    this.privateUrls.set(m.id,URL.createObjectURL(blob));this.notify('图片已保存在私有图片库。被发布内容引用后才会公开。');return m
  }
  private uploadControl(complete:(m:Media)=>unknown,avatar=false){const label=el('label','上传图片','cms-file'),input=el('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';label.append(input);input.addEventListener('change',async()=>{const file=input.files?.[0];input.value='';if(!file)return;input.disabled=true;try{const m=await this.upload(file,avatar);if(m)await complete(m)}catch(error){this.notify(errorText(error),true)}finally{input.disabled=false}});return label}
  private async mediaPicker(select:(m:Media)=>unknown,avatar=false){
    const body=this.dialog('选择图片');body.append(this.uploadControl(async m=>{select(m);this.q<HTMLDialogElement>('dialog').close()},avatar));const grid=el('div','','cms-media-grid');body.append(grid)
    try{const media:Media[]=await this.rpc('cms_media_list');for(const m of media.filter(x=>!x.deleted))await this.mediaCard(grid,m,()=>{select(m);this.q<HTMLDialogElement>('dialog').close()})}catch(error){body.append(el('p',errorText(error)))}
  }
  private async mediaCard(grid:HTMLElement,m:Media,select?:()=>unknown){
    const epoch=this.epoch,card=el('div','','cms-media-card'),img=el('img');img.alt=m.alt||m.name;card.append(img,el('p',m.name));grid.append(card)
    try{const url=await this.mediaUrl(m.id);if(epoch!==this.epoch)return;img.src=url}catch{img.alt='图片未上传完成'}
    if(select)card.append(button('使用这张图片',select));else{
      card.append(button('编辑说明',()=>{const body=this.dialog('图片名称与说明'),name=el('input'),alt=el('textarea');name.value=m.name;alt.value=m.alt;name.maxLength=150;alt.maxLength=500;const nameLabel=el('label','名称'),altLabel=el('label','替代文字');nameLabel.append(name);altLabel.append(alt);body.append(nameLabel,altLabel,button('保存',async()=>{try{await this.rpc('cms_media_save',{p_id:m.id,p_name:name.value,p_alt:alt.value,p_deleted:m.deleted});this.q<HTMLDialogElement>('dialog').close();await this.renderMedia()}catch(error){this.notify(errorText(error),true)}}))}),button(m.deleted?'恢复':'移入回收站',async()=>{try{await this.rpc('cms_media_save',{p_id:m.id,p_name:m.name,p_alt:m.alt,p_deleted:!m.deleted});await this.renderMedia()}catch(error){this.notify(errorText(error),true)}}))
    }
  }
  private async renderMedia(){
    const target=this.q('[data-editor]');target.replaceChildren(el('h2','图片库'),el('p','图片自动转为 WebP 并移除原始元数据。替换图片请上传新文件，旧版本仍可恢复。','cms-hint'),this.uploadControl(()=>this.renderMedia()))
    try{const media:Media[]=await this.rpc('cms_media_list');if(this.view!=='media')return
      for(const deleted of [false,true]){const section=el('section');section.append(el('h3',deleted?'已回收的图片':'可用图片'));const grid=el('div','','cms-media-grid');section.append(grid);target.append(section);for(const m of media.filter(x=>x.deleted===deleted))await this.mediaCard(grid,m);if(!grid.childElementCount)grid.append(el('p','暂无图片。','cms-muted'))}
    }catch(error){this.notify(errorText(error),true)}
  }
  private download(name:string,content:string){const blob=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
  private exportCurrent(){if(!this.current)return;this.download(`cyril-${this.current.kind}-${this.current.id}.json`,JSON.stringify({version:1,documents:[this.current],media:[]},null,2));this.notify('已导出当前填写内容；未自动发布。')}
  private async exportBackup(){
    if(!await this.leaveEditor())return
    const epoch=this.epoch
    try{
      this.notify('正在准备私有备份…');const list:Summary[]=await this.rpc('cms_list'),documents=[]
      for(const d of list)documents.push(await this.rpc('cms_get',{p_id:d.id}))
      const media:Media[]=await this.rpc('cms_media_list'),assets=[];let size=0
      for(const m of media){const {data,error}=await this.client!.storage.from('cms-media').download(`${m.id}.webp`);if(error||!data)throw new Error(`图片 ${m.name} 无法备份，请先检查图片库。`);size+=data.size;if(size>40*1024*1024)throw new Error('完整备份的图片超过 40 MB，请联系维护者导出；也可单独导出当前内容。');assets.push({...m,data:bytesBase64(new Uint8Array(await data.arrayBuffer()))})}
      if(epoch!==this.epoch)return
      this.download(`cyril-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({version:1,exportedAt:new Date().toISOString(),documents,media:assets},null,2));this.notify('备份已下载，包含当前内容和图片。历史版本继续保留在后台。')
    }catch(error){if(epoch===this.epoch)this.notify(errorText(error),true)}
  }
  private async importFile(file:File){
    if(file.size>60*1024*1024){this.notify('导入文件不能超过 60 MB。',true);return}
    if(!await this.leaveEditor())return
    const epoch=this.epoch
    try{
      const text=await file.text();let input:any
      if(/\.(?:md|markdown)$/i.test(file.name)){const payload=emptyPayload('post');payload.zh.title=file.name.replace(/\.[^.]+$/,'').slice(0,60);payload.zh.body=text;input={version:1,documents:[{kind:'post',payload}],media:[]}}
      else input=JSON.parse(text)
      if(input.version!==1||!Array.isArray(input.documents)||input.documents.length>500||!Array.isArray(input.media)||input.media.length>300)throw new Error('不支持的备份格式。')
      const docs=input.documents.map((d:any)=>{if(!isKind(d.kind))throw new Error('备份包含未知内容类型。');return {kind:d.kind as Kind,payload:validatePayload(d.kind,d.payload)}})
      if(docs.filter((d:any)=>d.kind==='profile').length>1||docs.filter((d:any)=>d.kind==='academic').length>1)throw new Error('备份包含重复的固定页面。')
      const assets=input.media.map((m:any)=>{if(typeof m.id!=='string'||typeof m.data!=='string'||typeof m.name!=='string'||m.name.length>150||typeof m.alt!=='string'||m.alt.length>500)throw new Error('图片备份格式不正确。');const bytes=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));validateWebp(bytes);return {...m,newId:crypto.randomUUID(),bytes}})
      if(epoch!==this.epoch)return
      const body=this.dialog('核对导入内容');body.append(el('p',`${docs.length} 项内容，${assets.length} 张图片。文章和友链会创建副本；首页与关于、学术与项目会更新其草稿，线上版本不变。`),el('p','导入不会自动发布。文章副本的网址会留空，请填写新的网址后再发布。','cms-muted'))
      let docIndex=0,assetIndex=0;const importedIds=new Map<number,string>()
      const apply=button('导入为草稿',async()=>{
        apply.disabled=true
        try{
          for(;assetIndex<assets.length;assetIndex++){const a=assets[assetIndex];await this.rpc('cms_media_save',{p_id:a.newId,p_name:a.name,p_alt:a.alt});const {error}=await this.client!.storage.from('cms-media').upload(`${a.newId}.webp`,a.bytes,{contentType:'image/webp',upsert:false});if(error&&String(error.statusCode)!=='409')throw error;if(epoch!==this.epoch)return}
          for(;docIndex<docs.length;docIndex++){
            if(epoch!==this.epoch)return
            const d=docs[docIndex];let serialized=JSON.stringify(d.payload);for(const a of assets)serialized=serialized.replaceAll(`/media/${a.id}.webp`,`/media/${a.newId}.webp`)
            const payload=JSON.parse(serialized),fixed=['profile','academic'].includes(d.kind),id=fixed?d.kind:importedIds.get(docIndex)||crypto.randomUUID();importedIds.set(docIndex,id)
            if(d.kind==='post')payload.slug=''
            let revision=0
            if(fixed)revision=(await this.rpc('cms_get',{p_id:id})).revision
            else if((await this.rpc('cms_list')).some((entry:Summary)=>entry.id===id)){
              const existing=await this.rpc('cms_get',{p_id:id})
              if(JSON.stringify(existing.payload)===JSON.stringify(payload))continue
              throw new Error('这项导入草稿已被修改，请先核对现有内容。')
            }
            await this.rpc('cms_save',{p_id:id,p_kind:d.kind,p_revision:revision,p_payload:payload})
          }
          this.q<HTMLDialogElement>('dialog').close();this.current=null;await this.refresh();this.notify(`已导入 ${docs.length} 项草稿，尚未发布。`)
        }catch(error){if(epoch===this.epoch){this.notify(`导入已完成 ${docIndex}/${docs.length} 项，可继续重试。${errorText(error)}`,true);apply.textContent='继续导入';apply.disabled=false}}
      },'cms-primary');body.append(apply)
    }catch(error){if(epoch===this.epoch)this.notify(errorText(error),true)}
  }
}
export function installCMS(){if(!customElements.get('owner-cms'))customElements.define('owner-cms',OwnerCMS)}

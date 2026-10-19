import { getCommentClient } from './comment-auth'
import { commentError, type CommentRow, type CommentMe } from './comment-utils'

export class SiteComments extends HTMLElement {
  private client = getCommentClient()
  private lifetime?: AbortController
  private generation = 0
  private busy = false
  private rows: CommentRow[] = []
  private me: CommentMe = { nickname:null, can_post:false, is_admin:false, banned:false, moderation_enabled:false }
  private parent: CommentRow | null = null
  private requestId: string | null = null
  private fingerprint = ''
  private pendingConfirmation: ((value:boolean)=>void) | null = null
  private get en() { return this.dataset.lang === 'en' }
  private t(zh:string,en:string) { return this.en ? en : zh }
  private el<T extends Element = HTMLElement>(selector:string) { return this.querySelector<T>(selector)! }
  private status(text:string,error=false) { const el=this.el('[data-status]'); el.textContent=text; el.dataset.error=String(error) }
  private signal() { return AbortSignal.any([this.lifetime!.signal, AbortSignal.timeout(20000)]) }

  connectedCallback() {
    if (this.lifetime) return
    this.lifetime = new AbortController()
    this.el('[data-configured]').hidden = !this.client
    this.el('[data-unconfigured]').hidden = !!this.client
    if (!this.client) return
    const options = { signal:this.lifetime.signal }
    this.el('form[data-compose]').addEventListener('submit',event=>{event.preventDefault(); void this.submit()},options)
    this.el('[data-refresh]').addEventListener('click',()=>void this.load(),options)
    this.el('[data-more]').addEventListener('click',()=>void this.load(true),options)
    this.el('[data-cancel-reply]').addEventListener('click',()=>this.setReply(null),options)
    this.el<HTMLTextAreaElement>('textarea').addEventListener('input',()=>{
      this.el('[data-counter]').textContent=`${this.el<HTMLTextAreaElement>('textarea').value.length} / 2000`
    },options)
    this.el<HTMLInputElement>('[data-moderation]').addEventListener('change',()=>void this.moderation(),options)
    window.addEventListener('comment-auth-change',()=>{ this.clearPermissions(); void this.load() },options)
    this.el<HTMLDialogElement>('dialog').addEventListener('close',()=>{
      this.pendingConfirmation?.(this.el<HTMLDialogElement>('dialog').returnValue==='confirm')
      this.pendingConfirmation=null
    },options)
    void this.load()
  }

  disconnectedCallback() {
    this.lifetime?.abort(); this.lifetime=undefined; this.generation++
    this.busy=false
    this.pendingConfirmation?.(false); this.pendingConfirmation=null
    this.el<HTMLDialogElement>('dialog')?.close()
  }

  private updateControls() {
    this.el<HTMLButtonElement>('[data-compose] [data-submit]').disabled = this.busy || !this.me.can_post
    this.el<HTMLInputElement>('[name=nickname]').disabled = this.busy
    this.el<HTMLTextAreaElement>('textarea').disabled = this.busy
    this.el('[data-admin]').hidden = !this.me.is_admin
    this.el<HTMLInputElement>('[data-moderation]').checked=this.me.moderation_enabled
    this.el<HTMLInputElement>('[data-moderation]').disabled=this.busy
    this.el<HTMLButtonElement>('[data-cancel-reply]').disabled=this.busy
    this.querySelectorAll<HTMLButtonElement>('[data-list] button').forEach(button=>{button.disabled=this.busy})
  }

  private clearPermissions() {
    this.me.can_post=false; this.me.is_admin=false
    this.rows=this.rows.filter(row=>!row.is_pending).map(row=>({...row,can_delete:false,author_banned:null}))
    this.render(); this.updateControls()
  }

  private async load(more=false) {
    if (!this.client || !this.lifetime) return false
    const generation=++this.generation
    const last=more ? this.rows.at(-1) : null
    this.el<HTMLButtonElement>('[data-more]').disabled=true
    this.el<HTMLButtonElement>('[data-refresh]').disabled=true
    this.el('[data-list]').setAttribute('aria-busy','true')
    try {
      const [identity,result]=await Promise.all([
        this.client.rpc('comment_me').abortSignal(this.signal()),
        this.client.rpc('comment_list',{p_thread:this.dataset.thread,p_before:last?.created_at??null,p_before_id:last?.id??null,p_limit:30}).abortSignal(this.signal())
      ])
      if (generation!==this.generation || !this.isConnected) return false
      if (identity.error) throw identity.error
      if (result.error) throw result.error
      this.me=(Array.isArray(identity.data) ? identity.data[0] : identity.data) as CommentMe
      const next=(result.data??[]) as CommentRow[]
      this.rows=more ? [...this.rows,...next.filter(row=>!this.rows.some(old=>old.id===row.id))] : next
      const nickname=this.el<HTMLInputElement>('[name=nickname]')
      if (!nickname.value && this.me.nickname) nickname.value=this.me.nickname
      this.render()
      this.el('[data-more]').hidden=next.length<30
      this.status(this.me.banned ? this.t('此账号暂时无法发布新留言，但仍可删除自己的留言。','This account cannot post new comments, but can delete its own comments.') : this.rows.length ? '' : this.t('还没有留言，欢迎留下第一条。','No comments yet. Start the conversation.'))
      return true
    } catch(error) {
      if(generation===this.generation && this.isConnected) { this.clearPermissions(); this.status(commentError(error as Error,this.en),true) }
      return false
    } finally {
      if(generation===this.generation && this.isConnected) {
        this.updateControls(); this.el<HTMLButtonElement>('[data-more]').disabled=false; this.el<HTMLButtonElement>('[data-refresh]').disabled=false
        this.el('[data-list]').setAttribute('aria-busy','false')
      }
    }
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string) {
    const node=document.createElement(tag)
    if(text!==undefined) node.textContent=text
    if(className) node.className=className
    return node
  }
  private render() {
    const list=this.el('[data-list]'); list.replaceChildren()
    for(const row of this.rows) {
      const item=this.node('li',undefined,'comment-item'); item.id=`comment-${row.id}`
      const header=this.node('div',undefined,'comment-item-header')
      header.append(this.node('strong',row.nickname))
      if(row.is_admin_author) header.append(this.node('span',this.t('站长','Author'),'comment-badge'))
      if(row.is_pending) header.append(this.node('span',this.t('待审核','Pending review'),'comment-badge'))
      const time=this.node('time',new Intl.DateTimeFormat(this.en?'en':'zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.created_at)))
      time.dateTime=row.created_at; header.append(time); item.append(header)
      if(row.parent_id) item.append(this.node('p',`${this.t('回复','Reply to')} ${row.parent_deleted ? this.t('已删除的留言','a deleted comment') : row.parent_nickname??this.t('留言','a comment')}`,'comment-context'))
      item.append(this.node('p',row.deleted ? this.t('此评论已删除','This comment has been deleted.') : row.body,'comment-body'))
      const actions=this.node('div',undefined,'comment-item-actions')
      const action=(label:string,run:()=>void)=>{
        const button=this.node('button',label); button.type='button'; button.disabled=this.busy
        button.addEventListener('click',run,{signal:this.lifetime!.signal}); actions.append(button)
      }
      if(!row.deleted && this.me.can_post) action(this.t('回复','Reply'),()=>this.setReply(row))
      if(!row.deleted && row.can_delete) action(this.t('删除','Delete'),()=>void this.removeComment(row,false))
      if(this.me.is_admin) {
        action(this.t('清理整串','Remove thread'),()=>void this.removeComment(row,true))
        if(!row.is_admin_author) action(row.author_banned ? this.t('解除封禁','Unban author') : this.t('封禁作者','Ban author'),()=>void this.ban(row))
        if(row.is_pending) action(this.t('审核通过','Approve'),()=>void this.mutate('comment_review',{p_id:row.id,p_approve:true}))
      }
      item.append(actions); list.append(item)
    }
  }

  private setReply(row:CommentRow|null) {
    this.parent=row; this.el('[data-reply]').hidden=!row
    this.el('[data-reply] span').textContent=row ? `${this.t('正在回复','Replying to')} ${row.nickname}` : ''
    if(row) this.el<HTMLTextAreaElement>('textarea').focus()
  }

  private async submit() {
    if(this.busy || !this.me.can_post || !this.client) return
    const lifetime=this.lifetime
    const body=this.el<HTMLTextAreaElement>('textarea').value.trim()
    const nickname=this.el<HTMLInputElement>('[name=nickname]').value.trim()
    if(!body || !nickname) {this.status(this.t('请填写昵称和留言内容。','Please enter a nickname and a comment.'),true); return}
    const fingerprint=JSON.stringify([body,nickname,this.parent?.id??null])
    if(fingerprint!==this.fingerprint || !this.requestId) {this.fingerprint=fingerprint; this.requestId=crypto.randomUUID()}
    this.busy=true; this.updateControls(); this.status(this.t('正在发布…','Posting…'))
    try {
      const {data,error}=await this.client.rpc('comment_create',{p_thread:this.dataset.thread,p_body:body,p_nickname:nickname,p_parent_id:this.parent?.id??null,p_request_id:this.requestId}).abortSignal(this.signal())
      if(this.lifetime!==lifetime || !this.isConnected) return
      if(error) throw error
      this.el<HTMLTextAreaElement>('textarea').value=''; this.el('[data-counter]').textContent='0 / 2000'
      this.requestId=null; this.setReply(null)
      const loaded=await this.load()
      if(this.lifetime!==lifetime || !this.isConnected) return
      this.status(loaded ? (data?.is_pending ? this.t('已提交，审核通过后公开。','Submitted for review.') : this.t('留言已发布。','Your comment has been posted.')) : this.t('留言已提交，但列表刷新失败。请点击刷新，无需重复提交。','Your comment was submitted, but the list could not refresh. Refresh the list; you do not need to post again.'),!loaded)
    } catch(error) { if(this.lifetime===lifetime && this.isConnected) this.status(commentError(error as Error,this.en),true) }
    finally { if(this.lifetime===lifetime) {this.busy=false; if(this.isConnected) this.updateControls()} }
  }

  private async confirm(title:string,description:string) {
    if(this.pendingConfirmation) return false
    const dialog=this.el<HTMLDialogElement>('dialog')
    this.el('#comment-confirm-title').textContent=title; this.el('[data-confirm-description]').textContent=description
    dialog.returnValue='cancel'; dialog.showModal()
    return new Promise<boolean>(resolve=>{this.pendingConfirmation=resolve})
  }
  private async removeComment(row:CommentRow,branch:boolean) {
    if(this.busy) return
    const approved=await this.confirm(branch?this.t('清理整串讨论？','Remove this entire thread?'):this.t('删除这条留言？','Delete this comment?'),branch?this.t('这条留言及其所有回复将被隐藏，正文会清空，无法恢复。','This comment and all its replies will be hidden and their content cleared. This cannot be undone.'):this.t('正文会清空并显示删除占位，其他人的回复会保留。此操作无法恢复。','The content will be cleared and replaced with a deletion notice. Other people’s replies stay. This cannot be undone.'))
    if(approved) await this.mutate('comment_delete',{p_id:row.id,p_branch:branch})
  }
  private async ban(row:CommentRow) {
    if(this.busy) return
    const approved=await this.confirm(row.author_banned?this.t('解除封禁？','Unban this author?'):this.t('封禁此作者？','Ban this author?'),row.author_banned?this.t('该账号将恢复发布权限。','This account will be allowed to post again.'):this.t('该账号将不能发布新留言；现有留言需单独处理，作者仍能删除自己的留言。','The account will be unable to post. Existing comments stay, and the author can still delete their own comments.'))
    if(approved) await this.mutate('comment_ban',{p_comment_id:row.id,p_banned:!row.author_banned})
  }
  private async moderation() {
    const wanted=this.el<HTMLInputElement>('[data-moderation]').checked
    this.el<HTMLInputElement>('[data-moderation]').checked=this.me.moderation_enabled
    await this.mutate('comment_moderation',{p_enabled:wanted})
  }
  private async mutate(name:string,args:Record<string,unknown>) {
    if(this.busy || !this.client) return
    const lifetime=this.lifetime
    this.busy=true; this.updateControls()
    try {
      const {error}=await this.client.rpc(name,args).abortSignal(this.signal())
      if(this.lifetime!==lifetime || !this.isConnected) return
      if(error) throw error
      const loaded=await this.load()
      if(this.lifetime!==lifetime || !this.isConnected) return
      this.status(loaded ? this.t('操作已完成。','Done.') : this.t('操作已完成，但列表刷新失败。请点击刷新查看结果。','The action succeeded, but the list could not refresh. Please refresh to see the result.'),!loaded)
    } catch(error) {if(this.lifetime===lifetime && this.isConnected) this.status(commentError(error as Error,this.en),true)}
    finally {if(this.lifetime===lifetime) {this.busy=false; if(this.isConnected) this.updateControls()}}
  }
}
if(!customElements.get('site-comments')) customElements.define('site-comments',SiteComments)

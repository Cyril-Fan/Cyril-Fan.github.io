import { getCommentClient, type CommentAuthChangeDetail } from './comment-auth'
import { commentError, type CommentRow, type CommentMe } from './comment-utils'

const guestIdentity = (): CommentMe => ({ nickname:null, can_post:false, is_admin:false, banned:false, moderation_enabled:false })

export class SiteComments extends HTMLElement {
  private client = getCommentClient()
  private lifetime?: AbortController
  private accountLifetime = new AbortController()
  private generation = 0
  private accountVersion = 0
  private accountId: string | null | undefined
  private busy = false
  private loading = false
  private identityReady = false
  private editingProfile = false
  private rows: CommentRow[] = []
  private me = guestIdentity()
  private parent: CommentRow | null = null
  private replyUnavailable = false
  private requestId: string | null = null
  private fingerprint = ''
  private pendingConfirmation: ((value:boolean)=>void) | null = null
  private get en() { return this.dataset.lang === 'en' }
  private t(zh:string,en:string) { return this.en ? en : zh }
  private el<T extends Element = HTMLElement>(selector:string) { return this.querySelector<T>(selector)! }
  private status(text:string,error=false) { const el=this.el('[data-status]'); el.textContent=text; el.dataset.error=String(error) }
  private signal() { return AbortSignal.any([this.lifetime!.signal, this.accountLifetime.signal, AbortSignal.timeout(20000)]) }
  private current(lifetime:AbortController|undefined, account:number) { return this.isConnected && this.lifetime===lifetime && this.accountVersion===account }
  private name() { return this.me.is_admin ? 'Cyril Fan' : this.me.nickname }

  connectedCallback() {
    if (this.lifetime) return
    this.lifetime = new AbortController()
    this.el('[data-configured]').hidden = !this.client
    this.el('[data-unconfigured]').hidden = !!this.client
    if (!this.client) return
    const options = { signal:this.lifetime.signal }
    this.el('form[data-compose]').addEventListener('submit',event=>{event.preventDefault(); void this.submit()},options)
    this.el('[data-refresh]').addEventListener('click',()=>void this.load(false,true),options)
    this.el('[data-more]').addEventListener('click',()=>void this.load(true),options)
    this.el('[data-cancel-reply]').addEventListener('click',()=>this.setReply(null,true),options)
    this.el('[data-profile-edit]').addEventListener('click',()=>this.editProfile(true),options)
    this.el('[data-profile-cancel]').addEventListener('click',()=>this.editProfile(false),options)
    this.el('[data-profile-save]').addEventListener('click',()=>void this.saveProfile(),options)
    this.el('[data-sign-in]').addEventListener('click',()=>{
      this.el('comment-auth').dispatchEvent(new CustomEvent('comment-auth-open'))
    },options)
    this.el<HTMLInputElement>('[name=nickname]').addEventListener('keydown',event=>{
      if(event.isComposing || event.keyCode===229) return
      if(event.key==='Enter') { event.preventDefault(); void this.saveProfile() }
      if(event.key==='Escape' && this.name()) { event.preventDefault(); this.editProfile(false) }
    },options)
    const textarea=this.el<HTMLTextAreaElement>('textarea')
    textarea.addEventListener('input',()=>{this.el('[data-counter]').textContent=`${textarea.value.length} / 2000`},options)
    textarea.addEventListener('keydown',event=>{
      if(event.key==='Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault()
        if(!this.busy && this.me.can_post) this.el<HTMLFormElement>('[data-compose]').requestSubmit()
      }
    },options)
    this.el<HTMLInputElement>('[data-moderation]').addEventListener('change',()=>void this.moderation(),options)
    window.addEventListener('comment-auth-change',event=>{
      const userId=(event as CustomEvent<CommentAuthChangeDetail>).detail?.userId
      if(userId!==undefined) this.authChanged(userId)
      else {
        const lifetime=this.lifetime, account=this.accountVersion
        void this.client!.auth.getSession().then(({data,error})=>{
          if(this.current(lifetime,account)) this.authChanged(error ? null : data.session?.user.id??null)
        }).catch(()=>{
          if(this.current(lifetime,account)) this.authChanged(null)
        })
      }
    },options)
    document.addEventListener('click',event=>{
      this.querySelectorAll<HTMLDetailsElement>('.comment-menu[open]').forEach(menu=>{
        if(!menu.contains(event.target as Node)) menu.open=false
      })
    },options)
    this.addEventListener('keydown',event=>{
      if(event.key!=='Escape') return
      this.querySelectorAll<HTMLDetailsElement>('.comment-menu[open]').forEach(menu=>{
        menu.open=false; menu.querySelector('summary')?.focus()
      })
    },options)
    this.el<HTMLDialogElement>('dialog').addEventListener('close',()=>{
      this.pendingConfirmation?.(this.el<HTMLDialogElement>('dialog').returnValue==='confirm')
      this.pendingConfirmation=null
    },options)
    void this.load(false,true)
  }

  disconnectedCallback() {
    this.lifetime?.abort(); this.lifetime=undefined; this.generation++; this.accountVersion++
    this.busy=false; this.loading=false
    this.pendingConfirmation?.(false); this.pendingConfirmation=null
    this.el<HTMLDialogElement>('dialog')?.close()
  }

  private authChanged(userId:string|null) {
    if(userId===this.accountId) {
      // SDK SIGNED_IN can also mean a refocused tab; TOKEN_REFRESHED is not an account switch.
      if(!this.busy && !this.loading) void this.load(false,true)
      return
    }
    this.accountId=userId
    this.accountLifetime.abort(); this.accountLifetime=new AbortController(); this.accountVersion++
    this.busy=false; this.editingProfile=false; this.requestId=null; this.fingerprint=''
    this.el<HTMLInputElement>('[name=nickname]').value=''
    this.pendingConfirmation?.(false); this.pendingConfirmation=null
    this.el<HTMLDialogElement>('dialog').close()
    this.clearPermissions(); this.setReply(null); void this.load()
  }

  private updateControls() {
    const name=this.name()
    const showEditor=this.me.can_post && !this.me.is_admin && (!name || this.editingProfile)
    const nickname=this.el<HTMLInputElement>('[name=nickname]')
    this.el<HTMLElement>('[data-compose]').hidden=!this.me.can_post
    this.el('[data-login-prompt]').hidden=!this.identityReady || this.me.can_post || this.me.banned
    this.el('[data-identity]').hidden=!name
    this.el('[data-identity-name]').textContent=name??''
    this.el('[data-identity-avatar]').textContent=this.initials(name??'')
    this.el('[data-owner-badge]').hidden=!this.me.is_admin
    this.el('[data-profile-edit]').hidden=this.me.is_admin || this.editingProfile
    this.el('[data-profile-editor]').hidden=!showEditor
    this.el('[data-profile-cancel]').hidden=!name
    this.el('[data-profile-hint]').textContent=name
      ? this.t('修改后，你之前的所有留言和回复也会显示新昵称。','Your new nickname will also appear on all your earlier comments and replies.')
      : this.t('取一个公开昵称，只需设置一次。之后可随时修改。','Choose a public nickname once. You can change it later.')
    nickname.disabled=this.busy || !showEditor
    nickname.required=showEditor && !name
    this.querySelectorAll<HTMLButtonElement>('[data-profile-edit], [data-profile-save], [data-profile-cancel]').forEach(button=>{button.disabled=this.busy})
    this.el<HTMLButtonElement>('[data-compose] [data-submit]').disabled=this.busy || !this.me.can_post || this.replyUnavailable || (this.editingProfile && !!name)
    this.el<HTMLTextAreaElement>('textarea').disabled=this.busy
    this.el('[data-admin]').hidden=!this.me.is_admin
    this.el<HTMLInputElement>('[data-moderation]').checked=this.me.moderation_enabled
    this.el<HTMLInputElement>('[data-moderation]').disabled=this.busy
    this.el<HTMLButtonElement>('[data-cancel-reply]').disabled=this.busy
    this.querySelectorAll<HTMLButtonElement>('[data-list] .comment-item-actions button').forEach(button=>{button.disabled=this.busy})
    this.el<HTMLButtonElement>('[data-refresh]').disabled=this.loading || this.busy
    this.el<HTMLButtonElement>('[data-more]').disabled=this.loading || this.busy
    ;(this.me.can_post ? this.el('[data-compose]') : this.el('[data-status-home]')).append(this.el('[data-status]'))
  }

  private clearPermissions() {
    this.me=guestIdentity(); this.identityReady=false
    this.rows=this.rows.filter(row=>!row.is_pending).map(row=>({...row,can_delete:false,author_banned:null}))
    this.render(); this.updateControls()
  }

  private async load(more=false,preservePages=false) {
    if (!this.client || !this.lifetime) return false
    const generation=++this.generation
    const targetPages=preservePages ? Math.max(1,Math.ceil(this.rows.length/30)) : 1
    const last=more ? this.rows.at(-1) : null
    this.loading=true; this.updateControls()
    this.el('[data-list]').setAttribute('aria-busy','true')
    this.el('[data-empty]').hidden=true
    if(!this.rows.length) this.status(this.t('正在加载留言…','Loading comments…'))
    try {
      const fetchPage=(cursor?:CommentRow|null)=>this.client!.rpc('comment_list',{p_thread:this.dataset.thread,p_before:cursor?.created_at??null,p_before_id:cursor?.id??null,p_limit:30}).abortSignal(this.signal())
      const [identity,result,session]=await Promise.all([this.client.rpc('comment_me').abortSignal(this.signal()),fetchPage(last),this.client.auth.getSession()])
      if(generation!==this.generation || !this.isConnected) return false
      if(identity.error) throw identity.error
      if(result.error) throw result.error
      if(session.error) throw session.error
      let page=(result.data??[]) as CommentRow[]
      const next=[...page]
      for(let index=1; index<targetPages && page.length===30; index++) {
        const moreRows=await fetchPage(page.at(-1))
        if(generation!==this.generation || !this.isConnected) return false
        if(moreRows.error) throw moreRows.error
        page=(moreRows.data??[]) as CommentRow[]
        const unseen=page.filter(row=>!next.some(old=>old.id===row.id))
        next.push(...unseen)
        if(!unseen.length) break
      }
      this.me=(Array.isArray(identity.data) ? identity.data[0] : identity.data) as CommentMe
      this.accountId=session.data.session?.user.id??null
      this.identityReady=true
      this.rows=more ? [...this.rows,...next.filter(row=>!this.rows.some(old=>old.id===row.id))] : next
      if(!this.editingProfile && this.name()) this.el<HTMLInputElement>('[name=nickname]').value=this.name()!
      this.render()
      this.el('[data-more]').hidden=page.length<30
      this.el('[data-empty]').hidden=this.rows.length>0
      this.status(this.me.banned ? this.t('此账号暂时无法发布新留言，但仍可删除自己的留言。','This account cannot post new comments, but can delete its own comments.') : '')
      return true
    } catch(error) {
      if(generation===this.generation && this.isConnected) {this.clearPermissions(); this.status(commentError(error as Error,this.en),true)}
      return false
    } finally {
      if(generation===this.generation && this.isConnected) {
        this.loading=false; this.updateControls(); this.el('[data-list]').setAttribute('aria-busy','false')
      }
    }
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string) {
    const node=document.createElement(tag)
    if(text!==undefined) node.textContent=text
    if(className) node.className=className
    return node
  }
  private initials(name:string) {
    const words=name.trim().split(/\s+/).filter(Boolean)
    return (words.length>1 ? (Array.from(words[0])[0]??'')+(Array.from(words.at(-1)!)[0]??'') : Array.from(name.trim())[0]??'').toLocaleUpperCase()
  }
  private render() {
    // The single composer must leave the old list before its children are replaced.
    const compose=this.el<HTMLFormElement>('[data-compose]')
    const focused=document.activeElement
    const focusedInput=focused===this.el('textarea') || focused===this.el('[name=nickname]') ? focused as HTMLTextAreaElement|HTMLInputElement : null
    const selection=focusedInput ? [focusedInput.selectionStart,focusedInput.selectionEnd] : null
    this.el('[data-compose-home]').append(compose)
    const list=this.el('[data-list]'); list.replaceChildren()
    const loadedIds=new Set(this.rows.map(row=>row.id))
    for(const row of this.rows) {
      const item=this.node('li',undefined,`comment-item${row.parent_id ? ' comment-item-reply' : ''}`); item.id=`comment-${row.id}`
      const avatar=this.node('span',this.initials(row.nickname),'comment-avatar'); avatar.setAttribute('aria-hidden','true')
      const header=this.node('div',undefined,'comment-item-header'); header.append(avatar,this.node('strong',row.nickname))
      if(row.is_admin_author) header.append(this.node('span',this.t('站长','Site owner'),'comment-badge'))
      if(row.is_pending) header.append(this.node('span',this.t('待审核','Pending review'),'comment-badge'))
      const time=this.node('time',new Intl.DateTimeFormat(this.en?'en':'zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.created_at)))
      time.dateTime=row.created_at; header.append(time); item.append(header)
      if(row.parent_id) {
        const context=this.node('p',undefined,'comment-context')
        const label=`${this.t('回复','Reply to')} ${row.parent_deleted ? this.t('已删除的留言','a deleted comment') : row.parent_nickname??this.t('留言','a comment')}`
        if(loadedIds.has(row.parent_id)) {const link=this.node('a',label); link.href=`#comment-${row.parent_id}`; context.append(link)}
        else context.textContent=label
        item.append(context)
      }
      item.append(this.node('p',row.deleted ? this.t('此评论已删除','This comment has been deleted.') : row.body,'comment-body'))
      const actions=this.node('div',undefined,'comment-item-actions')
      const action=(container:HTMLElement,label:string,run:()=>void)=>{
        const button=this.node('button',label); button.type='button'; button.disabled=this.busy
        button.addEventListener('click',()=>{
          if(this.busy) return
          this.querySelectorAll<HTMLDetailsElement>('.comment-menu[open]').forEach(menu=>{menu.open=false})
          run()
        },{signal:this.lifetime!.signal}); container.append(button)
      }
      if(!row.deleted && this.me.can_post) action(actions,this.t('回复','Reply'),()=>this.setReply(row,true))
      if(this.me.is_admin && row.is_pending) action(actions,this.t('审核通过','Approve'),()=>void this.mutate('comment_review',{p_id:row.id,p_approve:true}))
      if((!row.deleted && row.can_delete) || this.me.is_admin) {
        const menu=this.node('details',undefined,'comment-menu')
        const summary=this.node('summary',this.t('更多','More')); summary.setAttribute('aria-label',this.t('更多留言操作','More comment actions'))
        summary.addEventListener('click',event=>{if(this.busy) event.preventDefault()},{signal:this.lifetime!.signal})
        menu.append(summary)
        const choices=this.node('div',undefined,'comment-menu-choices')
        if(!row.deleted && row.can_delete) action(choices,this.t('删除','Delete'),()=>void this.removeComment(row,false))
        if(this.me.is_admin) {
          action(choices,this.t('清理整串','Remove thread'),()=>void this.removeComment(row,true))
          if(!row.is_admin_author) action(choices,row.author_banned ? this.t('解除封禁','Unban author') : this.t('封禁作者','Ban author'),()=>void this.ban(row))
        }
        menu.append(choices); actions.append(menu)
      }
      item.append(actions); list.append(item)
    }
    if(this.parent) {
      const current=this.rows.find(row=>row.id===this.parent!.id)
      this.replyUnavailable=!current || current.deleted || !this.me.can_post
      // Keep the target explicit until cancellation; never silently turn a reply into a root post.
      this.parent=current && !current.deleted ? current : {...this.parent,body:'',deleted:true}
    }
    this.placeComposer()
    if(selection && focusedInput && this.me.can_post && !focusedInput.disabled) {focusedInput.focus({preventScroll:true}); focusedInput.setSelectionRange(selection[0],selection[1])}
  }

  private placeComposer() {
    const compose=this.el<HTMLFormElement>('[data-compose]')
    const parentItem=this.parent && !this.replyUnavailable ? this.querySelector<HTMLElement>(`#comment-${this.parent.id}`) : null
    ;(parentItem??this.el('[data-compose-home]')).append(compose)
    compose.classList.toggle('comment-compose-reply',!!parentItem)
    this.el('[data-reply]').hidden=!this.parent
    this.el('[data-reply] span').textContent=this.replyUnavailable ? this.t('原留言已无法回复。草稿已保留，可取消回复后发布新留言。','This comment is no longer available for replies. Your draft is kept; cancel the reply to post a new comment.') : this.parent ? `${this.t('正在回复','Replying to')} ${this.parent.nickname}` : ''
    this.el('[data-reply-excerpt]').textContent=this.parent ? this.parent.body.slice(0,120) : ''
    this.el<HTMLButtonElement>('[data-compose] [data-submit]').textContent=this.parent ? this.t('发布回复','Post reply') : this.t('发布留言','Post comment')
  }
  private setReply(row:CommentRow|null,focus=false) {
    if(row && (this.busy || !this.me.can_post || row.deleted)) return
    this.parent=row; this.replyUnavailable=false; this.placeComposer(); this.updateControls()
    if(focus) {
      this.el('[data-compose]').scrollIntoView?.({block:'nearest'})
      this.el<HTMLTextAreaElement>('textarea').focus({preventScroll:true})
    }
  }
  private editProfile(editing:boolean) {
    if(this.busy || this.me.is_admin || !this.me.can_post) return
    this.editingProfile=editing
    this.el<HTMLInputElement>('[name=nickname]').value=this.name()??''
    this.updateControls()
    if(editing) this.el<HTMLInputElement>('[name=nickname]').focus()
    else this.el<HTMLButtonElement>('[data-profile-edit]').focus()
  }
  private async saveProfile() {
    if(this.busy || !this.client || !this.me.can_post || this.me.is_admin) return
    const nickname=this.el<HTMLInputElement>('[name=nickname]').value.trim()
    if(!nickname || nickname.length>40 || /[\u0000-\u001f\u007f]/.test(nickname)) {
      this.status(commentError({message:'invalid_nickname'},this.en),true); this.el<HTMLInputElement>('[name=nickname]').focus(); return
    }
    const lifetime=this.lifetime, account=this.accountVersion
    this.busy=true; this.updateControls(); this.status(this.t('正在保存昵称…','Saving nickname…'))
    try {
      const {data,error}=await this.client.rpc('comment_profile_update',{p_nickname:nickname}).abortSignal(this.signal())
      if(!this.current(lifetime,account)) return
      if(error) throw error
      this.me=(Array.isArray(data) ? data[0] : data) as CommentMe
      this.editingProfile=false; this.updateControls()
      const loaded=await this.load(false,true)
      if(!this.current(lifetime,account)) return
      this.status(loaded ? this.t('昵称已更新，之前的留言和回复也会显示新昵称。','Nickname updated, including your earlier comments and replies.') : this.t('昵称已保存，但留言列表刷新失败。请刷新查看新昵称。','Your nickname was saved, but comments could not refresh. Refresh to see the new name.'),!loaded)
    } catch(error) {if(this.current(lifetime,account)) this.status(commentError(error as Error,this.en),true)}
    finally {if(this.current(lifetime,account)) {this.busy=false; this.updateControls()}}
  }

  private async submit() {
    if(this.busy || !this.me.can_post || !this.client || this.replyUnavailable || (this.editingProfile && this.name())) return
    const lifetime=this.lifetime, account=this.accountVersion
    const body=this.el<HTMLTextAreaElement>('textarea').value.trim()
    const nickname=this.name()??this.el<HTMLInputElement>('[name=nickname]').value.trim()
    if(!body || !nickname) {this.status(this.t('请填写昵称和留言内容。','Please enter a nickname and a comment.'),true); return}
    // A profile rename does not turn a retry into a second comment.
    const fingerprint=JSON.stringify([body,this.parent?.id??null])
    if(fingerprint!==this.fingerprint || !this.requestId) {this.fingerprint=fingerprint; this.requestId=crypto.randomUUID()}
    this.busy=true; this.updateControls(); this.status(this.t('正在发布…','Posting…'))
    try {
      const {data,error}=await this.client.rpc('comment_create',{p_thread:this.dataset.thread,p_body:body,p_nickname:nickname,p_parent_id:this.parent?.id??null,p_request_id:this.requestId}).abortSignal(this.signal())
      if(!this.current(lifetime,account)) return
      if(error) throw error
      this.el<HTMLTextAreaElement>('textarea').value=''; this.el('[data-counter]').textContent='0 / 2000'
      this.requestId=null; this.setReply(null)
      const loaded=await this.load(false,true)
      if(!this.current(lifetime,account)) return
      this.status(loaded ? (data?.is_pending ? this.t('已提交，审核通过后公开。','Submitted for review.') : this.t('留言已发布。','Your comment has been posted.')) : this.t('留言已提交，但列表刷新失败。请点击刷新，无需重复提交。','Your comment was submitted, but the list could not refresh. Refresh the list; you do not need to post again.'),!loaded)
      this.el('[data-status]').scrollIntoView?.({block:'nearest'})
    } catch(error) {if(this.current(lifetime,account)) this.status(commentError(error as Error,this.en),true)}
    finally {if(this.current(lifetime,account)) {this.busy=false; this.updateControls()}}
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
    const lifetime=this.lifetime, account=this.accountVersion
    const approved=await this.confirm(branch?this.t('清理整串讨论？','Remove this entire thread?'):this.t('删除这条留言？','Delete this comment?'),branch?this.t('这条留言及其所有回复将被隐藏，正文会清空，无法恢复。','This comment and all its replies will be hidden and their content cleared. This cannot be undone.'):this.t('正文会清空并显示删除占位，其他人的回复会保留。此操作无法恢复。','The content will be cleared and replaced with a deletion notice. Other people’s replies stay. This cannot be undone.'))
    if(approved && this.current(lifetime,account)) await this.mutate('comment_delete',{p_id:row.id,p_branch:branch})
  }
  private async ban(row:CommentRow) {
    if(this.busy) return
    const lifetime=this.lifetime, account=this.accountVersion
    const approved=await this.confirm(row.author_banned?this.t('解除封禁？','Unban this author?'):this.t('封禁此作者？','Ban this author?'),row.author_banned?this.t('该账号将恢复发布权限。','This account will be allowed to post again.'):this.t('该账号将不能发布新留言；现有留言需单独处理，作者仍能删除自己的留言。','The account will be unable to post. Existing comments stay, and the author can still delete their own comments.'))
    if(approved && this.current(lifetime,account)) await this.mutate('comment_ban',{p_comment_id:row.id,p_banned:!row.author_banned})
  }
  private async moderation() {
    const wanted=this.el<HTMLInputElement>('[data-moderation]').checked
    this.el<HTMLInputElement>('[data-moderation]').checked=this.me.moderation_enabled
    await this.mutate('comment_moderation',{p_enabled:wanted})
  }
  private async mutate(name:string,args:Record<string,unknown>) {
    if(this.busy || !this.client) return
    const lifetime=this.lifetime, account=this.accountVersion
    this.busy=true; this.updateControls()
    try {
      const {error}=await this.client.rpc(name,args).abortSignal(this.signal())
      if(!this.current(lifetime,account)) return
      if(error) throw error
      const loaded=await this.load(false,true)
      if(!this.current(lifetime,account)) return
      this.status(loaded ? this.t('操作已完成。','Done.') : this.t('操作已完成，但列表刷新失败。请点击刷新查看结果。','The action succeeded, but the list could not refresh. Please refresh to see the result.'),!loaded)
    } catch(error) {if(this.current(lifetime,account)) this.status(commentError(error as Error,this.en),true)}
    finally {if(this.current(lifetime,account)) {this.busy=false; this.updateControls()}}
  }
}
if(!customElements.get('site-comments')) customElements.define('site-comments',SiteComments)

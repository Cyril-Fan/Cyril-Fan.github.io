import { getCommentClient, type CommentAuthChangeDetail } from './comment-auth'
import { commentError, groupCommentRows, type CommentRow, type CommentMe } from './comment-utils'
import { prepareCommentAvatar, commentAvatarUrl, captureAvatarAuthorization, saveCommentAvatar, removeCommentAvatar, commentAvatarMessage } from './comment-avatar'
import { renderCommentMarkdown } from './comment-markdown'

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
  private checkingUpdates = false
  private lastUpdateCheck = 0
  private identityReady = false
  private editingProfile = false
  private avatarEditorOpen = false
  private avatarDraft: Blob | null = null
  private avatarPreviewUrl: string | null = null
  private avatarOperation?: AbortController
  private avatarWorking: 'prepare' | 'save' | 'remove' | null = null
  private rows: CommentRow[] = []
  private focusedRows: CommentRow[] = []
  private authorEmails = new Map<string, string | null>()
  private emailOperation?: AbortController
  private emailGeneration = 0
  private me = guestIdentity()
  private parent: CommentRow | null = null
  private loginReply: { row: CommentRow; accountId: string | null } | null = null
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
  private displayName(name:string,isOwner=false) { return isOwner ? 'Cyril Fan' : name }
  private rowName(row:CommentRow) { return this.displayName(row.nickname,row.is_admin_author) }
  private updateCounter() {
    const input=this.el<HTMLTextAreaElement>('textarea')
    const count=Array.from(input.value).length
    this.el('[data-counter]').textContent=`${count} / 2000`
    input.setCustomValidity(count>2000 ? this.t('留言最多 2000 字。','Use at most 2,000 characters.') : '')
  }
  private get avatarOrigin() { return String(import.meta.env.PUBLIC_SUPABASE_URL??'').trim() }
  private canChangeAvatar() { return this.identityReady && this.me.can_post && !this.me.is_admin && !!this.me.nickname && !!this.me.avatar_key && !!this.accountId }
  private canRemoveAvatar() { return this.identityReady && !this.me.is_admin && (this.me.can_post || this.me.banned) && !!this.me.avatar_key && !!this.me.avatar_path && !!this.accountId }

  connectedCallback() {
    if (this.lifetime) return
    this.lifetime = new AbortController()
    this.el<HTMLElement>('[data-boot]').hidden = true
    this.el('[data-configured]').hidden = !this.client
    this.el('[data-unconfigured]').hidden = !!this.client
    if (!this.client) return
    const options = { signal:this.lifetime.signal }
    this.el('form[data-compose]').addEventListener('submit',event=>{event.preventDefault(); void this.submit()},options)
    this.el('[data-refresh]').addEventListener('click',()=>void this.load(false,true),options)
    this.el('[data-apply-update]').addEventListener('click',()=>void this.load(false,true),options)
    this.el('[data-more]').addEventListener('click',()=>void this.load(true),options)
    this.el('[data-cancel-reply]').addEventListener('click',()=>this.setReply(null,true),options)
    this.el('[data-cancel-login-reply]').addEventListener('click',()=>{
      this.loginReply=null; this.updateControls()
      const authOpen=!this.el<HTMLElement>('comment-auth [data-guest]').hidden
      this.el<HTMLElement>(authOpen ? 'comment-auth [name=email]' : '[data-sign-in]').focus()
    },options)
    this.el('[data-profile-edit]').addEventListener('click',()=>this.editProfile(true),options)
    this.el('[data-profile-cancel]').addEventListener('click',()=>this.editProfile(false),options)
    this.el('[data-profile-save]').addEventListener('click',()=>void this.saveProfile(),options)
    this.el('[data-avatar-edit]').addEventListener('click',()=>{
      if(this.busy || !this.canChangeAvatar()) return
      this.avatarEditorOpen=true; this.updateControls()
      this.el<HTMLInputElement>('[data-avatar-file]').focus()
      this.el<HTMLInputElement>('[data-avatar-file]').click()
    },options)
    this.el('[data-avatar-file]').addEventListener('change',()=>void this.chooseAvatar(),options)
    this.el('[data-avatar-cancel]').addEventListener('click',()=>{
      if(this.busy && this.avatarWorking!=='prepare') return
      if(this.avatarWorking==='prepare') this.busy=false
      this.resetAvatarEditor(); this.updateControls(); this.status('')
      this.el<HTMLButtonElement>('[data-avatar-edit]').focus()
    },options)
    this.el('[data-avatar-save]').addEventListener('click',()=>void this.saveAvatar(),options)
    this.el('[data-avatar-remove]').addEventListener('click',()=>void this.removeAvatar(),options)
    this.el('[data-sign-in]').addEventListener('click',()=>{
      this.el('comment-auth').dispatchEvent(new CustomEvent('comment-auth-open'))
    },options)
    this.el<HTMLInputElement>('[name=nickname]').addEventListener('keydown',event=>{
      if(event.isComposing || event.keyCode===229) return
      if(event.key==='Enter') { event.preventDefault(); void this.saveProfile() }
      if(event.key==='Escape' && this.name()) { event.preventDefault(); this.editProfile(false) }
    },options)
    const textarea=this.el<HTMLTextAreaElement>('textarea')
    textarea.addEventListener('input',()=>this.updateCounter(),options)
    this.el('[data-markdown-write]').addEventListener('click',()=>this.setPreview(false,true),options)
    this.el('[data-markdown-preview-toggle]').addEventListener('click',()=>this.setPreview(true,true),options)
    textarea.addEventListener('invalid',()=>this.setPreview(false),options)
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
          if(this.current(lifetime,account)) this.authChanged(error ? null : data.session?.user.id??null,!error)
        }).catch(()=>{
          if(this.current(lifetime,account)) this.authChanged(null,false)
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
    const updateTimer=window.setInterval(()=>void this.checkForUpdates(),60000)
    this.lifetime.signal.addEventListener('abort',()=>window.clearInterval(updateTimer),{once:true})
    document.addEventListener('visibilitychange',()=>void this.checkForUpdates(),options)
  }

  disconnectedCallback() {
    this.clearAuthorEmails()
    this.resetAvatarEditor()
    this.lifetime?.abort(); this.lifetime=undefined; this.generation++; this.accountVersion++
    this.busy=false; this.loading=false; this.loginReply=null
    this.pendingConfirmation?.(false); this.pendingConfirmation=null
    this.el<HTMLDialogElement>('dialog')?.close()
  }

  private authChanged(userId:string|null,confirmed=true) {
    if(confirmed && userId===this.accountId) {
      // SDK SIGNED_IN can also mean a refocused tab; TOKEN_REFRESHED is not an account switch.
      if(!this.busy && !this.loading) void this.load(false,true)
      return
    }
    // A guest reply intent may follow the first sign-in, but never an existing
    // member switching accounts or signing out midway through that sign-in.
    if(this.loginReply) {
      if(confirmed && this.accountId===null && userId && this.loginReply.accountId===null) this.loginReply.accountId=userId
      else this.loginReply=null
    }
    if(confirmed) {
      if(this.accountId) {
        this.el<HTMLTextAreaElement>('textarea').value=''
        this.updateCounter()
      }
      this.accountId=userId
    }
    // A failed session read is not proof of logout. Retain the last known
    // account ID so a later confirmed switch still clears its private draft.
    this.setPreview(false)
    this.resetAvatarEditor()
    this.accountLifetime.abort(); this.accountLifetime=new AbortController(); this.accountVersion++
    this.busy=false; this.editingProfile=false; this.requestId=null; this.fingerprint=''
    this.el<HTMLInputElement>('[name=nickname]').value=''
    this.pendingConfirmation?.(false); this.pendingConfirmation=null
    this.el<HTMLDialogElement>('dialog').close()
    this.clearPermissions(); this.setReply(null); void this.load(false,!!this.loginReply)
  }

  private updateControls() {
    const name=this.name()
    const showEditor=this.me.can_post && !this.me.is_admin && (!name || this.editingProfile)
    const nickname=this.el<HTMLInputElement>('[name=nickname]')
    this.el<HTMLElement>('[data-compose]').hidden=!this.me.can_post
    this.el('[data-login-prompt]').hidden=!this.identityReady || !!this.accountId || this.me.can_post || this.me.banned
    this.el('[data-login-reply]').hidden=!this.loginReply
    this.el('[data-login-reply-label]').textContent=this.loginReply ? this.t(`登录后回复 ${this.rowName(this.loginReply.row)}`,`Sign in to reply to ${this.rowName(this.loginReply.row)}`) : ''
    const identity=this.el('[data-identity]')
    const identityHome=this.me.can_post ? this.el('[data-compose]') : this.el('[data-identity-home]')
    if(identity.parentElement!==identityHome) identityHome.prepend(identity)
    identity.hidden=!name && !this.me.banned
    this.el('[data-identity-name]').textContent=name ? this.displayName(name,this.me.is_admin) : (this.me.banned ? this.t('当前账户','Current account') : '')
    this.renderAvatar(this.el('[data-identity-avatar]'),name ? this.displayName(name,this.me.is_admin) : '',this.me.is_admin,this.me.avatar_path)
    this.el('[data-owner-badge]').hidden=!this.me.is_admin
    this.el('[data-restricted-badge]').hidden=!this.me.banned
    this.el('[data-profile-edit]').hidden=!this.me.can_post || this.me.is_admin || this.editingProfile
    this.el('[data-avatar-edit]').hidden=!this.canChangeAvatar() || this.avatarEditorOpen
    this.el('[data-avatar-edit]').textContent=this.me.avatar_path ? this.t('修改头像','Change avatar') : this.t('设置头像','Set avatar')
    this.el('[data-avatar-remove]').hidden=!this.canRemoveAvatar() || this.avatarEditorOpen
    this.el('[data-avatar-editor]').hidden=!this.canChangeAvatar() || !this.avatarEditorOpen
    this.el('[data-avatar-preview]').hidden=!this.avatarDraft
    this.el<HTMLButtonElement>('[data-avatar-save]').disabled=this.busy || !this.avatarDraft || !this.canChangeAvatar()
    this.el<HTMLButtonElement>('[data-avatar-cancel]').disabled=this.busy && this.avatarWorking!=='prepare'
    this.el<HTMLInputElement>('[data-avatar-file]').disabled=this.busy
    this.querySelectorAll<HTMLButtonElement>('[data-avatar-edit], [data-avatar-remove]').forEach(button=>{button.disabled=this.busy})
    this.el('[data-moderation-note]').hidden=!this.me.can_post || !(this.parent?.is_pending || (this.me.moderation_enabled && !this.me.is_admin))
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
    this.querySelectorAll<HTMLButtonElement>('[data-markdown-write], [data-markdown-preview-toggle]').forEach(button=>{button.disabled=this.busy})
    this.el('[data-admin]').hidden=!this.me.is_admin
    this.el<HTMLInputElement>('[data-moderation]').checked=this.me.moderation_enabled
    this.el<HTMLInputElement>('[data-moderation]').disabled=this.busy
    this.el<HTMLButtonElement>('[data-cancel-reply]').disabled=this.busy
    this.querySelectorAll<HTMLButtonElement>('[data-list] .comment-item-actions button').forEach(button=>{button.disabled=this.busy})
    this.querySelectorAll<HTMLButtonElement>('[data-list] .comment-thread-gap button').forEach(button=>{button.disabled=this.busy || this.loading})
    this.el<HTMLButtonElement>('[data-refresh]').disabled=this.loading || this.busy
    this.el<HTMLButtonElement>('[data-apply-update]').disabled=this.loading || this.busy
    this.el<HTMLButtonElement>('[data-more]').disabled=this.loading || this.busy
    ;(this.me.can_post ? this.el('[data-compose]') : this.el('[data-status-home]')).append(this.el('[data-status]'))
  }

  private clearPermissions() {
    this.el('[data-update-note]').hidden=true
    this.clearAuthorEmails()
    this.focusedRows=[]
    this.resetAvatarEditor()
    this.me=guestIdentity(); this.identityReady=false
    this.rows=this.rows.filter(row=>!row.is_pending).map(row=>({...row,can_delete:false,author_banned:null}))
    this.render(); this.updateControls()
  }

  private async load(more=false,preservePages=false,minimumPages=1): Promise<boolean> {
    if (!this.client || !this.lifetime) return false
    this.clearAuthorEmails()
    if(!more) this.focusedRows=[]
    const generation=++this.generation
    const targetPages=Math.max(minimumPages,preservePages ? Math.max(1,Math.ceil(this.rows.length/30)) : 1)
    const last=more ? this.rows.at(-1) : null
    this.loading=true; this.updateControls()
    this.el('[data-list]').setAttribute('aria-busy','true')
    this.el('[data-empty]').hidden=true
    if(!this.rows.length) this.status(this.t('正在加载留言…','Loading comments…'))
    try {
      const fetchPage=(cursor?:CommentRow|null)=>this.client!.rpc('comment_thread_list',{p_thread:this.dataset.thread,p_after_id:cursor?.id??null,p_limit:30}).abortSignal(this.signal())
      const [identity,result,session]=await Promise.all([this.client.rpc('comment_me').abortSignal(this.signal()),fetchPage(last),this.client.auth.getSession()])
      if(generation!==this.generation || !this.isConnected) return false
      if(identity.error) throw identity.error
      if(more && result.error?.message==='invalid_cursor') return await this.load(false,true)
      if(result.error) throw result.error
      if(session.error) throw session.error
      const nextMe=(Array.isArray(identity.data) ? identity.data[0] : identity.data) as CommentMe
      const nextAccountId=session.data.session?.user.id??null
      if(this.accountId!==undefined && nextAccountId!==this.accountId) {
        // Session storage can change without an SDK event. Drop private rows and
        // old-account actions before accepting any page from the next account.
        this.authChanged(nextAccountId)
        return false
      }
      if(more && (nextMe.is_admin!==this.me.is_admin || nextMe.can_post!==this.me.can_post || nextMe.banned!==this.me.banned)) {
        const pagesToReload=Math.max(1,Math.ceil(this.rows.length/30))+1
        // Every displayed row carries server-derived permissions. A role change
        // requires refreshed earlier pages, not just a new page appended to them.
        this.clearPermissions()
        return await this.load(false,true,pagesToReload)
      }
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
      this.me=nextMe
      this.accountId=nextAccountId
      this.identityReady=true
      if(!this.canChangeAvatar()) this.resetAvatarEditor()
      this.rows=more ? [...this.rows,...next.filter(row=>!this.rows.some(old=>old.id===row.id))] : next
      if(!more) {this.el('[data-update-note]').hidden=true; this.lastUpdateCheck=Date.now()}
      this.focusedRows=this.focusedRows.filter(row=>!this.rows.some(loaded=>loaded.id===row.id))
      const resumeReply=this.loginReply && this.me.can_post && this.accountId && (this.loginReply.accountId===null || this.loginReply.accountId===this.accountId)
      if(resumeReply) {this.parent=this.loginReply!.row; this.loginReply=null}
      if(this.me.banned) this.loginReply=null
      if(!this.editingProfile && this.name()) this.el<HTMLInputElement>('[name=nickname]').value=this.name()!
      this.render()
      this.el('[data-more]').hidden=page.length<30
      this.el('[data-empty]').hidden=this.rows.length>0
      this.status(this.me.banned ? this.t('此账号暂时无法发布新留言，但仍可删除自己的留言。','This account cannot post new comments, but can delete its own comments.') : '')
      if(resumeReply) {this.updateControls(); this.el('[data-compose]').scrollIntoView?.({block:'nearest'}); this.el<HTMLTextAreaElement>('textarea').focus({preventScroll:true})}
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

  /** A read-only freshness hint: never rerender a conversation under a reader,
   * close a menu, move a reply editor, or replace a draft automatically. */
  private async checkForUpdates() {
    if(!this.client || !this.lifetime || document.hidden || this.busy || this.loading || this.checkingUpdates || !this.identityReady || Date.now()-this.lastUpdateCheck<60000) return
    const bounds=this.getBoundingClientRect()
    if(bounds.bottom<0 || bounds.top>window.innerHeight) return
    this.checkingUpdates=true; this.lastUpdateCheck=Date.now()
    const lifetime=this.lifetime, account=this.accountVersion, generation=this.generation
    try {
      const {data,error}=await this.client.rpc('comment_thread_list',{p_thread:this.dataset.thread,p_after_id:null,p_limit:30}).abortSignal(this.signal())
      if(!this.current(lifetime,account) || generation!==this.generation || error || !Array.isArray(data)) return
      if(JSON.stringify(data)!==JSON.stringify(this.rows.slice(0,30))) this.el('[data-update-note]').hidden=false
    } catch { /* Keep existing comments and private drafts usable while offline. */ }
    finally {this.checkingUpdates=false}
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
  private renderAvatar(container:HTMLElement,name:string,isOwner:boolean,path?:string|null) {
    const source=isOwner ? '/avatar/avatar.png' : commentAvatarUrl(this.avatarOrigin,path)
    if(container.dataset.avatarName===name && container.dataset.avatarSource===(source??'')) return
    container.dataset.avatarName=name; container.dataset.avatarSource=source??''
    container.textContent=this.initials(name)
    if(!source) return
    const avatar=this.node('img')
    avatar.alt=''; avatar.width=32; avatar.height=32; avatar.loading='lazy'; avatar.decoding='async'
    avatar.addEventListener('error',()=>avatar.remove(),{once:true})
    avatar.referrerPolicy='no-referrer'; avatar.src=source; container.append(avatar)
  }
  private render() {
    // The single composer must leave the old list before its children are replaced.
    const compose=this.el<HTMLFormElement>('[data-compose]')
    const focused=document.activeElement
    const focusedInput=focused===this.el('textarea') || focused===this.el('[name=nickname]') ? focused as HTMLTextAreaElement|HTMLInputElement : null
    const selection=focusedInput ? [focusedInput.selectionStart,focusedInput.selectionEnd] : null
    this.el('[data-compose-home]').append(compose)
    const list=this.el('[data-list]'); list.replaceChildren()
    const displayedRows=[...this.rows,...this.focusedRows]
    const loadedIds=new Set(displayedRows.map(row=>row.id))
    for(const group of groupCommentRows(displayedRows)) {
      const thread=this.node('li',undefined,'comment-thread')
      thread.dataset.threadRoot=group.id
      const replies=this.node('ol',undefined,'comment-thread-replies')
      if(!group.root) thread.append(this.node('p',this.t('原留言暂不可见','The original comment is unavailable.'),'comment-unavailable'))
      for(const row of [...(group.root ? [group.root] : []),...group.replies]) {
        const isRoot=row===group.root
        const item=isRoot ? thread : this.node('li')
        item.classList.add('comment-item'); if(!isRoot) item.classList.add('comment-item-reply')
        item.id=`comment-${row.id}`
        const avatar=this.node('span',undefined,'comment-avatar'); avatar.setAttribute('aria-hidden','true')
        const displayName=this.rowName(row)
        this.renderAvatar(avatar,displayName,row.is_admin_author,row.avatar_path)
        const header=this.node('div',undefined,'comment-item-header'); header.append(avatar,this.node('strong',displayName))
        if(row.is_admin_author) header.append(this.node('span',this.t('站长','Site owner'),'comment-badge'))
        if(row.is_pending) header.append(this.node('span',this.t('待审核','Pending review'),'comment-badge'))
        const time=this.node('time',new Intl.DateTimeFormat(this.en?'en':'zh-CN',{dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(row.created_at)))
        time.dateTime=row.created_at; header.append(time); item.append(header)
        if(row.parent_id) {
          const context=this.node('p',undefined,'comment-context')
          const loadedParent=displayedRows.find(parent=>parent.id===row.parent_id)
          const label=`${this.t('回复','Reply to')} ${row.parent_deleted ? this.t('已删除的留言','a deleted comment') : loadedParent ? this.rowName(loadedParent) : row.parent_nickname??this.t('留言','a comment')}`
          if(loadedIds.has(row.parent_id)) {const link=this.node('a',label); link.href=`#comment-${row.parent_id}`; context.append(link)}
          else context.textContent=label
          item.append(context)
        }
        const body=this.node('div',undefined,'comment-body comment-markdown')
        if(row.deleted) body.textContent=this.t('此评论已删除','This comment has been deleted.')
        else renderCommentMarkdown(body,row.body,this.en,row.id)
        item.append(body)
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
        else if(!row.deleted && this.identityReady && !this.me.banned && !this.accountId) action(actions,this.t('登录后回复','Sign in to reply'),()=>{
          this.loginReply={row,accountId:null}; this.updateControls()
          this.el('comment-auth').dispatchEvent(new CustomEvent('comment-auth-open'))
        })
        if(this.me.is_admin && row.is_pending) action(actions,this.t('审核通过','Approve'),()=>void this.mutate('comment_review',{p_id:row.id,p_approve:true}))
        if((!row.deleted && row.can_delete) || this.me.is_admin) {
          const menu=this.node('details',undefined,'comment-menu')
          const summary=this.node('summary',this.t('更多','More')); summary.setAttribute('aria-label',this.t(`${displayName} 的留言：更多操作`,`More actions for ${displayName}’s comment`))
          summary.addEventListener('click',event=>{if(this.busy) event.preventDefault()},{signal:this.lifetime!.signal})
          menu.append(summary)
          const choices=this.node('div',undefined,'comment-menu-choices')
          if(!row.deleted && row.can_delete) action(choices,this.t('删除','Delete'),()=>void this.removeComment(row,false))
          if(this.me.is_admin) {
            const emailVisible=this.authorEmails.has(row.id)
            action(choices,emailVisible ? this.t('隐藏作者邮箱','Hide author email') : this.t('查看作者邮箱','View author email'),()=>{
              if(this.authorEmails.has(row.id)) this.hideAuthorEmail(row)
              else void this.showAuthorEmail(row)
            })
            action(choices,row.parent_id || row.root_unavailable ? this.t('清理此条及其回复','Remove comment and replies') : this.t('清理整串','Remove thread'),()=>void this.removeComment(row,true))
            if(!row.is_admin_author) action(choices,row.author_banned ? this.t('解除封禁','Unban author') : this.t('封禁作者','Ban author'),()=>void this.ban(row))
          }
          menu.append(choices); actions.append(menu)
        }
        item.append(actions)
        if(this.me.is_admin && this.authorEmails.has(row.id)) {
          const address=this.authorEmails.get(row.id)
          const email=this.node('p',address ? this.t('作者邮箱（仅站长可见）：','Author email (owner only): ')+address : this.t('此作者账户已不可用','This author account is unavailable.'),'comment-author-email')
          email.dataset.authorEmail=''; email.setAttribute('aria-label',this.t('作者邮箱，仅站长可见','Author email, visible only to the site owner'))
          email.setAttribute('role','status')
          action(email,this.t('隐藏作者邮箱','Hide author email'),()=>this.hideAuthorEmail(row))
          item.append(email)
        }
        if(!isRoot) {
          if(row.gap_before) {
            const gap=this.node('li',undefined,'comment-thread-gap')
            gap.append(this.node('p',this.t('已定位刚发布的回复，中间还有回复尚未加载。','Your posted reply is shown below; earlier replies still need to load.')))
            action(gap,this.t('加载中间回复','Load earlier replies'),()=>void this.load(true))
            replies.append(gap)
          }
          replies.append(item)
        }
      }
      if(replies.children.length) thread.append(replies)
      list.append(thread)
    }
    if(this.parent) {
      const current=displayedRows.find(row=>row.id===this.parent!.id)
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
    if(parentItem) parentItem.insertBefore(compose,parentItem.querySelector(':scope > .comment-thread-replies'))
    else this.el('[data-compose-home]').append(compose)
    compose.classList.toggle('comment-compose-reply',!!parentItem)
    this.el('[data-reply]').hidden=!this.parent
    this.el('[data-reply] span').textContent=this.replyUnavailable ? this.t('原留言已无法回复。草稿已保留，可取消回复后发布新留言。','This comment is no longer available for replies. Your draft is kept; cancel the reply to post a new comment.') : this.parent ? `${this.t('正在回复','Replying to')} ${this.rowName(this.parent)}` : ''
    this.el('[data-reply-excerpt]').textContent=this.parent ? this.parent.body.slice(0,120) : ''
    this.el<HTMLButtonElement>('[data-compose] [data-submit]').textContent=this.parent ? this.t('发布回复','Post reply') : this.t('发布留言','Post comment')
  }
  private clearAuthorEmails() {
    this.emailGeneration++; this.emailOperation?.abort(); this.emailOperation=undefined
    this.authorEmails.clear()
    this.querySelectorAll('[data-author-email]').forEach(node=>node.remove())
  }
  private hideAuthorEmail(row:CommentRow) {
    this.authorEmails.delete(row.id)
    this.render()
    this.querySelector<HTMLElement>(`#comment-${row.id} .comment-menu summary`)?.focus({preventScroll:true})
  }
  private async locatePostedComment(id:string,lifetime:AbortController|undefined,account:number) {
    if(!this.client || !this.current(lifetime,account)) return false
    const accountId=this.accountId
    try {
      const {data,error}=await this.client.rpc('comment_thread_list',{
        p_thread:this.dataset.thread,p_after_id:this.rows.at(-1)?.id??null,p_limit:30,p_focus_id:id
      }).abortSignal(this.signal())
      if(!this.current(lifetime,account)) return false
      if(error) throw error
      const session=await this.client.auth.getSession()
      if(!this.current(lifetime,account)) return false
      if(session.error) throw session.error
      const nextId=session.data.session?.user.id??null
      if(nextId!==accountId) {this.authChanged(nextId); return false}
      const rows=(data??[]) as CommentRow[]
      if(!rows.some(row=>row.id===id)) return false
      this.focusedRows=rows.filter(row=>!this.rows.some(loaded=>loaded.id===row.id))
      this.render(); this.el('[data-empty]').hidden=true
      return true
    } catch {return false}
  }
  private async showAuthorEmail(row:CommentRow) {
    if(!this.client || !this.identityReady || !this.me.is_admin || this.busy || this.loading) return
    this.emailOperation?.abort()
    const operation=new AbortController(), generation=++this.emailGeneration
    this.emailOperation=operation
    const lifetime=this.lifetime, account=this.accountVersion, accountId=this.accountId
    const current=()=>this.current(lifetime,account) && generation===this.emailGeneration && this.me.is_admin
    this.status(this.t('正在读取作者邮箱…','Loading author email…'))
    try {
      const {data,error}=await this.client.rpc('comment_author_email',{p_thread:this.dataset.thread,p_comment_id:row.id})
        .abortSignal(AbortSignal.any([this.signal(),operation.signal]))
      if(!current()) return
      if(error) throw error
      const session=await this.client.auth.getSession()
      if(!current()) return
      if(session.error) throw session.error
      const nextId=session.data.session?.user.id??null
      if(nextId!==accountId) {this.authChanged(nextId); return}
      this.authorEmails.set(row.id,typeof data==='string' ? data : null)
      this.render(); this.status('')
    } catch(error) {
      if(!current()) return
      this.clearPermissions()
      this.status(commentError(error as Error,this.en),true)
    } finally {if(generation===this.emailGeneration) this.emailOperation=undefined}
  }
  private setReply(row:CommentRow|null,focus=false) {
    if(row && (this.busy || !this.me.can_post || row.deleted)) return
    this.parent=row; this.replyUnavailable=false; this.placeComposer(); this.updateControls()
    if(focus) {
      this.setPreview(false)
      this.el('[data-compose]').scrollIntoView?.({block:'nearest'})
      this.el<HTMLTextAreaElement>('textarea').focus({preventScroll:true})
    }
  }
  private setPreview(preview:boolean,focus=false) {
    this.el('[data-comment-input]').hidden=preview
    const output=this.el('[data-markdown-preview]')
    output.hidden=!preview
    this.el('[data-markdown-write]').setAttribute('aria-pressed',String(!preview))
    this.el('[data-markdown-preview-toggle]').setAttribute('aria-pressed',String(preview))
    if(preview) {
      const body=this.el<HTMLTextAreaElement>('textarea').value
      if(body.trim()) renderCommentMarkdown(output,body,this.en,'preview')
      else output.textContent=this.t('写点内容，就能在这里预览排版。','Write something to preview its formatting here.')
    } else output.replaceChildren()
    if(focus) (preview ? output : this.el<HTMLTextAreaElement>('textarea')).focus({preventScroll:true})
  }
  private editProfile(editing:boolean) {
    if(this.busy || this.me.is_admin || !this.me.can_post) return
    this.editingProfile=editing
    this.el<HTMLInputElement>('[name=nickname]').value=this.name()??''
    this.updateControls()
    if(editing) this.el<HTMLInputElement>('[name=nickname]').focus()
    else this.el<HTMLButtonElement>('[data-profile-edit]').focus()
  }
  private resetAvatarEditor(keepFileInput=false) {
    this.avatarOperation?.abort(); this.avatarOperation=undefined
    if(this.avatarWorking) this.busy=false
    this.avatarWorking=null; this.avatarEditorOpen=false; this.avatarDraft=null
    if(this.avatarPreviewUrl) URL.revokeObjectURL(this.avatarPreviewUrl)
    this.avatarPreviewUrl=null
    this.el<HTMLImageElement>('[data-avatar-preview-image]')?.removeAttribute('src')
    const input=this.el<HTMLInputElement>('[data-avatar-file]')
    if(input && !keepFileInput) input.value=''
  }
  private async chooseAvatar() {
    if(this.busy || !this.canChangeAvatar()) return
    const file=this.el<HTMLInputElement>('[data-avatar-file]').files?.[0]
    if(!file) return
    const lifetime=this.lifetime, account=this.accountVersion
    this.resetAvatarEditor(true); this.avatarEditorOpen=true
    const operation=new AbortController(); this.avatarOperation=operation
    this.avatarWorking='prepare'; this.busy=true; this.updateControls()
    this.status(this.t('正在处理头像，仅在本机预览…','Preparing your avatar for a local preview…'))
    try {
      const jpeg=await prepareCommentAvatar(file,{signal:AbortSignal.any([this.signal(),operation.signal])})
      if(!this.current(lifetime,account) || this.avatarOperation!==operation) return
      this.avatarDraft=jpeg; this.avatarPreviewUrl=URL.createObjectURL(jpeg)
      this.el<HTMLImageElement>('[data-avatar-preview-image]').src=this.avatarPreviewUrl
      this.status(this.t('预览已准备好。点击“保存头像”后才会上传并公开显示。','Preview ready. Choose “Save avatar” to upload and publish it.'))
    } catch(error) {
      if(this.current(lifetime,account) && this.avatarOperation===operation) this.status(commentAvatarMessage(error,this.en),true)
    } finally {
      if(this.current(lifetime,account) && this.avatarOperation===operation) {
        this.avatarOperation=undefined; this.avatarWorking=null; this.busy=false; this.updateControls()
        if(this.avatarDraft) this.el<HTMLButtonElement>('[data-avatar-save]').focus()
      }
    }
  }
  private async avatarAuthorization(signal:AbortSignal) {
    return captureAvatarAuthorization(this.client!,{accountId:this.accountId!,avatarKey:this.me.avatar_key!},this.avatarOrigin,String(import.meta.env.PUBLIC_SUPABASE_ANON_KEY??'').trim(),signal)
  }
  private async saveAvatar() {
    if(this.busy || !this.canChangeAvatar() || !this.avatarDraft) return
    const lifetime=this.lifetime, account=this.accountVersion, jpeg=this.avatarDraft
    const operation=new AbortController(); this.avatarOperation=operation
    this.avatarWorking='save'; this.busy=true; this.updateControls(); this.status(this.t('正在保存头像…','Saving avatar…'))
    try {
      const signal=AbortSignal.any([this.signal(),operation.signal])
      const auth=await this.avatarAuthorization(signal)
      if(!this.current(lifetime,account) || this.avatarOperation!==operation) return
      await saveCommentAvatar(auth,jpeg,{signal})
      if(!this.current(lifetime,account) || this.avatarOperation!==operation) return
      // The uploaded object is acknowledged. A later list failure must not invite
      // another upload, and all already loaded pages should show the new avatar.
      this.resetAvatarEditor(); this.busy=true
      const loaded=await this.load(false,true)
      if(!this.current(lifetime,account)) return
      this.status(loaded ? this.t('头像已更新，之前的留言也会显示新头像。','Avatar updated, including your earlier comments.') : this.t('头像已保存，但留言列表刷新失败。请点击刷新查看。','Your avatar was saved, but comments could not refresh. Please refresh the list.'),!loaded)
    } catch(error) {
      if(this.current(lifetime,account) && this.avatarOperation===operation) this.status(commentAvatarMessage(error,this.en),true)
    } finally {
      if(this.current(lifetime,account) && (this.avatarOperation===operation || !this.avatarOperation)) {
        this.avatarOperation=undefined; this.avatarWorking=null; this.busy=false; this.updateControls()
      }
    }
  }
  private async removeAvatar() {
    if(this.busy || !this.canRemoveAvatar()) return
    const lifetime=this.lifetime, account=this.accountVersion
    const approved=await this.confirm(this.t('移除公开头像？','Remove your public avatar?'),this.t('所有留言将恢复默认头像。浏览器缓存中的旧图可能短暂保留，之后可以重新上传。','All your comments will return to the default avatar. Previously cached images may remain briefly; you can upload another later.'))
    if(!approved || !this.current(lifetime,account) || !this.canRemoveAvatar()) return
    const operation=new AbortController(); this.avatarOperation=operation
    this.avatarWorking='remove'; this.busy=true; this.updateControls(); this.status(this.t('正在移除头像…','Removing avatar…'))
    try {
      const signal=AbortSignal.any([this.signal(),operation.signal])
      const auth=await this.avatarAuthorization(signal)
      if(!this.current(lifetime,account) || this.avatarOperation!==operation) return
      await removeCommentAvatar(auth,{signal})
      if(!this.current(lifetime,account) || this.avatarOperation!==operation) return
      const loaded=await this.load(false,true)
      if(!this.current(lifetime,account)) return
      // Storage DELETE may return 200 with [] if RLS filters the object out.
      // Never report a deletion while the server profile still exposes that image.
      const removed=loaded && !this.me.avatar_path
      this.status(removed ? this.t('头像已移除，留言恢复默认头像。','Avatar removed. Your comments now use the default avatar.') : loaded ? this.t('头像仍未移除，请刷新确认账户权限后重试。','The avatar is still present. Refresh to check account permissions and retry.') : this.t('已请求移除头像，但暂时无法确认结果。请刷新查看。','Avatar removal was requested, but the result could not be confirmed. Please refresh to check.'),!removed)
    } catch(error) {
      if(this.current(lifetime,account) && this.avatarOperation===operation) this.status(commentAvatarMessage(error,this.en),true)
    } finally {
      if(this.current(lifetime,account) && (this.avatarOperation===operation || !this.avatarOperation)) {
        this.avatarOperation=undefined; this.avatarWorking=null; this.busy=false; this.updateControls()
      }
    }
  }
  private async saveProfile() {
    if(this.busy || !this.client || !this.me.can_post || this.me.is_admin) return
    const nickname=this.el<HTMLInputElement>('[name=nickname]').value.trim()
    if(!nickname || nickname.length>40 || Array.from(nickname).some(character=>character.charCodeAt(0)<32 || character.charCodeAt(0)===127)) {
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
    if(Array.from(body).length>2000) {this.setPreview(false); this.status(this.t('留言最多 2000 字，草稿已保留，请精简后再发布。','Comments can contain at most 2,000 characters. Your draft is kept; shorten it before posting.'),true); return}
    // A profile rename does not turn a retry into a second comment.
    const fingerprint=JSON.stringify([body,this.parent?.id??null])
    if(fingerprint!==this.fingerprint || !this.requestId) {this.fingerprint=fingerprint; this.requestId=crypto.randomUUID()}
    this.busy=true; this.updateControls(); this.status(this.t('正在发布…','Posting…'))
    try {
      const {data,error}=await this.client.rpc('comment_create',{p_thread:this.dataset.thread,p_body:body,p_nickname:nickname,p_parent_id:this.parent?.id??null,p_request_id:this.requestId}).abortSignal(this.signal())
      if(!this.current(lifetime,account)) return
      if(error) throw error
      this.el<HTMLTextAreaElement>('textarea').value=''; this.updateCounter()
      this.setPreview(false)
      this.requestId=null; this.setReply(null)
      const loaded=await this.load(false,true)
      if(!this.current(lifetime,account)) return
      const shown=loaded && (this.rows.some(row=>row.id===data?.id) || (typeof data?.id==='string' && await this.locatePostedComment(data.id,lifetime,account)))
      if(!this.current(lifetime,account)) return
      this.status(!loaded ? this.t('留言已提交，但列表刷新失败。请点击刷新，无需重复提交。','Your comment was submitted, but the list could not refresh. Refresh the list; you do not need to post again.')
        : !shown ? this.t('留言已提交，但暂时无法定位。请刷新或继续加载查看，无需重复提交。','Your comment was submitted, but could not be located yet. Refresh or load more to view it; do not submit it again.')
        : data?.is_pending ? this.t('已提交，审核通过后公开。','Submitted for review.') : this.t('留言已发布。','Your comment has been posted.'),!loaded || !shown)
      ;(shown ? this.querySelector(`#comment-${data.id}`) : this.el('[data-status]'))?.scrollIntoView?.({block:'nearest'})
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
    const branchTitle=row.parent_id || row.root_unavailable ? this.t('清理这条留言及其回复？','Remove this comment and its replies?') : this.t('清理整串讨论？','Remove this entire thread?')
    const approved=await this.confirm(branch?branchTitle:this.t('删除这条留言？','Delete this comment?'),branch?this.t('这条留言及其所有回复将被隐藏，正文会清空，无法恢复。','This comment and all its replies will be hidden and their content cleared. This cannot be undone.'):this.t('正文会清空并显示删除占位，其他人的回复会保留。此操作无法恢复。','The content will be cleared and replaced with a deletion notice. Other people’s replies stay. This cannot be undone.'))
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

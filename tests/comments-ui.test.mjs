/**
 * Real DOM regression tests for the nested Comment / CommentAuth templates.
 * Run with npm test after npm ci. COMMENTS_UI_JSDOM can override the jsdom module
 * for isolated tooling. The Supabase transport is the mocked boundary.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { parse } from '@astrojs/compiler'
import ts from 'typescript'

const { JSDOM } = await import(process.env.COMMENTS_UI_JSDOM
  ? pathToFileURL(path.resolve(process.env.COMMENTS_UI_JSDOM)).href
  : 'jsdom')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const commentSource = read('src/components/advanced/Comment.astro')
const authSource = read('src/components/advanced/CommentAuth.astro')
const commentAst = (await parse(commentSource)).ast.children.find((node) => node.name === 'site-comments')
const authAst = (await parse(authSource)).ast.children.find((node) => node.name === 'comment-auth')
assert.ok(commentAst && authAst, 'Both real component templates must be present')

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char])
const evaluate = (expression, context) => Function(...Object.keys(context), `return (${expression})`)(...Object.values(context))
const voidElements = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track'])

// Render actual compiler AST nodes, preserving every selector, disabled fieldset,
// and nested component. This is not a handwritten approximation of the UI.
function renderTemplate(node, context) {
  if (node.type === 'text') return node.value
  if (node.type === 'comment') return ''
  if (node.type === 'expression') {
    assert.ok(node.children.every((child) => child.type === 'text'), 'Update renderer for new non-text template expressions')
    return escapeHtml(evaluate(node.children.map((child) => child.value).join(''), context))
  }
  if (node.name === 'CommentAuth') return renderTemplate(authAst, context)
  assert.ok(node.type === 'element' || node.type === 'custom-element', `Unsupported template node: ${node.type}`)
  const attrs = node.attributes.map((attr) => {
    assert.equal(attr.type, 'attribute')
    if (attr.kind === 'empty') return ` ${attr.name}`
    let value = attr.kind === 'expression' ? evaluate(attr.value, context) : attr.value
    let name = attr.name
    if (name === 'class:list') { name = 'class'; value = value.filter(Boolean).join(' ') }
    if (value == null || value === false) return ''
    return ` ${name}="${escapeHtml(value)}"`
  }).join('')
  const opening = `<${node.name}${attrs}>`
  return voidElements.has(node.name) ? opening : `${opening}${node.children.map((child) => renderTemplate(child, context)).join('')}</${node.name}>`
}

const guest = () => ({ nickname: null, can_post: false, is_admin: false, banned: false, moderation_enabled: false })
const member = (extra = {}) => ({ ...guest(), nickname: 'Reader', can_post: true, ...extra })
const row = (number, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  parent_id: null, nickname: `Reader ${number}`, body: `Comment ${number}`,
  created_at: new Date(Date.UTC(2026, 9, 19, 12) - number * 1000).toISOString(),
  deleted: false, can_delete: false, is_admin_author: false, is_pending: false,
  parent_nickname: null, parent_deleted: false, author_banned: null, ...extra
})
const ok = (data) => ({ data, error: null })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve()
  await new Promise(setImmediate)
}
async function until(condition, description) {
  for (let index = 0; index < 100; index++) {
    if (condition()) return
    await flush()
  }
  assert.fail(`Timed out: ${description}`)
}

async function setup(context, language, { identity = guest(), rows = [], configured = true, initialSessionBeforeComments = false } = {}) {
  const scope = { en: language === 'en', lang: language, id: 'comment-auth', thread: '/blog/dom-regression', Astro: { props: {} } }
  const dom = new JSDOM(`<!doctype html><html lang="${language}"><body>${renderTemplate(commentAst, scope)}</body></html>`, {
    url: `https://cyril-fan.top/${language === 'en' ? 'en/' : ''}blog/dom-regression`, runScripts: 'outside-only'
  })
  context.after(() => dom.window.close())
  const { window } = dom
  // jsdom lacks these browser APIs. Keep the platform semantics; application
  // event handlers, selectors, lifecycle, and DOM nodes remain real.
  window.AbortSignal.any ??= (signals) => {
    const controller = new window.AbortController()
    for (const signal of signals) {
      if (signal.aborted) { controller.abort(signal.reason); break }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
    }
    return controller.signal
  }
  window.AbortSignal.timeout ??= (milliseconds) => {
    const controller = new window.AbortController()
    window.setTimeout(() => controller.abort(new window.DOMException('Timeout', 'TimeoutError')), milliseconds)
    return controller.signal
  }
  window.HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  window.HTMLDialogElement.prototype.close ??= function (value) {
    if (value !== undefined) this.returnValue = value
    this.open = false
    this.dispatchEvent(new window.Event('close'))
  }

  const fixture = { window, identity, rows, calls: [], handlers: {}, signals: [], accountId: 'account-id', accountSequence: 0, avatarFetches: [], revokedAvatarUrls: [] }
  window.URL.createObjectURL = () => `blob:avatar-${fixture.accountSequence}`
  window.URL.revokeObjectURL = value => fixture.revokedAvatarUrls.push(value)
  window.fetch = async (...args) => {
    fixture.avatarFetches.push(args)
    if(fixture.handlers.avatarFetch) return fixture.handlers.avatarFetch(...args)
    return new Response('{}')
  }
  const client = {
    auth: {
      onAuthStateChange: callback => { fixture.authCallback = callback; return { data: { subscription: { unsubscribe() {} } } } },
      getSession: async () => {
        if (fixture.handlers.getSession) return fixture.handlers.getSession()
        return ok({ session: fixture.identity.can_post || fixture.identity.is_admin || fixture.identity.banned
          ? { access_token: `${fixture.accountId}-token`, user: { id: fixture.accountId, email_confirmed_at: '2026-10-19T00:00:00Z' } }
          : null })
      }
    },
    rpc(name, args) {
      fixture.calls.push({ name, args: args ? structuredClone(args) : undefined })
      return {
        abortSignal(signal) {
          fixture.signals.push(signal)
          if (fixture.handlers[name]) return Promise.resolve().then(() => fixture.handlers[name](args, signal))
          if (name === 'comment_me') return Promise.resolve(ok({ ...fixture.identity }))
          if (name === 'comment_list') return Promise.resolve(ok(fixture.rows))
          if (name === 'comment_create') return Promise.resolve(ok({ id: row(999).id, is_pending: false }))
          return Promise.resolve(ok(null))
        }
      }
    }
  }
  const modules = new Map()
  const loadModule = (name) => {
    if (modules.has(name)) return modules.get(name).exports
    const module = { exports: {} }
    modules.set(name, module)
    let source = read(`src/lib/${name}.ts`)
    source = source
      .replaceAll('import.meta.env.PUBLIC_SUPABASE_URL', JSON.stringify(configured ? 'https://example.supabase.co' : ''))
      .replaceAll('import.meta.env.PUBLIC_SUPABASE_ANON_KEY', JSON.stringify(configured ? 'sb_publishable_dom_regression' : ''))
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const require = (id) => {
      if (id === '@supabase/supabase-js') return { createClient: () => client }
      if (id === './comment-auth' || id === './comment-utils' || id === './comment-avatar') return loadModule(id.slice(2))
      throw new Error(`Unexpected module at test boundary: ${id}`)
    }
    window.Function('require', 'module', 'exports', code)(require, module, module.exports)
    if(name === 'comment-avatar') module.exports.prepareCommentAvatar = async (...args) => {
      if(fixture.handlers.prepareAvatar) return fixture.handlers.prepareAvatar(...args)
      return new Blob(['prepared-jpeg'], {type:'image/jpeg'})
    }
    return module.exports
  }
  const authModule = loadModule('comment-auth')
  const authScript = authSource.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(authScript, 'The real CommentAuth behavior script must be present')
  const authCode = ts.transpileModule(authScript, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const authExports = {}
  window.Function('require', 'module', 'exports', authCode)(() => authModule, { exports: authExports }, authExports)
  if (initialSessionBeforeComments) {
    // The shared auth client already exists and its one-time initialization
    // notification has been delivered before site-comments is upgraded.
    fixture.authCallback('INITIAL_SESSION', { user: { id: fixture.accountId } })
    await new Promise(resolve => window.setTimeout(resolve, 5))
    await flush()
  }
  loadModule('comments')
  const panel = window.document.querySelector('site-comments')
  const select = (selector) => { const found = panel.querySelector(selector); assert.ok(found, selector); return found }
  Object.assign(fixture, {
    panel, select,
    compose: select('[data-compose]'), textarea: select('textarea'), nickname: select('[name=nickname]'),
    post: select('[data-compose] [data-submit]'), authSubmit: select('[data-auth-form] [data-submit]'),
    status: select('[data-status]'), list: select('[data-list]'),
    submit() { fixture.post.click() },
    draft(body, nickname = 'Reader') {
      fixture.nickname.value = nickname
      fixture.textarea.value = body
      fixture.textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    },
    changeIdentity(next) {
      fixture.identity = next
      fixture.accountId = `account-${++fixture.accountSequence}`
      authModule.emitCommentAuthChange(next.can_post || next.is_admin || next.banned ? fixture.accountId : null)
    },
    refreshIdentity(event = 'TOKEN_REFRESHED') { fixture.authCallback(event, fixture.identity.can_post || fixture.identity.is_admin || fixture.identity.banned ? { user: { id: fixture.accountId } } : null) },
    notifyUnknownIdentity() { authModule.emitCommentAuthChange() }
  })
  if (configured) await until(() => select('[data-list]').getAttribute('aria-busy') === 'false', 'initial comment load')
  await flush()
  return fixture
}

for (const language of ['zh', 'en']) {
  test(`${language}: anonymous auth submit stays enabled while comment submit is disabled`, async (context) => {
    const ui = await setup(context, language)
    assert.equal(ui.panel.querySelector('[data-submit]'), ui.authSubmit, 'The test must retain the real nested selector collision')
    assert.equal(ui.authSubmit.disabled, false)
    assert.equal(ui.authSubmit.matches(':disabled'), false, 'The real Auth script must enable its disabled fieldset')
    assert.equal(ui.post.disabled, true)
    ui.changeIdentity(member())
    await until(() => !ui.post.disabled, 'posting permission after authentication')
    assert.equal(ui.authSubmit.disabled, false)
  })

  test(`${language}: server text, nickname and reply context cannot create HTML`, async (context) => {
    const attack = '<img src=x onerror="window.commentXss=true"><script>window.commentXss=true</script>'
    const ui = await setup(context, language, { rows: [row(1, { nickname: attack, body: attack, parent_id: row(2).id, parent_nickname: attack })] })
    assert.equal(ui.list.querySelectorAll('img,script,svg,iframe').length, 0)
    assert.ok(ui.list.querySelector('strong').textContent.includes(attack))
    assert.equal(ui.list.querySelector('.comment-body').textContent, attack)
    assert.ok(ui.list.querySelector('.comment-context').textContent.includes(attack))
    assert.equal(ui.window.commentXss, undefined)
  })

  test(`${language}: deleted comment content is replaced by a deletion notice`, async (context) => {
    const ui = await setup(context, language, { rows: [row(1, { deleted: true, body: 'Previously private text' })] })
    assert.equal(ui.list.textContent.includes('Previously private text'), false)
    assert.match(ui.list.querySelector('.comment-body').textContent, language === 'en' ? /deleted/i : /已删除/)
    assert.equal(ui.list.querySelectorAll('button').length, 0)
  })

  test(`${language}: network failure preserves draft and retry reuses the same request ID`, async (context) => {
    const ui = await setup(context, language, { identity: member() })
    ui.handlers.comment_create = () => ({ data: null, error: { message: 'Network request failed' } })
    ui.draft('Draft survives a lost response', 'Visible nickname')
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.status.dataset.error === 'true', 'first failed write')
    assert.equal(ui.textarea.value, 'Draft survives a lost response')
    assert.equal(ui.nickname.value, 'Visible nickname')
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.calls.filter((call) => call.name === 'comment_create').length === 2, 'retry completion')
    const writes = ui.calls.filter((call) => call.name === 'comment_create')
    assert.match(writes[0].args.p_request_id, /^[0-9a-f-]{36}$/)
    assert.equal(writes[1].args.p_request_id, writes[0].args.p_request_id)
    assert.equal(ui.textarea.value, 'Draft survives a lost response')
    ui.draft('Edited draft needs a new idempotency key')
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.calls.filter((call) => call.name === 'comment_create').length === 3, 'edited write completion')
    assert.notEqual(ui.calls.filter((call) => call.name === 'comment_create')[2].args.p_request_id, writes[0].args.p_request_id)
  })

  test(`${language}: auth change immediately removes pending rows and old action permissions`, async (context) => {
    const ui = await setup(context, language, { identity: member({ is_admin: true }), rows: [row(1, { can_delete: true }), row(2, { can_delete: true, is_pending: true, body: 'Pending private comment' })] })
    assert.ok(ui.list.querySelectorAll('button').length > 0)
    ui.draft('Keep my draft across logout')
    const response = deferred()
    ui.handlers.comment_list = () => response.promise
    ui.changeIdentity(guest())
    assert.equal(ui.post.disabled, true)
    assert.equal(ui.list.querySelectorAll('button').length, 0)
    assert.equal(ui.list.textContent.includes('Pending private comment'), false)
    assert.equal(ui.select('[data-admin]').hidden, true)
    assert.equal(ui.textarea.value, 'Keep my draft across logout')
    response.resolve({ data: null, error: { message: 'Offline' } })
    await until(() => ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'failed logout refresh')
    assert.equal(ui.list.querySelectorAll('button').length, 0)
    assert.equal(ui.textarea.value, 'Keep my draft across logout')
  })

  test(`${language}: acknowledged write and failed refresh get a distinct status`, async (context) => {
    const ui = await setup(context, language, { identity: member() })
    ui.handlers.comment_list = () => ({ data: null, error: { message: 'Offline after write' } })
    ui.draft('Already accepted by the server')
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.status.dataset.error === 'true', 'write with failed list refresh')
    assert.equal(ui.textarea.value, '', 'An acknowledged write must not be offered as an unchanged draft retry')
    assert.match(ui.status.textContent, language === 'en' ? /submitted.*could not refresh/i : /已提交.*刷新失败/)
    assert.match(ui.status.textContent, language === 'en' ? /do not need to post again/i : /无需重复提交/)
  })

  test(`${language}: delete confirmation can cancel; an accepted delete reports a failed refresh`, async (context) => {
    const ui = await setup(context, language, { identity: member(), rows: [row(1, { can_delete: true })] })
    const findDelete = () => [...ui.list.querySelectorAll('button')].find((button) => button.textContent === (language === 'en' ? 'Delete' : '删除'))
    findDelete().click()
    const dialog = ui.select('dialog')
    assert.equal(dialog.open, true)
    dialog.close('cancel')
    await flush()
    assert.equal(ui.calls.some((call) => call.name === 'comment_delete'), false)
    findDelete().click()
    ui.handlers.comment_list = () => ({ data: null, error: { message: 'Offline after deletion' } })
    dialog.close('confirm')
    await until(() => ui.calls.some((call) => call.name === 'comment_delete') && !ui.textarea.disabled, 'confirmed delete completion')
    const deletion = ui.calls.find((call) => call.name === 'comment_delete')
    assert.equal(deletion.args.p_id, row(1).id)
    assert.equal(deletion.args.p_branch, false)
    assert.equal(ui.status.dataset.error, 'true')
    assert.match(ui.status.textContent, language === 'en' ? /action succeeded.*could not refresh/i : /操作已完成.*刷新失败/)
  })

  test(`${language}: a banned account sees its own delete action but cannot reply or post`, async (context) => {
    const ui = await setup(context, language, { identity: member({ can_post: false, banned: true }), rows: [row(1, { can_delete: true })] })
    assert.equal(ui.post.disabled, true)
    const actions = [...ui.list.querySelectorAll('button')]
    assert.equal(actions.length, 1)
    assert.equal(actions[0].textContent, language === 'en' ? 'Delete' : '删除')
    assert.equal(actions[0].disabled, false)
    assert.match(ui.status.textContent, language === 'en' ? /can delete.*own comments/i : /仍可删除自己的留言/)
    assert.equal(ui.select('[data-identity]').parentElement, ui.select('[data-identity-home]'))
    assert.equal(ui.select('[data-identity]').hidden, false)
    assert.equal(ui.select('[data-identity-name]').textContent, 'Reader')
    assert.equal(ui.select('[data-restricted-badge]').hidden, false)
    assert.equal(ui.select('[data-profile-edit]').hidden, true)
  })

  test(`${language}: content validation errors explain how to correct the preserved draft`, async (context) => {
    const ui = await setup(context, language, { identity: member() })
    ui.handlers.comment_create = () => ({ data: null, error: { code: 'P0001', message: 'too_many_links' } })
    const draft = 'https://one.test https://two.test https://three.test https://four.test https://five.test https://six.test'
    ui.draft(draft)
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.status.dataset.error === 'true', 'server content validation')
    assert.equal(ui.textarea.value, draft)
    assert.match(ui.status.textContent, language === 'en' ? /at most five web links/i : /最多包含 5 个网址/)
  })

  test(`${language}: pending status comes from the individual write result, including admin replies`, async (context) => {
    const ui = await setup(context, language, { identity: member({ is_admin: true, moderation_enabled: false }) })
    ui.handlers.comment_create = () => ok({ id: row(99).id, is_pending: true })
    ui.draft('Reply remains pending with its parent')
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.textarea.value === '', 'pending write result')
    assert.match(ui.status.textContent, language === 'en' ? /submitted for review/i : /审核通过后公开/)
    assert.equal(ui.status.dataset.error, 'false')
  })

  test(`${language}: reconnect ignores an old write response and its finally block`, async (context) => {
    const ui = await setup(context, language, { identity: member() })
    const oldWrite = deferred()
    const newWrite = deferred()
    let writes = 0
    ui.handlers.comment_create = () => (++writes === 1 ? oldWrite.promise : newWrite.promise)
    ui.draft('Old draft')
    ui.submit()
    await until(() => writes === 1, 'old write started')
    const oldSignal = ui.signals.at(-1)
    ui.panel.remove() // Use the native HTMLElement.remove(), exercising the previous name collision.
    assert.equal(oldSignal.aborted, true)
    ui.window.document.body.append(ui.panel)
    await until(() => !ui.textarea.disabled && ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'reconnected component ready')
    ui.draft('New draft after reconnect')
    ui.submit()
    await until(() => writes === 2, 'new write started exactly once')
    const newStatus = ui.status.textContent
    // Transport intentionally delivers an already-completed response despite
    // abort, modeling the queued response microtask rather than mock-cancelling it.
    oldWrite.resolve(ok({ id: row(90).id, is_pending: false }))
    await flush()
    assert.equal(ui.textarea.value, 'New draft after reconnect')
    assert.equal(ui.textarea.disabled, true, 'Old finally must not release the new write lock')
    assert.equal(ui.status.textContent, newStatus)
    assert.equal(writes, 2, 'Reconnect must not duplicate submit handlers')
    newWrite.resolve({ data: null, error: { message: 'New request offline' } })
    await until(() => !ui.textarea.disabled, 'new write completed')
    assert.equal(ui.textarea.value, 'New draft after reconnect')
  })

  test(`${language}: earlier-page loading uses the cursor and deduplicates overlapping rows`, async (context) => {
    const firstPage = Array.from({ length: 30 }, (_, index) => row(index + 1))
    const ui = await setup(context, language, { rows: firstPage })
    assert.equal(ui.list.children.length, 30)
    assert.equal(ui.select('[data-more]').hidden, false)
    ui.handlers.comment_list = () => ok([firstPage.at(-1), row(31), row(32)])
    ui.select('[data-more]').click()
    await until(() => ui.list.children.length === 32, 'deduplicated second page')
    const request = ui.calls.filter((call) => call.name === 'comment_list').at(-1).args
    assert.equal(request.p_before, firstPage.at(-1).created_at)
    assert.equal(request.p_before_id, firstPage.at(-1).id)
    assert.equal(new Set([...ui.list.children].map((item) => item.id)).size, 32)
    assert.equal(ui.select('[data-more]').hidden, true)
  })

  test(`${language}: unconfigured service shows its email fallback without RPC requests`, async (context) => {
    const ui = await setup(context, language, { configured: false })
    assert.equal(ui.select('[data-unconfigured]').hidden, false)
    assert.equal(ui.select('[data-configured]').hidden, true)
    assert.equal(ui.calls.length, 0)
    assert.match(ui.select('[data-unconfigured] a').href, /^mailto:/)
  })
}

for (const language of ['zh', 'en']) {
  const label = (zh, en) => language === 'en' ? en : zh
  const replyTo = (ui, number) => [...ui.select(`#comment-${row(number).id}`).querySelectorAll('.comment-item-actions > button')].find(button => button.textContent === label('回复', 'Reply'))

  test(`${language}: site owner has a fixed identity and never needs a public-name field`, async (context) => {
    const ui = await setup(context, language, { identity: member({ is_admin: true, nickname: '1' }) })
    assert.equal(ui.select('[data-identity-name]').textContent, 'Cyril Fan')
    assert.equal(ui.select('[data-profile-editor]').hidden, true)
    assert.equal(ui.select('[data-profile-edit]').hidden, true)
    assert.equal(ui.select('[data-owner-badge]').hidden, false)
    assert.equal(ui.nickname.disabled, true)
    assert.equal(ui.nickname.required, false)
    ui.draft('A note from the owner', 'Spoofed old form value')
    ui.submit()
    await until(() => ui.calls.some(call => call.name === 'comment_create') && !ui.textarea.disabled, 'owner comment')
    assert.equal(ui.calls.find(call => call.name === 'comment_create').args.p_nickname, 'Cyril Fan')
    assert.equal(ui.calls.some(call => call.name === 'comment_profile_update'), false)
  })

  test(`${language}: a first nickname is requested once and posting keeps the saved identity`, async (context) => {
    const ui = await setup(context, language, { identity: member({ nickname: null }) })
    assert.equal(ui.select('[data-profile-editor]').hidden, false)
    assert.equal(ui.nickname.required, true)
    assert.equal(ui.select('[data-profile-cancel]').hidden, true)
    ui.handlers.comment_create = args => { ui.identity = member({ nickname: args.p_nickname }); return ok({ id: row(99).id, is_pending: false }) }
    ui.draft('First comment', 'New reader')
    ui.submit()
    await until(() => ui.select('[data-profile-editor]').hidden && !ui.textarea.disabled, 'first nickname saved with comment')
    assert.equal(ui.select('[data-identity-name]').textContent, 'New reader')
    assert.equal(ui.nickname.required, false)
    ui.draft('Second comment', 'A stale hidden input')
    ui.submit()
    await until(() => ui.calls.filter(call => call.name === 'comment_create').length === 2 && !ui.textarea.disabled, 'second comment')
    assert.equal(ui.calls.filter(call => call.name === 'comment_create')[1].args.p_nickname, 'New reader')
  })

  test(`${language}: owner avatars reuse the local website image with initials on failure and cannot be copied by nickname`, async context => {
    const ui = await setup(context, language, { identity: member({ is_admin: true }), rows: [row(1, { nickname: 'Cyril Fan', is_admin_author: true }), row(2, { nickname: 'Cyril Fan' })] })
    const ownAvatar=ui.select('[data-identity-avatar]')
    const oldCommentAvatar=ui.select(`#comment-${row(1).id} .comment-avatar`)
    for(const avatar of [ownAvatar,oldCommentAvatar]) {
      const image=avatar.querySelector('img')
      assert.equal(image.getAttribute('src'), '/avatar/avatar.png')
      assert.equal(image.alt, '')
      image.dispatchEvent(new ui.window.Event('error'))
      assert.equal(avatar.querySelector('img'), null)
      assert.equal(avatar.textContent, 'CF')
    }
    assert.equal(ui.select(`#comment-${row(2).id} .comment-avatar`).querySelector('img'), null)
    ui.changeIdentity(member())
    await until(() => ui.select('[data-identity-name]').textContent === 'Reader' && !ui.post.disabled, 'ordinary member after owner')
    assert.equal(ownAvatar.querySelector('img'), null)
    assert.equal(ownAvatar.textContent, 'R')
  })

  test(`${language}: nickname editing is explicit, cancellable, and does not submit on IME confirmation`, async (context) => {
    const ui = await setup(context, language, { identity: member() })
    ui.draft('Keep this draft')
    ui.select('[data-profile-edit]').click()
    assert.equal(ui.window.document.activeElement, ui.nickname)
    assert.equal(ui.post.disabled, true, 'Finish or cancel a profile edit before posting')
    ui.nickname.value = 'Not saved'
    ui.nickname.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    ui.nickname.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
    await flush()
    assert.equal(ui.calls.some(call => call.name === 'comment_profile_update'), false)
    assert.equal(ui.select('[data-profile-editor]').hidden, false)
    assert.equal(ui.nickname.value, 'Not saved')
    ui.select('[data-profile-cancel]').click()
    assert.equal(ui.nickname.value, 'Reader')
    assert.equal(ui.textarea.value, 'Keep this draft')
    assert.equal(ui.post.disabled, false)
    ui.select('[data-profile-edit]').click()
    ui.nickname.value = 'Renamed'
    ui.handlers.comment_profile_update = args => { ui.identity = member({ nickname: args.p_nickname }); return ok(ui.identity) }
    ui.nickname.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => ui.select('[data-identity-name]').textContent === 'Renamed' && !ui.textarea.disabled, 'explicit nickname save')
    assert.equal(ui.calls.filter(call => call.name === 'comment_profile_update').length, 1)
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
    assert.equal(ui.textarea.value, 'Keep this draft')
  })

  test(`${language}: a rename refreshes every loaded page and selected reply context`, async (context) => {
    const original = Array.from({ length: 32 }, (_, index) => row(index + 1, { nickname: 'Reader', parent_id: index === 30 ? row(1).id : null, parent_nickname: index === 30 ? 'Reader' : null }))
    const ui = await setup(context, language, { identity: member(), rows: original.slice(0, 30) })
    let renamed = false
    ui.handlers.comment_list = args => ok((args.p_before_id ? original.slice(30) : original.slice(0, 30)).map(item => ({ ...item, nickname: renamed ? 'New name' : item.nickname, parent_nickname: item.parent_id && renamed ? 'New name' : item.parent_nickname })))
    ui.select('[data-more]').click()
    await until(() => ui.list.children.length === 32, 'earlier rows loaded')
    replyTo(ui, 32).click()
    ui.draft('Reply draft')
    ui.select('[data-profile-edit]').click()
    ui.nickname.value = 'New name'
    ui.handlers.comment_profile_update = args => { renamed = true; ui.identity = member({ nickname: args.p_nickname }); return ok(ui.identity) }
    ui.select('[data-profile-save]').click()
    await until(() => !ui.textarea.disabled && ui.status.textContent.includes(label('昵称已更新', 'Nickname updated')), 'profile and paginated rows refreshed')
    assert.equal(ui.list.children.length, 32)
    assert.ok([...ui.list.querySelectorAll('.comment-item-header strong')].every(name => name.textContent === 'New name'))
    assert.match(ui.select(`#comment-${row(31).id} .comment-context`).textContent, /New name/)
    assert.equal(ui.compose.parentElement.id, `comment-${row(32).id}`)
    assert.match(ui.select('[data-reply] span').textContent, /New name/)
    assert.equal(ui.textarea.value, 'Reply draft')
    assert.equal(ui.status.parentElement, ui.compose, 'Feedback travels with the reply composer')
  })

  test(`${language}: one reply composer moves, survives refresh, and returns home without losing a draft`, async (context) => {
    const ui = await setup(context, language, { identity: member(), rows: [row(1), row(2)] })
    const originalCompose = ui.compose
    ui.draft('Draft stays with me')
    replyTo(ui, 1).click()
    assert.equal(ui.compose, originalCompose)
    assert.equal(ui.panel.querySelectorAll('[data-compose]').length, 1)
    assert.equal(ui.compose.parentElement.id, `comment-${row(1).id}`)
    assert.equal(ui.window.document.activeElement, ui.textarea)
    assert.match(ui.select('[data-reply-excerpt]').textContent, /Comment 1/)
    assert.equal(ui.post.textContent, label('发布回复', 'Post reply'))
    replyTo(ui, 2).click()
    assert.equal(ui.compose.parentElement.id, `comment-${row(2).id}`)
    assert.equal(ui.textarea.value, 'Draft stays with me')
    ui.textarea.setSelectionRange(2, 5)
    ui.select('[data-refresh]').click()
    await until(() => ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'reply refresh')
    assert.equal(ui.compose.parentElement.id, `comment-${row(2).id}`)
    assert.equal(ui.textarea.value, 'Draft stays with me')
    assert.equal(ui.window.document.activeElement, ui.textarea)
    assert.equal(ui.textarea.selectionStart, 2)
    ui.select('[data-cancel-reply]').click()
    assert.equal(ui.compose.parentElement, ui.select('[data-compose-home]'))
    assert.equal(ui.textarea.value, 'Draft stays with me')
    assert.equal(ui.post.textContent, label('发布留言', 'Post comment'))
    assert.equal(ui.panel.querySelectorAll('[data-status]').length, 1)
  })

  test(`${language}: an unavailable reply target requires cancellation before a root comment can be sent`, async (context) => {
    const ui = await setup(context, language, { identity: member(), rows: [row(1, { body: 'Soon deleted private text' })] })
    replyTo(ui, 1).click()
    ui.draft('Do not silently change my target')
    ui.rows = []
    ui.select('[data-refresh]').click()
    await until(() => ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'target disappears')
    assert.equal(ui.compose.parentElement, ui.select('[data-compose-home]'))
    assert.equal(ui.post.disabled, true)
    assert.equal(ui.select('[data-reply]').hidden, false)
    assert.equal(ui.select('[data-reply-excerpt]').textContent, '')
    assert.match(ui.select('[data-reply] span').textContent, language === 'en' ? /cancel the reply/i : /取消回复/)
    ui.textarea.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await flush()
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
    ui.select('[data-cancel-reply]').click()
    assert.equal(ui.post.disabled, false)
    assert.equal(ui.textarea.value, 'Do not silently change my target')
  })

  test(`${language}: switching accounts clears the old nickname and ignores an old profile response`, async (context) => {
    const ui = await setup(context, language, { identity: member(), rows: [row(1)] })
    replyTo(ui, 1).click()
    ui.draft('Shared draft stays visible')
    ui.select('[data-profile-edit]').click()
    ui.nickname.value = 'Old account edit'
    const oldProfile = deferred(), newWrite = deferred()
    ui.handlers.comment_profile_update = () => oldProfile.promise
    ui.select('[data-profile-save]').click()
    await until(() => ui.calls.some(call => call.name === 'comment_profile_update'), 'old profile request in flight')
    ui.changeIdentity(member({ nickname: 'Another reader' }))
    assert.equal(ui.nickname.value, '', 'Old account nickname is cleared synchronously')
    assert.equal(ui.compose.parentElement, ui.select('[data-compose-home]'))
    await until(() => ui.select('[data-identity-name]').textContent === 'Another reader' && !ui.textarea.disabled, 'new account identity')
    assert.equal(ui.select('[data-profile-editor]').hidden, true)
    ui.handlers.comment_create = () => newWrite.promise
    ui.submit()
    await until(() => ui.calls.some(call => call.name === 'comment_create'), 'new account posting')
    oldProfile.resolve(ok(member({ nickname: 'Old account edit' })))
    await flush()
    assert.equal(ui.select('[data-identity-name]').textContent, 'Another reader')
    assert.equal(ui.textarea.disabled, true, 'The previous account cannot release the new mutation lock')
    assert.equal(ui.textarea.value, 'Shared draft stays visible')
    newWrite.resolve({ data: null, error: { message: 'Offline' } })
    await until(() => !ui.textarea.disabled, 'new mutation completes')
    assert.equal(ui.calls.find(call => call.name === 'comment_create').args.p_nickname, 'Another reader')
  })

  test(`${language}: anonymous visitors get a focused sign-in entry and loading never looks like an empty thread`, async (context) => {
    const ui = await setup(context, language)
    assert.equal(ui.compose.hidden, true)
    assert.equal(ui.select('[data-login-prompt]').hidden, false)
    assert.equal(ui.select('comment-auth [data-guest]').hidden, true)
    ui.select('[data-sign-in]').click()
    assert.equal(ui.select('comment-auth [data-guest]').hidden, false)
    assert.equal(ui.window.document.activeElement, ui.select('comment-auth [name=email]'))
    ui.select('[data-auth-close]').click()
    assert.equal(ui.select('comment-auth [data-guest]').hidden, true)
    assert.equal(ui.window.document.activeElement, ui.select('[data-sign-in]'))
    const response = deferred()
    ui.handlers.comment_list = () => response.promise
    ui.select('[data-refresh]').click()
    assert.equal(ui.select('[data-empty]').hidden, true)
    assert.match(ui.status.textContent, language === 'en' ? /loading/i : /正在加载/)
    response.resolve(ok([]))
    await until(() => !ui.select('[data-empty]').hidden, 'empty state appears after a successful response')
  })

  test(`${language}: reply references link only to loaded parent comments`, async (context) => {
    const ui = await setup(context, language, { rows: [row(1), row(2, { parent_id: row(1).id }), row(3, { parent_id: row(99).id })] })
    assert.equal(ui.select(`#comment-${row(2).id} .comment-context a`).hash, `#comment-${row(1).id}`)
    assert.equal(ui.select(`#comment-${row(3).id} .comment-context`).querySelector('a'), null)
  })

  test(`${language}: keyboard posting ignores ordinary Enter and IME, but supports Ctrl and Cmd`, async (context) => {
    const ui = await setup(context, language, { identity: member() })
    ui.handlers.comment_create = () => ({ data: null, error: { message: 'Network unavailable' } })
    ui.draft('Keyboard draft')
    ui.textarea.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    ui.textarea.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }))
    await flush()
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
    ui.textarea.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await until(() => !ui.textarea.disabled && ui.calls.filter(call => call.name === 'comment_create').length === 1, 'Ctrl Enter posting')
    ui.textarea.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    await until(() => !ui.textarea.disabled && ui.calls.filter(call => call.name === 'comment_create').length === 2, 'Cmd Enter posting')
    assert.equal(ui.textarea.value, 'Keyboard draft')
  })

  test(`${language}: destructive actions stay in a dismissible menu and auth change cancels their confirmation`, async (context) => {
    const ui = await setup(context, language, { identity: member({ is_admin: true }), rows: [row(1, { can_delete: true })] })
    const menu = ui.select('.comment-menu')
    assert.match(menu.querySelector('summary').getAttribute('aria-label'), /Reader 1/)
    assert.equal(menu.open, false)
    menu.open = true
    menu.querySelector('summary').dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal(menu.open, false)
    menu.open = true
    ui.textarea.click()
    assert.equal(menu.open, false)
    const deletion = [...menu.querySelectorAll('button')].find(button => button.textContent === label('删除', 'Delete'))
    deletion.click()
    assert.equal(ui.select('dialog').open, true)
    ui.changeIdentity(guest())
    await flush()
    ui.select('dialog').close('confirm')
    await flush()
    assert.equal(ui.calls.some(call => call.name === 'comment_delete'), false)
    assert.equal(ui.status.parentElement, ui.select('[data-status-home]'), 'Feedback remains visible outside the now-hidden form')
  })
}

for (const language of ['zh', 'en']) {
  test(`${language}: a missed INITIAL_SESSION followed by same-account refocus preserves editing and reply context`, async context => {
    const ui = await setup(context, language, { identity: member(), rows: [row(1)], initialSessionBeforeComments: true })
    Array.from(ui.list.querySelectorAll('.comment-item-actions > button')).find(button => button.textContent === (language === 'en' ? 'Reply' : '回复')).click()
    ui.draft('A reply in progress')
    ui.select('[data-profile-edit]').click()
    ui.nickname.value = 'Name still being edited'
    ui.nickname.setSelectionRange(2, 6)
    const reads = ui.calls.filter(call => call.name === 'comment_me').length
    ui.refreshIdentity('SIGNED_IN')
    await until(() => ui.calls.filter(call => call.name === 'comment_me').length > reads && ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'same-account refocus refresh')
    assert.equal(ui.compose.parentElement.id, `comment-${row(1).id}`)
    assert.equal(ui.select('[data-profile-editor]').hidden, false)
    assert.equal(ui.nickname.value, 'Name still being edited')
    assert.equal(ui.window.document.activeElement, ui.nickname)
    assert.equal(ui.nickname.selectionStart, 2)
    assert.equal(ui.nickname.selectionEnd, 6)
    assert.equal(ui.textarea.value, 'A reply in progress')
    assert.equal(ui.panel.outerHTML.includes(ui.accountId), false, 'Opaque auth identity stays out of rendered markup')
  })

  test(`${language}: token refresh cannot interrupt a write or replace its retry idempotency key`, async context => {
    const ui = await setup(context, language, { identity: member(), rows: [row(1)] })
    Array.from(ui.list.querySelectorAll('.comment-item-actions > button')).find(button => button.textContent === (language === 'en' ? 'Reply' : '回复')).click()
    ui.draft('Retry this exact reply')
    const pending = deferred()
    ui.handlers.comment_create = () => pending.promise
    ui.submit()
    await until(() => ui.calls.some(call => call.name === 'comment_create'), 'write in flight')
    const signal = ui.signals.at(-1)
    ui.refreshIdentity()
    await new Promise(resolve => ui.window.setTimeout(resolve, 5))
    await flush()
    assert.equal(signal.aborted, false)
    assert.equal(ui.textarea.disabled, true)
    assert.equal(ui.compose.parentElement.id, `comment-${row(1).id}`)
    pending.resolve({ data: null, error: { message: 'Response lost after token refresh' } })
    await until(() => !ui.textarea.disabled, 'lost response after refresh')
    ui.handlers.comment_create = () => ({ data: null, error: { message: 'Network unavailable' } })
    ui.submit()
    await until(() => !ui.textarea.disabled && ui.calls.filter(call => call.name === 'comment_create').length === 2, 'retry after normal token refresh')
    const writes = ui.calls.filter(call => call.name === 'comment_create')
    assert.equal(writes[0].args.p_request_id, writes[1].args.p_request_id)
    assert.equal(writes[0].args.p_parent_id, row(1).id)
    assert.equal(writes[1].args.p_parent_id, row(1).id)
    assert.equal(ui.textarea.value, 'Retry this exact reply')
  })
}


for (const language of ['zh', 'en']) {
  const loginReply = ui => [...ui.list.querySelectorAll('.comment-item-actions > button')].find(button => button.textContent === (language === 'en' ? 'Sign in to reply' : '登录后回复'))

  test(`${language}: guests can select a reply before signing in and resume it without posting automatically`, async context => {
    const ui = await setup(context, language, { rows: [row(1)] })
    loginReply(ui).click()
    assert.equal(ui.select('[data-guest]').hidden, false)
    assert.match(ui.select('[data-login-reply-label]').textContent, /Reader 1/)
    assert.equal(ui.window.document.activeElement, ui.select('[name=email]'))
    ui.changeIdentity(member())
    await until(() => !ui.post.disabled && ui.compose.parentElement.id === `comment-${row(1).id}`, 'selected reply restored after sign-in')
    assert.equal(ui.select('[data-login-reply]').hidden, true)
    assert.equal(ui.window.document.activeElement, ui.textarea)
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
    ui.draft('An explicit reply after signing in')
    ui.submit()
    await until(() => ui.calls.some(call => call.name === 'comment_create'), 'explicit reply sent')
    assert.equal(ui.calls.find(call => call.name === 'comment_create').args.p_parent_id, row(1).id)
  })

  test(`${language}: cancelling a guest reply leaves sign-in usable and does not select a target after login`, async context => {
    const ui = await setup(context, language, { rows: [row(1)] })
    loginReply(ui).click()
    ui.select('[data-cancel-login-reply]').click()
    assert.equal(ui.select('[data-login-reply]').hidden, true)
    assert.equal(ui.window.document.activeElement, ui.select('[name=email]'))
    ui.changeIdentity(member())
    await until(() => !ui.post.disabled, 'ordinary sign-in after cancelling reply')
    assert.equal(ui.compose.parentElement, ui.select('[data-compose-home]'))
    assert.equal(ui.select('[data-reply]').hidden, true)
  })

  test(`${language}: a guest reply selected on an earlier page remains loaded after sign-in`, async context => {
    const firstPage=Array.from({length:30},(_,index)=>row(index+1))
    const ui = await setup(context, language, { rows:firstPage })
    ui.handlers.comment_list = args => ok(args.p_before ? [row(31)] : firstPage)
    ui.select('[data-more]').click()
    await until(() => ui.list.children.length===31 && ui.select('[data-list]').getAttribute('aria-busy')==='false','earlier guest page')
    ui.select(`#comment-${row(31).id} .comment-item-actions > button`).click()
    ui.changeIdentity(member())
    await until(() => !ui.post.disabled && ui.compose.parentElement.id===`comment-${row(31).id}`,'earlier reply target after sign-in')
    assert.equal(ui.list.children.length,31)
    assert.equal(ui.select('[data-login-reply]').hidden,true)
  })

  test(`${language}: an account switch during sign-in discards the first account's guest reply intent`, async context => {
    const ui = await setup(context, language, { rows: [row(1)] })
    loginReply(ui).click()
    const firstRead = deferred()
    ui.handlers.comment_list = () => firstRead.promise
    ui.changeIdentity(member({ nickname: 'First account' }))
    await flush()
    delete ui.handlers.comment_list
    ui.changeIdentity(member({ nickname: 'Second account' }))
    await until(() => !ui.post.disabled && ui.select('[data-identity-name]').textContent === 'Second account', 'second sign-in account')
    firstRead.resolve(ok([row(1)]))
    await flush()
    assert.equal(ui.compose.parentElement, ui.select('[data-compose-home]'))
    assert.equal(ui.select('[data-login-reply]').hidden, true)
    assert.equal(ui.select('[data-reply]').hidden, true)
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
  })

  test(`${language}: an unverified account cannot resume or post a guest reply`, async context => {
    const ui = await setup(context, language, { rows: [row(1)] })
    loginReply(ui).click()
    ui.handlers.getSession = () => ok({ session: { user: { id: 'unverified-account', email_confirmed_at: null } } })
    ui.authCallback('SIGNED_IN', { user: { id: 'unverified-account' } })
    await until(() => ui.select('[data-account]').textContent.includes(language === 'en' ? 'not verified' : '尚未验证'), 'unverified auth display')
    await until(() => ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'unverified permissions')
    ui.draft('Must not be sent')
    ui.submit()
    assert.equal(ui.compose.hidden, true)
    assert.equal(ui.post.disabled, true)
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
  })

  test(`${language}: a guest reply target deleted during login cannot become an accidental root comment`, async context => {
    const ui = await setup(context, language, { rows: [row(1)] })
    loginReply(ui).click()
    ui.rows = [row(1, { deleted: true, body: '' })]
    ui.changeIdentity(member())
    await until(() => !ui.compose.hidden && ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'deleted target after sign-in')
    assert.equal(ui.post.disabled, true)
    assert.equal(ui.select('[data-reply]').hidden, false)
    assert.match(ui.select('[data-reply] span').textContent, language === 'en' ? /cancel the reply/i : /取消回复/)
    ui.select('[data-cancel-reply]').click()
    assert.equal(ui.post.disabled, false)
  })

  test(`${language}: moderation is explained before posting and owner pending replies are also identified`, async context => {
    const ui = await setup(context, language, { identity: member({ moderation_enabled: true }), rows: [row(1, { is_pending: true })] })
    assert.equal(ui.select('[data-moderation-note]').hidden, false)
    ui.changeIdentity(member({ is_admin: true, moderation_enabled: true }))
    await until(() => ui.select('[data-owner-badge]').hidden === false && ui.select('[data-list]').getAttribute('aria-busy') === 'false', 'owner moderation identity')
    assert.equal(ui.select('[data-moderation-note]').hidden, true, 'Owner root posts do not require review')
    ;[...ui.list.querySelectorAll('.comment-item-actions > button')].find(button => button.textContent === (language === 'en' ? 'Reply' : '回复')).click()
    assert.equal(ui.select('[data-moderation-note]').hidden, false, 'A pending parent also keeps its owner reply pending')
    ui.select('[data-cancel-reply]').click()
    assert.equal(ui.select('[data-moderation-note]').hidden, true)
  })

  test(`${language}: loading another page after silent admin removal refreshes earlier permissions and hides private rows`, async context => {
    const oldRows=Array.from({length:30},(_,index)=>row(index+1,{can_delete:true,is_pending:index===0}))
    const ui=await setup(context,language,{identity:member({is_admin:true}),rows:oldRows})
    ui.identity=member()
    const publicRows=Array.from({length:30},(_,index)=>row(index+2))
    ui.handlers.comment_list=args=>ok(args.p_before ? [row(32)] : publicRows)
    ui.select('[data-more]').click()
    await until(()=>ui.select('[data-list]').getAttribute('aria-busy')==='false' && ui.select('[data-admin]').hidden,'silent role removal refresh')
    assert.equal(ui.list.querySelector(`#comment-${row(1).id}`),null)
    assert.equal(ui.list.querySelectorAll('.comment-menu').length,0,'Old administrator delete and ban controls disappear')
    assert.equal(ui.list.children.length,31,'The requested earlier page remains included after permission refresh')
    assert.equal(ui.calls.filter(call=>call.name==='comment_list' && !call.args.p_before).length,2)
  })

  test(`${language}: a session account changed without an auth event cannot retain earlier private rows or a reply target`, async context => {
    const oldRows=Array.from({length:30},(_,index)=>row(index+1,{can_delete:true,is_pending:index===0}))
    const ui=await setup(context,language,{identity:member({is_admin:true}),rows:oldRows})
    ;[...ui.list.querySelectorAll('.comment-item-actions > button')].find(button=>button.textContent===(language==='en'?'Reply':'回复')).click()
    ui.draft('Preserve text, not the old private target')
    ui.identity=member({nickname:'Second reader'})
    ui.accountId='different-session-account'
    ui.handlers.comment_list=()=>ok([row(31)])
    ui.select('[data-more]').click()
    await until(()=>ui.select('[data-list]').getAttribute('aria-busy')==='false' && ui.select('[data-identity-name]').textContent==='Second reader','silent account replacement')
    assert.equal(ui.list.children.length,1)
    assert.equal(ui.list.querySelector(`#comment-${row(1).id}`),null)
    assert.equal(ui.list.querySelectorAll('.comment-menu').length,0)
    assert.equal(ui.select('[data-reply]').hidden,true)
    assert.equal(ui.compose.parentElement,ui.select('[data-compose-home]'))
    assert.equal(ui.textarea.value,'Preserve text, not the old private target')
  })

  test(`${language}: a silently revoked session discovered during pagination clears posting and old delete controls`, async context => {
    const oldRows=Array.from({length:30},(_,index)=>row(index+1,{can_delete:true}))
    const ui=await setup(context,language,{identity:member(),rows:oldRows})
    ui.identity=guest()
    ui.handlers.comment_list=()=>ok([row(31)])
    ui.select('[data-more]').click()
    await until(()=>ui.select('[data-list]').getAttribute('aria-busy')==='false' && !ui.select('[data-login-prompt]').hidden,'silently revoked sign-in')
    assert.equal(ui.post.disabled,true)
    assert.equal(ui.compose.hidden,true)
    assert.equal(ui.list.querySelectorAll('.comment-menu').length,0)
    assert.equal(ui.list.children.length,1)
  })

  test(`${language}: a rejected unknown-account session check fails closed without an unhandled rejection`, async context => {
    const ui = await setup(context, language, { identity: member() })
    ui.draft('Keep this draft if account storage fails')
    ui.handlers.getSession = () => Promise.reject(new Error('Session storage unavailable'))
    ui.notifyUnknownIdentity()
    await until(() => ui.post.disabled && ui.status.dataset.error === 'true', 'session failure denied posting')
    assert.equal(ui.compose.hidden, true)
    assert.equal(ui.textarea.value, 'Keep this draft if account storage fails')
    assert.equal(ui.status.parentElement, ui.select('[data-status-home]'))
    assert.equal(ui.calls.some(call => call.name === 'comment_create'), false)
  })
}

const avatarKey = '20f34ef2-7542-482d-96c4-142dbf2be103'
const avatarPath = `${avatarKey}.jpg?v=1`
const avatarMember = (extra={}) => member({ avatar_key:avatarKey, avatar_path:avatarPath, ...extra })
function chooseAvatarFile(ui) {
  ui.select('[data-avatar-edit]').click()
  const input=ui.select('[data-avatar-file]')
  Object.defineProperty(input,'files',{configurable:true,value:[new ui.window.File(['original'], 'picture.png',{type:'image/png'})]})
  Object.defineProperty(input,'value',{configurable:true,writable:true,value:'C:\\fakepath\\picture.png'})
  input.dispatchEvent(new ui.window.Event('change',{bubbles:true}))
}
for(const language of ['zh','en']) {
  test(`${language}: avatar actions follow owner, new member, active member, banned and guest roles`,async context=>{
    const ui=await setup(context,language,{identity:avatarMember()})
    assert.equal(ui.select('[data-avatar-edit]').hidden,false)
    assert.equal(ui.select('[data-avatar-remove]').hidden,false)
    assert.equal(ui.select('[data-identity-avatar] img').src,`https://example.supabase.co/storage/v1/object/public/comment-avatars/${avatarPath}`)
    ui.select('[data-identity-avatar] img').dispatchEvent(new ui.window.Event('error'))
    assert.equal(ui.select('[data-identity-avatar]').textContent,'R')
    ui.changeIdentity(avatarMember({banned:true,can_post:false}))
    await until(()=>!ui.select('[data-restricted-badge]').hidden,'banned identity')
    assert.equal(ui.select('[data-avatar-edit]').hidden,true)
    assert.equal(ui.select('[data-avatar-remove]').hidden,false)
    assert.equal(ui.select('[data-avatar-remove]').closest('[data-identity]').parentElement,ui.select('[data-identity-home]'))
    ui.changeIdentity(avatarMember({is_admin:true}))
    await until(()=>!ui.select('[data-owner-badge]').hidden,'owner identity')
    assert.equal(ui.select('[data-avatar-edit]').hidden,true)
    assert.equal(ui.select('[data-avatar-remove]').hidden,true)
    ui.changeIdentity(member({nickname:null}))
    await until(()=>!ui.select('[data-profile-editor]').hidden,'new member identity')
    assert.equal(ui.select('[data-avatar-edit]').hidden,true)
    ui.changeIdentity(guest())
    await until(()=>!ui.select('[data-login-prompt]').hidden,'guest identity')
    assert.equal(ui.select('[data-avatar-remove]').hidden,true)
  })

  test(`${language}: avatar selection remains local until save, cancel releases preview and keeps reply draft`,async context=>{
    const ui=await setup(context,language,{identity:avatarMember(),rows:[row(1)]})
    ui.draft('My comment draft')
    chooseAvatarFile(ui)
    await until(()=>!ui.select('[data-avatar-save]').disabled,'local avatar preview')
    assert.equal(ui.select('[data-avatar-preview]').hidden,false)
    assert.equal(ui.avatarFetches.length,0)
    assert.match(ui.select('[data-avatar-file]').value,/picture\.png$/)
    assert.match(ui.select('[data-avatar-preview]').textContent,language==='en'?/public/:/公开/)
    ui.select('[data-avatar-cancel]').click()
    assert.equal(ui.select('[data-avatar-editor]').hidden,true)
    assert.equal(ui.select('[data-avatar-preview-image]').hasAttribute('src'),false)
    assert.equal(ui.select('[data-avatar-file]').value,'')
    assert.deepEqual(ui.revokedAvatarUrls,['blob:avatar-0'])
    assert.equal(ui.textarea.value,'My comment draft')
    assert.equal(ui.avatarFetches.length,0)
  })

  test(`${language}: saving an avatar refreshes historic images; network failure keeps preview for retry`,async context=>{
    const ui=await setup(context,language,{identity:avatarMember(),rows:[row(1,{avatar_path:avatarPath})]})
    chooseAvatarFile(ui)
    await until(()=>!ui.select('[data-avatar-save]').disabled,'preview before save')
    ui.handlers.avatarFetch=async()=>new Response('private provider error',{status:503})
    ui.select('[data-avatar-save]').click()
    await until(()=>!ui.select('[data-avatar-save]').disabled && ui.status.dataset.error==='true','failed save retains preview')
    assert.equal(ui.select('[data-avatar-preview]').hidden,false)
    assert.equal(ui.avatarFetches[0][1].headers.Authorization,'Bearer account-id-token')
    assert.equal(ui.avatarFetches[0][1].body.type,'image/jpeg')
    const newPath=`${avatarKey}.jpg?v=2`
    ui.handlers.avatarFetch=async()=>{
      ui.identity=avatarMember({avatar_path:newPath}); ui.rows=[row(1,{avatar_path:newPath})]
      return new Response('{}')
    }
    ui.select('[data-avatar-save]').click()
    await until(()=>ui.select('[data-avatar-editor]').hidden && !ui.textarea.disabled,'avatar saved')
    assert.match(ui.select('[data-identity-avatar] img').src,/v=2$/)
    assert.match(ui.select('[data-list] .comment-avatar img').src,/v=2$/)
    assert.equal(ui.status.dataset.error,'false')
  })

  test(`${language}: account switch aborts avatar processing and discards late preview without touching a new account`,async context=>{
    const ui=await setup(context,language,{identity:avatarMember()})
    const processing=deferred(); let signal
    ui.handlers.prepareAvatar=(_file,options)=>{signal=options.signal;return processing.promise}
    chooseAvatarFile(ui)
    await until(()=>Boolean(signal),'avatar processing started')
    ui.changeIdentity(avatarMember({nickname:'Another member',avatar_key:'25f34ef2-7542-482d-96c4-142dbf2be103',avatar_path:null}))
    await until(()=>ui.select('[data-identity-name]').textContent==='Another member','next account identity')
    assert.equal(signal.aborted,true)
    processing.resolve(new Blob(['jpeg'],{type:'image/jpeg'}))
    await flush()
    assert.equal(ui.select('[data-avatar-editor]').hidden,true)
    assert.equal(ui.select('[data-avatar-preview-image]').hasAttribute('src'),false)
    assert.equal(ui.avatarFetches.length,0)
    assert.equal(ui.textarea.disabled,false)
  })

  test(`${language}: remove avatar requires confirmation and a server-confirmed disappearance even for banned authors`,async context=>{
    const ui=await setup(context,language,{identity:avatarMember({banned:true,can_post:false})})
    ui.select('[data-avatar-remove]').click(); ui.select('dialog').close('cancel')
    await flush(); assert.equal(ui.avatarFetches.length,0)
    ui.handlers.avatarFetch=async()=>new Response('[]')
    ui.select('[data-avatar-remove]').click(); ui.select('dialog').close('confirm')
    await until(()=>ui.avatarFetches.length===1 && !ui.select('[data-avatar-remove]').disabled,'empty delete result checked')
    assert.equal(ui.status.dataset.error,'true')
    assert.equal(ui.select('[data-avatar-remove]').hidden,false)
    ui.handlers.avatarFetch=async()=>{ui.identity=avatarMember({banned:true,can_post:false,avatar_path:null});return new Response('[]')}
    ui.select('[data-avatar-remove]').click(); ui.select('dialog').close('confirm')
    await until(()=>ui.select('[data-avatar-remove]').hidden && ui.status.dataset.error==='false','confirmed avatar removed')
    assert.equal(ui.select('[data-identity-avatar]').querySelector('img'),null)
    assert.equal(ui.status.parentElement,ui.select('[data-status-home]'))
  })

  test(`${language}: unsupported avatar paths never create a third-party image request`,async context=>{
    const ui=await setup(context,language,{identity:avatarMember({avatar_path:'https://tracker.example/a.jpg'}),rows:[row(1,{avatar_path:'../secret.jpg?v=1'}),row(2,{avatar_path:`${avatarKey}.jpg?v=1&email=private@example.com`})]})
    assert.equal(ui.select('[data-identity-avatar]').querySelector('img'),null)
    assert.equal(ui.select('[data-list]').querySelector('img'),null)
  })
}

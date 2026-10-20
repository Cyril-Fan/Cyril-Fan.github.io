import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse } from 'node-html-parser'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(project, 'src/lib/comment-auth.ts')
const source = readFileSync(sourcePath, 'utf8')
const fixtureKey = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`
const configuredEnv = { PUBLIC_SUPABASE_URL: 'https://comment-test.supabase.co', PUBLIC_SUPABASE_ANON_KEY: fixtureKey }
const tick = () => new Promise((resolve) => setImmediate(resolve))

class Field extends EventTarget {
  value = ''
  hidden = false
  disabled = false
  required = false
  dataset = {}
  textContent = ''
  attributes = new Map()
  focused = false
  setAttribute(key, value) { this.attributes.set(key, value) }
  removeAttribute(key) { this.attributes.delete(key) }
  focus() { this.focused = true }
  reportValidity() { return true }
}

function runtime({ env = configuredEnv, href = 'https://cyril-fan.top/blog/note', unavailableStorage = false, auth = {} } = {}) {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) }
  }
  const window = Object.assign(new EventTarget(), {
    location: new URL(href),
    setTimeout: (callback) => { queueMicrotask(callback); return 1 },
    history: {
      state: null,
      replaceState(_state, _unused, target) { window.location = new URL(target, window.location.origin) }
    }
  })
  if (unavailableStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked storage') } })
  else window.localStorage = storage

  const calls = []
  const recoveryProviders = []
  function makeProvider(kind) {
    let currentSession = null
    return {
    setSession(session) { currentSession = session },
    auth: {
      onAuthStateChange() { calls.push(['subscribe', kind]); return { data: { subscription: { unsubscribe() {} } } } },
      async getSession() { calls.push(['session', kind]); return { data: { session: currentSession }, error: null } },
      async getUser() { return { data: { user: currentSession?.user ?? null }, error: null } },
      async signInWithPassword(input) {
        calls.push(['login', input])
        currentSession = { user: { id: 'user-a', email_confirmed_at: '2026-10-19T00:00:00Z' } }
        return { data: { session: currentSession, user: currentSession.user }, error: null }
      },
      async signUp(input) { calls.push(['signup', input]); return { data: { user: null, session: null }, error: null } },
      async resetPasswordForEmail(email, options) { calls.push(['recover', email, options]); return { data: {}, error: null } },
      async resend(input) { calls.push(['resend', input]); return { data: {}, error: null } },
      async verifyOtp(input) {
        calls.push(['verify', input, kind])
        currentSession = { user: { id: 'user-a', email_confirmed_at: '2026-10-19T00:00:00Z' } }
        return { data: { session: currentSession, user: currentSession.user }, error: null }
      },
      async updateUser(input) { calls.push(['password', input, kind, currentSession?.user.id]); return { data: { user: currentSession?.user }, error: null } },
      async signOut(input) { calls.push(['logout', input, kind, currentSession?.user.id]); currentSession = null; return { error: null } },
      async stopAutoRefresh() {},
      async dispose() { calls.push(['dispose', kind]) },
      ...auth
    }
  } }
  const provider = makeProvider('normal')

  const module = { exports: {} }
  const compiled = ts.transpileModule(source.replaceAll('import.meta.env', '__testEnv'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', '__testEnv', 'window', 'CustomEvent', 'atob', compiled)(
    (specifier) => {
      assert.equal(specifier, '@supabase/supabase-js')
      return { createClient(url, key, options) {
        calls.push(['client', url, key, options])
        if (options.auth.persistSession === false) {
          const recovery = makeProvider('recovery')
          recoveryProviders.push(recovery)
          return recovery
        }
        return provider
      } }
    }, module, module.exports, env, window, CustomEvent, atob
  )

  const elements = new Map()
  class Element extends Field {
    isConnected = true
    dataset = { lang: 'zh' }
    fields = new Map()
    modes = ['login', 'signup', 'recover', 'resend'].map((mode) => Object.assign(new Field(), { dataset: { mode } }))
    querySelector(selector) {
      if (!this.fields.has(selector)) this.fields.set(selector, new Field())
      return this.fields.get(selector)
    }
    querySelectorAll(selector) {
      if (selector === '[data-mode]') return this.modes
      if (selector === '[data-mode], [data-signout]') return [...this.modes, this.querySelector('[data-signout]')]
      if (selector === 'button, input') return [...this.fields.values()]
      return []
    }
  }

  function mount(component) {
    const content = readFileSync(path.join(project, 'src/components/advanced', component), 'utf8')
    const script = content.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    assert.ok(script)
    const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const registry = { get: (name) => elements.get(name), define: (name, constructor) => elements.set(name, constructor) }
    new Function('require', 'exports', 'window', 'HTMLElement', 'customElements', code)(
      () => module.exports, {}, window, Element, registry
    )
    const name = component === 'CommentAuth.astro' ? 'comment-auth' : 'auth-confirm'
    const element = new (elements.get(name))()
    element.connectedCallback()
    return element
  }

  return { api: module.exports, provider, recoveryProviders, calls, window, mount, values, setSession: provider.setSession, setRecoverySession(session) { recoveryProviders.at(-1)?.setSession(session) } }
}

test('missing or privileged public configuration stays disabled without creating a client', () => {
  for (const env of [ {}, { ...configuredEnv, PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_private' }, {
    ...configuredEnv,
    PUBLIC_SUPABASE_ANON_KEY: `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`
  } ]) {
    const instance = runtime({ env })
    assert.equal(instance.api.getCommentClient(), null)
    assert.equal(instance.api.createCommentRecoveryClient(), null)
    assert.equal(instance.api.getCommentAuthStatus().configured, false)
    assert.equal(instance.calls.length, 0)
  }
})

test('one shared client disables automatic URL consumption and isolates project storage', () => {
  const instance = runtime()
  assert.equal(instance.api.getCommentClient(), instance.api.getCommentClient())
  const creation = instance.calls.filter(([name]) => name === 'client')
  assert.equal(creation.length, 1)
  assert.equal(creation[0][3].auth.detectSessionInUrl, false)
  assert.equal(creation[0][3].auth.storageKey, 'cyril-comment-auth:comment-test.supabase.co')
})

test('recovery clients have separate in-memory sessions and unique keys without normal auth subscriptions', () => {
  const instance = runtime()
  const normal = instance.api.getCommentClient()
  const recoveryA = instance.api.createCommentRecoveryClient()
  const recoveryB = instance.api.createCommentRecoveryClient()
  assert.notEqual(recoveryA, normal)
  assert.notEqual(recoveryA, recoveryB)
  const options = instance.calls.filter(([name]) => name === 'client').map((call) => call[3].auth)
  assert.equal(options[1].persistSession, false)
  assert.equal(options[1].autoRefreshToken, false)
  assert.equal(options[1].detectSessionInUrl, false)
  assert.notEqual(options[1].storageKey, options[0].storageKey)
  assert.notEqual(options[1].storageKey, options[2].storageKey)
  assert.equal(instance.calls.filter(([name, kind]) => name === 'subscribe' && kind === 'recovery').length, 0)
})

test('blocked storage and later quota failure preserve this-tab auth without throwing', () => {
  const instance = runtime({ unavailableStorage: true })
  instance.api.getCommentClient()
  assert.equal(instance.api.getCommentAuthStatus().persistent, false)
  const adapter = instance.calls.find(([name]) => name === 'client')[3].auth.storage
  adapter.setItem('session', 'fixture-session')
  assert.equal(adapter.getItem('session'), 'fixture-session')
  adapter.removeItem('session')
  assert.equal(adapter.getItem('session'), null)

  let blocked = false
  const store = instance.api.createCommentAuthStorage({
    getItem: () => { if (blocked) throw new Error('blocked'); return null },
    setItem: () => { if (blocked) throw new Error('full') },
    removeItem: () => {}
  })
  blocked = true
  store.storage.setItem('session', 'new-session')
  assert.equal(store.storage.getItem('session'), 'new-session')
  assert.equal(store.persistent(), false)
})

test('email normalization preserves local parts and passwords count Unicode characters', () => {
  const { api } = runtime()
  assert.equal(api.normalizeAuthEmail('  First.Last+tag@EXAMPLE.COM  '), 'First.Last+tag@example.com')
  assert.equal(api.COMMENT_PASSWORD_MIN_LENGTH, 8)
  assert.equal(api.validateCommentPassword('1234567'), false)
  assert.equal(api.validateCommentPassword('12345678'), true)
  assert.equal(api.validateCommentPassword('abcdefgh'), true)
  assert.equal(api.validateCommentPassword('😀'.repeat(7)), false)
  assert.equal(api.validateCommentPassword('😀'.repeat(8)), true)
})

test('confirmation parser rejects duplicate, unsupported and malformed credentials without network activity', () => {
  const { api, calls } = runtime()
  const hash = 'a'.repeat(64)
  assert.deepEqual(api.parseEmailConfirmation(`https://cyril-fan.top/auth/confirm?token_hash=${hash}&type=email`), { tokenHash: hash, type: 'email' })
  assert.equal(api.parseEmailConfirmation(`https://cyril-fan.top/auth/confirm?token_hash=${hash}&type=invite`), null)
  assert.equal(api.parseEmailConfirmation(`https://cyril-fan.top/auth/confirm?token_hash=${hash}&type=email&type=recovery`), null)
  assert.equal(api.parseEmailConfirmation('https://cyril-fan.top/auth/confirm?token_hash=short&type=email'), null)
  assert.equal(api.parseEmailConfirmation('https://cyril-fan.top/auth/confirm#access_token=token'), null)
  assert.equal(calls.length, 0)
})

test('opening a valid email link does not verify it; clicking confirms once and clears URL', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=email&next=https://untrusted.example` })
  const element = instance.mount('AuthConfirmPage.astro')
  await tick()
  assert.equal(instance.calls.filter(([name]) => name === 'verify').length, 0)
  await element.confirm()
  assert.equal(instance.calls.filter(([name]) => name === 'verify').length, 1)
  assert.equal(instance.window.location.href, 'https://cyril-fan.top/auth/confirm')
  assert.equal(instance.recoveryProviders.length, 0)
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-a')
  await element.confirm()
  assert.equal(instance.calls.filter(([name]) => name === 'verify').length, 1)
})

test('invalid fragment links are erased without creating a session or accepting a redirect', () => {
  const instance = runtime({ href: 'https://cyril-fan.top/auth/confirm#access_token=private&refresh_token=private' })
  const element = instance.mount('AuthConfirmPage.astro')
  assert.equal(instance.calls.filter(([name]) => name === 'verify').length, 0)
  assert.equal(instance.window.location.hash, '')
  assert.match(element.querySelector('[data-message]').textContent, /缺少有效验证/)
})

test('legacy short passwords can sign in; registration rejects 7 and accepts 8 characters without forced combinations', async () => {
  const instance = runtime()
  const element = instance.mount('CommentAuth.astro')
  await tick()
  element.querySelector('[name=email]').value = 'Me@EXAMPLE.COM'
  element.querySelector('[name=password]').value = 'short'
  await element.submit({ preventDefault() {} })
  assert.equal(instance.calls.filter(([name]) => name === 'login').length, 1)
  assert.equal(instance.calls.find(([name]) => name === 'login')[1].email, 'Me@example.com')
  const registration = runtime()
  const signup = registration.mount('CommentAuth.astro')
  await tick()
  signup.setMode('signup')
  signup.querySelector('[name=email]').value = 'person@example.com'
  signup.querySelector('[name=password]').value = 'abcdefg'
  await signup.submit({ preventDefault() {} })
  assert.equal(registration.calls.filter(([name]) => name === 'signup').length, 0)
  assert.equal(signup.querySelector('[name=password]').minLength, 8)
  assert.match(signup.querySelector('[data-message]').textContent, /8 个字符/)
  signup.querySelector('[name=password]').value = 'abcdefgh'
  await signup.submit({ preventDefault() {} })
  assert.equal(registration.calls.find(([name]) => name === 'signup')[1].password, 'abcdefgh')
})

test('sign-in failures keep input and never render provider errors containing private data', async () => {
  const instance = runtime({ auth: { async signInWithPassword() { return { data: {}, error: { code: 'invalid_credentials', message: 'private@example.com secret-token' } } } } })
  const element = instance.mount('CommentAuth.astro')
  await tick()
  element.querySelector('[name=email]').value = 'private@example.com'
  element.querySelector('[name=password]').value = 'keep-this-password'
  await element.submit({ preventDefault() {} })
  assert.equal(element.querySelector('[name=password]').value, 'keep-this-password')
  assert.doesNotMatch(element.querySelector('[data-message]').textContent, /private@example\.com|secret-token/)
})

test('an unverified sign-in session is signed out and does not receive success feedback', async () => {
  const instance = runtime({ auth: { async signInWithPassword() { return { data: { session: {}, user: { id: 'unverified', email_confirmed_at: null } }, error: null } } } })
  const element = instance.mount('CommentAuth.astro')
  await tick()
  element.querySelector('[name=email]').value = 'person@example.com'
  element.querySelector('[name=password]').value = 'keep-this-password'
  await element.submit({ preventDefault() {} })
  assert.deepEqual(instance.calls.find(([name]) => name === 'logout')[1], { scope: 'local' })
  assert.match(element.querySelector('[data-message]').textContent, /先完成邮箱验证/)
  assert.equal(element.querySelector('[name=password]').value, 'keep-this-password')
})

test('the bounded fetch preserves caller cancellation rather than leaving a hung account action', async () => {
  const instance = runtime()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (_input, options) => {
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    }
    const cancellation = new AbortController()
    const pending = instance.api.commentAuthFetch('https://comment-test.supabase.co/auth/v1/token', { signal: cancellation.signal })
    cancellation.abort()
    await assert.rejects(pending, { name: 'AbortError' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('registration uses a fixed redirect, masks existing accounts, and throttles repeat email requests', async () => {
  const instance = runtime({ auth: { async signUp(input) { instance.calls.push(['signup', input]); return { data: {}, error: { code: 'user_already_exists', message: 'exists' } } } } })
  const element = instance.mount('CommentAuth.astro')
  await tick()
  element.setMode('signup')
  element.querySelector('[name=email]').value = 'person@example.com'
  element.querySelector('[name=password]').value = 'a-long-new-password'
  await element.submit({ preventDefault() {} })
  const request = instance.calls.find(([name]) => name === 'signup')[1]
  assert.equal(request.options.emailRedirectTo, 'https://cyril-fan.top/auth/confirm')
  assert.match(element.querySelector('[data-message]').textContent, /若该邮箱符合/)
  assert.equal(element.querySelector('[name=password]').value, '')
  element.querySelector('[name=password]').value = 'a-long-new-password'
  await element.submit({ preventDefault() {} })
  assert.equal(instance.calls.filter(([name]) => name === 'signup').length, 1)
})

test('recovery and resend work without a password and use the English confirmation route when requested', async () => {
  for (const mode of ['recover', 'resend']) {
    const instance = runtime()
    const element = instance.mount('CommentAuth.astro')
    element.dataset.lang = 'en'
    await tick()
    element.setMode(mode)
    element.querySelector('[name=email]').value = 'person@example.com'
    assert.equal(element.querySelector('[name=password]').required, false)
    await element.submit({ preventDefault() {} })
    const call = instance.calls.find(([name]) => name === mode)
    assert.ok(call)
    assert.equal(mode === 'recover' ? call[2].redirectTo : call[1].options.emailRedirectTo, 'https://cyril-fan.top/en/auth/confirm')
    assert.match(element.querySelector('[data-message]').textContent, /If this email is eligible/)
  }
})

test('simultaneous confirmation clicks issue one verification request', async () => {
  let complete
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=email`, auth: {
    async verifyOtp(input) { instance.calls.push(['verify', input]); return await new Promise((resolve) => { complete = resolve }) }
  } })
  const element = instance.mount('AuthConfirmPage.astro')
  const first = element.confirm()
  await element.confirm()
  assert.equal(instance.calls.filter(([name]) => name === 'verify').length, 1)
  complete({ data: { user: { id: 'user-a' }, session: {} }, error: null })
  await first
})

test('recovery verifies before allowing a password update, clears inputs, then signs out globally', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery` })
  const element = instance.mount('AuthConfirmPage.astro')
  await element.updatePassword({ preventDefault() {} })
  assert.equal(instance.calls.filter(([name]) => name === 'password').length, 0)
  await element.confirm()
  element.querySelector('[name=password]').value = 'abcdefg'
  element.querySelector('[name=repeat]').value = 'abcdefg'
  await element.updatePassword({ preventDefault() {} })
  assert.equal(instance.calls.filter(([name]) => name === 'password').length, 0)
  assert.match(element.querySelector('[data-message]').textContent, /8 个字符/)
  element.querySelector('[name=password]').value = 'abcdefgh'
  element.querySelector('[name=repeat]').value = 'abcdefgh'
  await element.updatePassword({ preventDefault() {} })
  assert.deepEqual(instance.calls.filter(([name]) => ['verify', 'password', 'logout'].includes(name)).map(([name]) => name), ['verify', 'password', 'logout'])
  assert.deepEqual(instance.calls.find(([name]) => name === 'logout')[1], { scope: 'global' })
  assert.equal(instance.calls.find(([name]) => name === 'password')[1].password, 'abcdefgh')
  assert.equal(element.querySelector('[name=password]').value, '')
  assert.equal(element.querySelector('[name=repeat]').value, '')
})

test('switching the ordinary account leaves password update and global sign-out bound to the recovered user', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery` })
  const element = instance.mount('AuthConfirmPage.astro')
  await element.confirm()
  instance.setSession({ user: { id: 'user-b', email_confirmed_at: '2026-10-19T00:00:00Z' } })
  element.querySelector('[name=password]').value = 'this-is-a-new-password'
  element.querySelector('[name=repeat]').value = 'this-is-a-new-password'
  await element.updatePassword({ preventDefault() {} })
  assert.equal(instance.calls.find(([name]) => name === 'password')[3], 'user-a')
  assert.equal(instance.calls.find(([name]) => name === 'logout')[3], 'user-a')
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-b')
})

test('a normal-account switch precisely after recovery getUser cannot change the password or logout target', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery` })
  instance.setSession({ user: { id: 'user-b-before', email_confirmed_at: '2026-10-19T00:00:00Z' } })
  const element = instance.mount('AuthConfirmPage.astro')
  await element.confirm()
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-b-before')
  const recovery = instance.recoveryProviders[0]
  const getRecoveredUser = recovery.auth.getUser
  recovery.auth.getUser = async () => {
    const result = await getRecoveredUser()
    instance.setSession({ user: { id: 'user-b-after', email_confirmed_at: '2026-10-19T00:00:00Z' } })
    return result
  }
  element.querySelector('[name=password]').value = 'this-is-a-new-password'
  element.querySelector('[name=repeat]').value = 'this-is-a-new-password'
  await element.updatePassword({ preventDefault() {} })
  assert.equal(instance.calls.find(([name]) => name === 'password')[3], 'user-a')
  assert.equal(instance.calls.find(([name]) => name === 'logout')[3], 'user-a')
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-b-after')
})

test('an authorized password save still signs out the recovered session after disconnect and normal account replacement', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery` })
  const element = instance.mount('AuthConfirmPage.astro')
  await element.confirm()
  const recovery = instance.recoveryProviders[0]
  const save = recovery.auth.updateUser
  let finishSave
  recovery.auth.updateUser = async (input) => {
    await new Promise((resolve) => { finishSave = resolve })
    return await save(input)
  }
  element.querySelector('[name=password]').value = 'snapshot-password-before-disconnect'
  element.querySelector('[name=repeat]').value = 'snapshot-password-before-disconnect'
  const pending = element.updatePassword({ preventDefault() {} })
  await tick()
  instance.setSession({ user: { id: 'user-b', email_confirmed_at: '2026-10-19T00:00:00Z' } })
  element.isConnected = false
  element.disconnectedCallback()
  finishSave()
  await pending
  const password = instance.calls.find(([name]) => name === 'password')
  assert.equal(password[1].password, 'snapshot-password-before-disconnect')
  assert.equal(password[3], 'user-a')
  const logout = instance.calls.find(([name]) => name === 'logout')
  assert.deepEqual(logout[1], { scope: 'global' })
  assert.equal(logout[3], 'user-a')
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-b')
  assert.equal(instance.calls.filter(([name, kind]) => name === 'dispose' && kind === 'recovery').length, 1)
})

test('disconnecting before a password save discards only the isolated recovery session', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery` })
  const element = instance.mount('AuthConfirmPage.astro')
  instance.setSession({ user: { id: 'user-b', email_confirmed_at: '2026-10-19T00:00:00Z' } })
  await element.confirm()
  element.isConnected = false
  element.disconnectedCallback()
  await tick()
  const logout = instance.calls.find(([name]) => name === 'logout')
  assert.deepEqual(logout[1], { scope: 'local' })
  assert.equal(logout[3], 'user-a')
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-b')
})

test('password saved plus failed sign-out is reported honestly and exposes retry', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery`, auth: {
    async signOut(input) { instance.calls.push(['logout', input]); return { error: { status: 503 } } }
  } })
  const element = instance.mount('AuthConfirmPage.astro')
  await element.confirm()
  element.querySelector('[name=password]').value = 'this-is-a-new-password'
  element.querySelector('[name=repeat]').value = 'this-is-a-new-password'
  await element.updatePassword({ preventDefault() {} })
  assert.match(element.querySelector('[data-message]').textContent, /密码已保存，但退出尚未完成/)
  assert.equal(element.querySelector('[data-signout-retry]').hidden, false)
  assert.equal(element.querySelector('[name=password]').value, '')
})

test('recovery sign-out retry cannot target the ordinary account selected in another tab', async () => {
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=recovery` })
  const element = instance.mount('AuthConfirmPage.astro')
  await element.confirm()
  const recovery = instance.recoveryProviders[0]
  const signOut = recovery.auth.signOut
  recovery.auth.signOut = async () => ({ error: { status: 503 } })
  element.querySelector('[name=password]').value = 'this-is-a-new-password'
  element.querySelector('[name=repeat]').value = 'this-is-a-new-password'
  await element.updatePassword({ preventDefault() {} })
  instance.setSession({ user: { id: 'user-b', email_confirmed_at: '2026-10-19T00:00:00Z' } })
  recovery.auth.signOut = signOut
  await element.finishSignOut()
  assert.equal(instance.calls.find(([name]) => name === 'logout')[3], 'user-a')
  assert.equal((await instance.provider.auth.getSession()).data.session.user.id, 'user-b')
})

test('disconnect aborts component listeners and stops later auth-event refreshes', async () => {
  const instance = runtime()
  const element = instance.mount('CommentAuth.astro')
  await tick()
  const controller = element.controller
  element.isConnected = false
  element.disconnectedCallback()
  assert.equal(controller.signal.aborted, true)
  const requests = instance.calls.filter(([name]) => name === 'session').length
  instance.api.emitCommentAuthChange()
  await tick()
  assert.equal(instance.calls.filter(([name]) => name === 'session').length, requests)
})

test('a confirmation response arriving after disconnect does not modify the next page URL', async () => {
  let complete
  const instance = runtime({ href: `https://cyril-fan.top/auth/confirm?token_hash=${'a'.repeat(64)}&type=email`, auth: {
    async verifyOtp(input) { instance.calls.push(['verify', input]); return await new Promise((resolve) => { complete = resolve }) }
  } })
  const element = instance.mount('AuthConfirmPage.astro')
  const pending = element.confirm()
  element.isConnected = false
  element.disconnectedCallback()
  instance.window.location = new URL('https://cyril-fan.top/search?query=preserve-this')
  complete({ data: { user: { id: 'user-a' }, session: {} }, error: null })
  await pending
  assert.equal(instance.window.location.search, '?query=preserve-this')
})

test('an old sign-in failure cannot overwrite feedback after the component reconnects', async () => {
  let fail
  const instance = runtime({ auth: { async signInWithPassword() { return await new Promise((_resolve, reject) => { fail = reject }) } } })
  const element = instance.mount('CommentAuth.astro')
  await tick()
  element.querySelector('[name=email]').value = 'person@example.com'
  element.querySelector('[name=password]').value = 'old-connection-password'
  const pending = element.submit({ preventDefault() {} })
  element.isConnected = false
  element.disconnectedCallback()
  element.isConnected = true
  element.connectedCallback()
  await tick()
  element.querySelector('[data-message]').textContent = 'new connection feedback'
  fail({ code: 'invalid_credentials' })
  await pending
  assert.equal(element.querySelector('[data-message]').textContent, 'new connection feedback')
  assert.equal(element.querySelector('[name=password]').value, '')
})

test('auth module and actual component scripts type-check against the installed SDK', () => {
  const virtual = new Map()
  for (const name of ['CommentAuth.astro', 'AuthConfirmPage.astro']) {
    const file = path.join(project, 'src/components/advanced', name)
    virtual.set(`${file}.ts`.replaceAll('\\', '/'), readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1])
  }
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: []
  }
  const host = ts.createCompilerHost(options)
  const originalRead = host.readFile
  const originalExists = host.fileExists
  const originalSource = host.getSourceFile
  host.readFile = (file) => virtual.get(file) ?? originalRead(file)
  host.fileExists = (file) => virtual.has(file) || originalExists(file)
  host.getSourceFile = (file, target, onError, createNew) => virtual.has(file)
    ? ts.createSourceFile(file, virtual.get(file), target, true)
    : originalSource(file, target, onError, createNew)
  const program = ts.createProgram([sourcePath, ...virtual.keys(), path.join(project, 'node_modules/astro/client.d.ts')], options, host)
  const problems = ts.getPreEmitDiagnostics(program)
  assert.equal(problems.length, 0, problems.map((issue) => `${issue.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(issue.messageText, '\n')}`).join('\n'))
})

test('confirmation page has early no-referrer, noindex and no auto-consuming OAuth fallback', () => {
  const page = readFileSync(path.join(project, 'src/components/advanced/AuthConfirmPage.astro'), 'utf8')
  assert.ok(page.indexOf("name='referrer' content='no-referrer'") < page.indexOf('<ThemeProvider'))
  assert.match(page, /name='robots' content='noindex, nofollow'/)
  assert.doesNotMatch(page, /exchangeCodeForSession|setSession\(|https?:\/\/[^'"\s]+/)
  const markup = parse(page)
  assert.equal(markup.querySelector('#recovery-password').getAttribute('minlength'), '8')
  assert.equal(markup.querySelector('#recovery-password-repeat').getAttribute('minlength'), '8')
})

test('email templates target our explicit confirmation page without token pre-consumption or remote assets', () => {
  for (const [file, type] of [['confirm-signup.html', 'email'], ['recovery.html', 'recovery']]) {
    const template = readFileSync(path.join(project, 'supabase/email-templates', file), 'utf8')
    assert.doesNotMatch(template, /\.ConfirmationURL|<script|<img|<link|https?:\/\//i)
    const markup = parse(template.replaceAll('{{ .RedirectTo }}', 'https://cyril-fan.top/en/auth/confirm').replaceAll('{{ .TokenHash }}', 'a'.repeat(64)))
    const link = new URL(markup.querySelector('a').getAttribute('href'))
    assert.equal(link.origin, 'https://cyril-fan.top')
    assert.equal(link.pathname, '/en/auth/confirm')
    assert.equal(link.searchParams.get('type'), type)
    assert.equal(link.searchParams.get('token_hash'), 'a'.repeat(64))
  }
})

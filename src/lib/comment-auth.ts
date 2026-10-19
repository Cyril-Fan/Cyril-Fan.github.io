import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type CommentAuthLanguage = 'zh' | 'en'
export type ConfirmationType = 'email' | 'signup' | 'recovery'
export type EmailConfirmation = { tokenHash: string; type: ConfirmationType }

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type AuthErrorLike = { code?: string; status?: number; name?: string }

export const COMMENT_AUTH_EVENT = 'comment-auth-change'
export const COMMENT_PASSWORD_MIN_LENGTH = 8

let client: SupabaseClient | null = null
let initialized = false
let persistentSession = false
let invalidConfiguration = false

/** Public configuration only. A privileged key is never accepted by the browser client. */
export function isCommentAuthConfigurationValid(url: string, key: string): boolean {
  try {
    const endpoint = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) return false
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false
    if (!key || key.startsWith('sb_secret_')) return false
    if (key.startsWith('sb_publishable_')) return key.length > 'sb_publishable_'.length
    const payload = key.split('.')[1]
    if (!payload) return false
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    return claims.role === 'anon'
  } catch {
    return false
  }
}

/** Keep the tab usable when storage is unavailable or becomes full after login. */
export function createCommentAuthStorage(storage?: BrowserStorage) {
  const memory = new Map<string, string>()
  let backingStore = storage
  if (backingStore) {
    try {
      const probe = 'cyril-comment-auth:storage-probe'
      backingStore.setItem(probe, '1')
      backingStore.removeItem(probe)
    } catch {
      backingStore = undefined
    }
  }

  return {
    persistent: () => Boolean(backingStore),
    storage: {
      getItem(key: string): string | null {
        if (backingStore) {
          try {
            const value = backingStore.getItem(key)
            if (value !== null) memory.set(key, value)
            else memory.delete(key)
            return value
          } catch {
            backingStore = undefined
          }
        }
        return memory.get(key) ?? null
      },
      setItem(key: string, value: string): void {
        memory.set(key, value)
        if (backingStore) {
          try {
            backingStore.setItem(key, value)
          } catch {
            backingStore = undefined
          }
        }
      },
      removeItem(key: string): void {
        memory.delete(key)
        if (backingStore) {
          try {
            backingStore.removeItem(key)
          } catch {
            backingStore = undefined
          }
        }
      }
    }
  }
}

let storageState: ReturnType<typeof createCommentAuthStorage> | undefined

export function emitCommentAuthChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(COMMENT_AUTH_EVENT))
}

/** Bound individual network attempts so account controls can recover from stalled connections. */
export async function commentAuthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const abortFromCaller = () => controller.abort()
  if (callerSignal?.aborted) controller.abort()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export function getCommentClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null
  if (initialized) return client
  initialized = true

  const url = String(import.meta.env.PUBLIC_SUPABASE_URL ?? '').trim()
  const key = String(import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!isCommentAuthConfigurationValid(url, key)) {
    invalidConfiguration = Boolean(url || key)
    return null
  }

  let storage: Storage | undefined
  try {
    storage = window.localStorage
  } catch {
    // Some browsers deny even reading the localStorage property.
  }
  storageState = createCommentAuthStorage(storage)
  persistentSession = storageState.persistent()

  try {
    client = createClient(url, key, {
      global: { fetch: commentAuthFetch },
      auth: {
        storage: storageState.storage,
        storageKey: `cyril-comment-auth:${new URL(url).host}`,
        persistSession: true,
        autoRefreshToken: true,
        // Email links are consumed only by the explicit confirmation button.
        detectSessionInUrl: false,
        flowType: 'pkce'
      }
    })
    client.auth.onAuthStateChange(() => {
      // Dispatch outside the SDK callback lock: consumers may call getUser().
      window.setTimeout(emitCommentAuthChange, 0)
    })
  } catch {
    invalidConfiguration = true
    client = null
  }
  return client
}

/** Password recovery must never overwrite or operate on the ordinary sign-in session. */
export function createCommentRecoveryClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null
  const url = String(import.meta.env.PUBLIC_SUPABASE_URL ?? '').trim()
  const key = String(import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!isCommentAuthConfigurationValid(url, key)) return null
  try {
    return createClient(url, key, {
      global: { fetch: commentAuthFetch },
      auth: {
        storage: createCommentAuthStorage().storage,
        storageKey: `cyril-comment-recovery:${crypto.randomUUID()}`,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce'
      }
    })
  } catch {
    return null
  }
}

export function getCommentAuthStatus() {
  if (typeof window !== 'undefined' && !initialized) getCommentClient()
  persistentSession = storageState?.persistent() ?? persistentSession
  return {
    configured: Boolean(client),
    persistent: persistentSession,
    reason: invalidConfiguration ? 'invalid-configuration' : client ? undefined : 'missing-configuration'
  }
}

/** Preserve local-part spelling; normalize only the email domain. */
export function normalizeAuthEmail(value: string): string {
  const trimmed = value.trim()
  const separator = trimmed.lastIndexOf('@')
  return separator < 0
    ? trimmed
    : `${trimmed.slice(0, separator)}@${trimmed.slice(separator + 1).toLowerCase()}`
}

export function validateCommentPassword(value: string): boolean {
  return Array.from(value).length >= COMMENT_PASSWORD_MIN_LENGTH
}

/** The destination is always this site's confirmation page; no user-provided return URL. */
export function getAuthRedirectUrl(language: CommentAuthLanguage, origin = window.location.origin): string {
  return new URL(language === 'en' ? '/en/auth/confirm' : '/auth/confirm', origin).href
}

/** Parsing a link never authenticates or consumes it. */
export function parseEmailConfirmation(href: string): EmailConfirmation | null {
  try {
    const url = new URL(href)
    if (url.searchParams.getAll('token_hash').length !== 1 || url.searchParams.getAll('type').length !== 1) return null
    const tokenHash = url.searchParams.get('token_hash') ?? ''
    const type = url.searchParams.get('type')
    if (!/^[a-zA-Z0-9_-]{32,512}$/.test(tokenHash)) return null
    if (type !== 'email' && type !== 'signup' && type !== 'recovery') return null
    return { tokenHash, type }
  } catch {
    return null
  }
}

/** Clear authentication data before navigating away or reporting successful confirmation. */
export function clearAuthUrl(): void {
  window.history.replaceState(window.history.state, '', window.location.pathname)
}

export function authMessage(error: unknown, language: CommentAuthLanguage, action: 'login' | 'mail' | 'confirm' | 'password' | 'logout'): string {
  const issue = (error && typeof error === 'object' ? error : {}) as AuthErrorLike
  const english = language === 'en'
  if (issue.status === 429 || issue.code?.includes('rate_limit')) {
    return english ? 'Too many requests. Please wait a few minutes and try again.' : '操作过于频繁，请稍等几分钟后重试。'
  }
  if (issue.name === 'AuthRetryableFetchError' || issue.name === 'TypeError' || issue.name === 'AbortError' || issue.status === 0) {
    return english ? 'The service could not be reached. Check your connection and retry; your input is still here.' : '暂时无法连接服务，请检查网络后重试；填写内容已保留。'
  }
  if (issue.status && issue.status >= 500) return english ? 'The account service is temporarily unavailable. Please retry later.' : '账户服务暂时不可用，请稍后重试。'
  if (action === 'login') return english ? 'Sign-in failed. Check your email and password, and confirm your email first.' : '登录未成功，请检查邮箱和密码，并先完成邮箱验证。'
  if (action === 'confirm') return english ? 'This link is invalid, expired, or already used. Request a new email and try its latest link.' : '链接无效、已过期或已使用，请重新申请邮件并使用最新链接。'
  if (action === 'password') return english ? 'The password could not be updated. Use a new password of at least 8 characters, or request a fresh recovery email.' : '密码未能更新。请使用至少 8 个字符的新密码，或重新申请找回邮件。'
  if (action === 'logout') return english ? 'Sign-out could not be completed. Please retry before leaving a shared device.' : '未能完成退出，请重试；使用共享设备时请确认退出后再离开。'
  return english ? 'The email request could not be completed. Please try again later.' : '邮件请求未能完成，请稍后重试。'
}

/** Mask account existence in email-request UX; never show raw provider errors. */
export function isPrivateMailResponse(error: unknown): boolean {
  const issue = (error && typeof error === 'object' ? error : {}) as AuthErrorLike
  return ['user_already_exists', 'email_exists', 'user_not_found', 'email_not_confirmed', 'validation_failed'].includes(issue.code ?? '')
}

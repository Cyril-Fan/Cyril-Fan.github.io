/** Comment avatars are local uploads. Email addresses and email hashes never enter an avatar URL. */
export const AVATAR_INPUT_MAX_BYTES = 8 * 1024 * 1024
export const AVATAR_MAX_BYTES = 128 * 1024
export const AVATAR_SIZE = 256
const MAX_PIXELS = 20_000_000
const MAX_EDGE = 8192
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg\?v=([0-9]{1,20})$/
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export class CommentAvatarError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'CommentAvatarError' }
}
const fail = (code: string): never => { throw new CommentAvatarError(code) }
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError') }

function projectOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { return fail('avatar_configuration') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return fail('avatar_configuration')
  return url.origin
}

/** The path is data returned by our RPC, never a complete user-provided URL. */
export function commentAvatarUrl(supabaseUrl: string, avatarPath: string | null | undefined): string | null {
  if (!avatarPath || !PATH.test(avatarPath)) return null
  try { return `${projectOrigin(supabaseUrl)}/storage/v1/object/public/comment-avatars/${avatarPath}` } catch { return null }
}

function dimensions(width: number, height: number) {
  if (!width || !height) return fail('avatar_invalid_image')
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) return fail('avatar_dimensions')
  return { width, height }
}

/** Read dimensions before browser decoding, so a tiny compressed pixel bomb is rejected early. */
export function inspectCommentAvatar(bytes: Uint8Array, type: string): { width: number; height: number } {
  if (!TYPES.has(type)) return fail('avatar_format')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (type === 'image/png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) || view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') return fail('avatar_invalid_image')
    const size = dimensions(view.getUint32(16), view.getUint32(20))
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset)
      if (length > bytes.length - offset - 12) return fail('avatar_invalid_image')
      const chunk = ascii(offset + 4, 4)
      if (chunk === 'acTL') return fail('avatar_animation')
      if (chunk === 'IEND') return size
      offset += length + 12
    }
    return fail('avatar_invalid_image')
  }
  if (type === 'image/webp') {
    if (bytes.length < 20 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) return fail('avatar_invalid_image')
    let size: { width: number; height: number } | undefined
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = ascii(offset, 4), length = view.getUint32(offset + 4, true), data = offset + 8
      if (length > bytes.length - data) return fail('avatar_invalid_image')
      if (chunk === 'ANIM' || chunk === 'ANMF') return fail('avatar_animation')
      if (chunk === 'VP8X') {
        if (length !== 10) return fail('avatar_invalid_image')
        if (bytes[data] & 2) return fail('avatar_animation')
        const u24 = (at: number) => bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16)
        size = dimensions(u24(data + 4) + 1, u24(data + 7) + 1)
      } else if (chunk === 'VP8 ') {
        if (length < 10 || bytes[data] & 1 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return fail('avatar_invalid_image')
        const frame = dimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff)
        size ??= frame
      } else if (chunk === 'VP8L') {
        if (length < 5 || bytes[data] !== 0x2f) return fail('avatar_invalid_image')
        const bits = view.getUint32(data + 1, true)
        const frame = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
        size ??= frame
      }
      offset = data + length + (length % 2)
    }
    return size ?? fail('avatar_invalid_image')
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail('avatar_invalid_image')
  for (let offset = 2; offset < bytes.length;) {
    if (bytes[offset++] !== 0xff) return fail('avatar_invalid_image')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return fail('avatar_invalid_image')
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return fail('avatar_invalid_image')
    const length = view.getUint16(offset)
    if (length < 2 || length > bytes.length - offset) return fail('avatar_invalid_image')
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return fail('avatar_invalid_image')
      return dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3))
    }
    offset += length
  }
  return fail('avatar_invalid_image')
}

type DecodedAvatar = CanvasImageSource & { width: number; height: number }
export type AvatarImageEnvironment = {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
  decode(url: string, signal?: AbortSignal): Promise<DecodedAvatar>
  createCanvas(): HTMLCanvasElement
}
function imageEnvironment(): AvatarImageEnvironment {
  return {
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    createCanvas: () => document.createElement('canvas'),
    decode: (url, signal) => new Promise((resolve, reject) => {
      const image = new Image()
      const finish = (error?: Error) => {
        image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort)
        if (error) { image.src = ''; reject(error) }
        else resolve(image)
      }
      const abort = () => finish(new DOMException('Aborted', 'AbortError'))
      if (signal?.aborted) { abort(); return }
      signal?.addEventListener('abort', abort, { once: true })
      image.onload = () => finish()
      image.onerror = () => finish(new CommentAvatarError('avatar_invalid_image'))
      // Browsers apply JPEG EXIF orientation here. Crop the decoded dimensions,
      // not the unrotated SOF dimensions. Canvas encoding drops all source metadata.
      image.src = url
    })
  }
}

export async function prepareCommentAvatar(file: Blob, options: { signal?: AbortSignal; environment?: AvatarImageEnvironment } = {}): Promise<Blob> {
  const { signal } = options
  checkAbort(signal)
  if (!file.size || file.size > AVATAR_INPUT_MAX_BYTES) return fail('avatar_file_size')
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Downloaded pictures sometimes have a wrong extension or no MIME type.
  // Trust the actual bytes, then decode a correctly labelled local Blob.
  const signature = String.fromCharCode(...bytes.subarray(0, 12))
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ? 'image/png'
    : signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP' ? 'image/webp'
    : fail('avatar_format')
  inspectCommentAvatar(bytes, type)
  checkAbort(signal)
  const env = options.environment ?? imageEnvironment()
  const source = env.createObjectURL(new Blob([bytes], { type }))
  let canvas: HTMLCanvasElement | undefined
  try {
    const decoded = await env.decode(source, signal)
    checkAbort(signal)
    const { width, height } = dimensions(decoded.width, decoded.height)
    canvas = env.createCanvas(); canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) return fail('avatar_processing')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
    const side = Math.min(width, height)
    context.drawImage(decoded, (width - side) / 2, (height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const output = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/jpeg', quality))
      checkAbort(signal)
      if (!output || output.type !== 'image/jpeg' || !output.size) return fail('avatar_processing')
      if (output.size <= AVATAR_MAX_BYTES) return output
    }
    return fail('avatar_processing')
  } catch (error) {
    if (error instanceof CommentAvatarError || (error as Error)?.name === 'AbortError') throw error
    return fail('avatar_processing')
  } finally {
    env.revokeObjectURL(source)
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

type AvatarSessionClient = { auth: { getSession(): Promise<{ data: { session: { access_token: string; user: { id: string; email_confirmed_at?: string } } | null }; error: unknown }> } }
export type AvatarAuthorization = Readonly<{ origin: string; apiKey: string; accessToken: string; avatarKey: string; accountId: string }>
/** Keep this operation-local object in memory only. It intentionally snapshots the token. */
export async function captureAvatarAuthorization(client: AvatarSessionClient, expected: { accountId: string; avatarKey: string }, supabaseUrl: string, publishableKey: string, signal?: AbortSignal): Promise<AvatarAuthorization> {
  checkAbort(signal)
  if (!KEY.test(expected.avatarKey) || !expected.accountId) return fail('avatar_account_changed')
  const origin = projectOrigin(supabaseUrl)
  if (!publishableKey || publishableKey.startsWith('sb_secret_')) return fail('avatar_configuration')
  const { data, error } = await client.auth.getSession()
  checkAbort(signal)
  if (error || !data.session?.access_token || data.session.user.id !== expected.accountId || !data.session.user.email_confirmed_at) return fail('avatar_account_changed')
  return Object.freeze({ origin, apiKey: publishableKey, accessToken: data.session.access_token, avatarKey: expected.avatarKey, accountId: expected.accountId })
}

async function avatarStorageRequest(auth: AvatarAuthorization, method: 'POST' | 'DELETE', body: Blob | undefined, options: { signal?: AbortSignal; fetch?: typeof fetch }) {
  checkAbort(options.signal)
  if (!KEY.test(auth.avatarKey) || projectOrigin(auth.origin) !== auth.origin) return fail('avatar_configuration')
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 15_000)
  try {
    const response = await (options.fetch ?? fetch)(`${auth.origin}/storage/v1/object/comment-avatars${method === 'POST' ? `/${auth.avatarKey}.jpg` : ''}`, {
      method, body: method === 'POST' ? body : JSON.stringify({ prefixes: [`${auth.avatarKey}.jpg`] }),
      headers: { apikey: auth.apiKey, Authorization: `Bearer ${auth.accessToken}`, ...(method === 'POST' ? { 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'cache-control': 'max-age=60' } : { 'Content-Type': 'application/json' }) },
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
    })
    checkAbort(options.signal)
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return fail('avatar_permission')
      if (response.status === 413) return fail('avatar_file_size')
      return fail('avatar_network')
    }
  } catch (error) {
    checkAbort(options.signal)
    if (error instanceof CommentAvatarError) throw error
    return fail('avatar_network')
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
  }
}
export async function saveCommentAvatar(auth: AvatarAuthorization, jpeg: Blob, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<void> {
  if (jpeg.type !== 'image/jpeg' || !jpeg.size || jpeg.size > AVATAR_MAX_BYTES) return fail('avatar_file_size')
  await avatarStorageRequest(auth, 'POST', jpeg, options)
}
export async function removeCommentAvatar(auth: AvatarAuthorization, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<void> {
  await avatarStorageRequest(auth, 'DELETE', undefined, options)
}

export function commentAvatarMessage(error: unknown, en: boolean): string {
  const code = error instanceof CommentAvatarError ? error.code : 'avatar_processing'
  const messages: Record<string, [string, string]> = {
    avatar_format: ['请选择静态 JPEG、PNG 或 WebP 图片。', 'Choose a still JPEG, PNG, or WebP image.'],
    avatar_animation: ['暂不支持动图，请选择静态图片。', 'Animated images are not supported. Choose a still image.'],
    avatar_file_size: ['原图不能超过 8 MiB；保存的头像需小于 128 KiB。', 'The original must be at most 8 MiB; the saved avatar must be at most 128 KiB.'],
    avatar_dimensions: ['图片尺寸过大，请使用不超过 2000 万像素且单边不超过 8192 像素的图片。', 'Use an image with at most 20 megapixels and no side larger than 8,192 pixels.'],
    avatar_invalid_image: ['无法读取这张图片，请换一张有效的 JPEG、PNG 或 WebP 图片。', 'This image could not be read. Choose a valid JPEG, PNG, or WebP image.'],
    avatar_processing: ['头像处理失败，请换一张图片重试。', 'The avatar could not be processed. Try another image.'],
    avatar_configuration: ['头像服务暂不可用，请稍后重试。', 'The avatar service is unavailable. Please retry later.'],
    avatar_account_changed: ['登录状态已变化，请重新打开头像设置后重试。', 'Your account changed. Reopen avatar settings and try again.'],
    avatar_permission: ['暂时无法保存头像，请刷新确认登录状态和账户权限后重试。', 'The avatar could not be saved. Refresh to check your sign-in and account permissions.'],
    avatar_network: ['头像未能更新，请检查网络后重试；预览仍保留。', 'The avatar could not be updated. Check your connection and retry; the preview is kept.']
  }
  return (messages[code] ?? messages.avatar_processing)[en ? 1 : 0]
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import sharp from 'sharp'

const source = readFileSync(new URL('../src/lib/comment-avatar.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
Function('module', 'exports', code)(module, module.exports)
const { inspectCommentAvatar, prepareCommentAvatar, commentAvatarUrl, captureAvatarAuthorization, saveCommentAvatar, removeCommentAvatar, commentAvatarMessage, AVATAR_MAX_BYTES } = module.exports
const key = '20f34ef2-7542-482d-96c4-142dbf2be103'
const project = 'https://example.supabase.co'
const blob = new Blob(['encoded-jpeg'], { type: 'image/jpeg' })
const verified = id => ({ access_token: `${id}-token`, user: { id, email_confirmed_at: '2026-10-19T00:00:00Z' } })
const sessionClient = session => ({ auth: { getSession: async () => ({ data: { session }, error: null }) } })
const imageBytes = async format => sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.3 } } }).toFormat(format).toBuffer()
const inputImage = async format => new Blob([await imageBytes(format)], { type: `image/${format}` })
const errorCode = code => error => error.code === code

test('avatar URL permits only fixed project bucket and opaque versioned JPEG paths', () => {
  assert.equal(commentAvatarUrl(project, `${key}.jpg?v=1234567`), `${project}/storage/v1/object/public/comment-avatars/${key}.jpg?v=1234567`)
  for (const path of [null, '', key, `${key}.jpg`, `${key}.jpg?v=1&mail=a@example.com`, `${key}.jpg?v=1#x`, `${key}.jpg?v=-1`, `${key}.jpg?v=1e2`, `../${key}.jpg?v=1`, `https://example.org/${key}.jpg?v=1`, `//example.org/${key}.jpg?v=1`, `${key}.svg?v=1`]) assert.equal(commentAvatarUrl(project, path), null)
  for (const base of ['javascript:alert(1)', 'https://name:pass@example.org', `${project}/other`, `${project}?x=1`]) assert.equal(commentAvatarUrl(base, `${key}.jpg?v=1`), null)
})

for (const format of ['jpeg', 'png', 'webp']) test(`${format}: real encoded image headers expose the expected dimensions`, async () => {
  assert.deepEqual(inspectCommentAvatar(await imageBytes(format), `image/${format}`), { width: 800, height: 600 })
})

test('header inspection rejects format spoofing, broken lengths and oversized dimensions before decoding', async () => {
  const png = await imageBytes('png')
  assert.throws(() => inspectCommentAvatar(png, 'image/jpeg'), errorCode('avatar_invalid_image'))
  assert.throws(() => inspectCommentAvatar(png, 'image/svg+xml'), errorCode('avatar_format'))
  assert.throws(() => inspectCommentAvatar(png.subarray(0, 20), 'image/png'), errorCode('avatar_invalid_image'))
  const huge = Buffer.from(png); huge.writeUInt32BE(100_000, 16)
  assert.throws(() => inspectCommentAvatar(huge, 'image/png'), errorCode('avatar_dimensions'))
  const broken = Buffer.from(png); broken.writeUInt32BE(0xffffffff, 33)
  assert.throws(() => inspectCommentAvatar(broken, 'image/png'), errorCode('avatar_invalid_image'))
})

test('APNG and animated WebP are rejected even if their first frame could decode', async () => {
  const png = await imageBytes('png')
  const animation = Buffer.alloc(20); animation.writeUInt32BE(8); animation.write('acTL', 4)
  assert.throws(() => inspectCommentAvatar(Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]), 'image/png'), errorCode('avatar_animation'))
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBPVP8X', 8); webp.writeUInt32LE(10, 16); webp[20] = 2
  assert.throws(() => inspectCommentAvatar(webp, 'image/webp'), errorCode('avatar_animation'))
})

function processingEnvironment({ decodeError, size = AVATAR_MAX_BYTES - 1, width = 600, height = 800, signal } = {}) {
  const calls = [], revoked = [], canvas = { width: 0, height: 0, getContext: () => ({ set fillStyle(value) { calls.push(['fillStyle', value]) }, fillRect: (...args) => calls.push(['fill', ...args]), drawImage: (...args) => calls.push(['draw', ...args.slice(1)]) }), toBlob: (done, type, quality) => { calls.push(['encode', type, quality]); done(new Blob([new Uint8Array(size)], { type })) } }
  return { calls, revoked, canvas, environment: { createObjectURL: () => 'blob:original', revokeObjectURL: value => revoked.push(value), decode: async () => { if (decodeError) throw decodeError; if (signal) signal.abort(); return { width, height } }, createCanvas: () => canvas } }
}

test('preparation crops decoded orientation, adds white background, encodes only JPEG and releases original URL/canvas', async () => {
  const fixture = processingEnvironment()
  const result = await prepareCommentAvatar(await inputImage('jpeg'), { environment: fixture.environment })
  assert.equal(result.type, 'image/jpeg'); assert.ok(result.size <= AVATAR_MAX_BYTES)
  assert.deepEqual(fixture.calls.find(call => call[0] === 'draw'), ['draw', 0, 100, 600, 600, 0, 0, 256, 256], 'decoded portrait dimensions take precedence over landscape JPEG header')
  assert.deepEqual(fixture.calls.slice(0, 2), [['fillStyle', '#ffffff'], ['fill', 0, 0, 256, 256]])
  assert.deepEqual(fixture.revoked, ['blob:original']); assert.equal(fixture.canvas.width, 0)
})

test('preparation rejects oversized files before allocating image objects', async () => {
  let allocated = false
  await assert.rejects(prepareCommentAvatar(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), { environment: { createObjectURL() { allocated = true } } }), errorCode('avatar_file_size'))
  assert.equal(allocated, false)
})

test('preparation accepts incorrect or missing MIME when actual bytes are a supported still picture',async()=>{
  for(const type of ['image/png','', 'application/octet-stream']) {
    const fixture=processingEnvironment()
    let decodedType
    fixture.environment.createObjectURL=blob=>{decodedType=blob.type;return 'blob:original'}
    const jpeg=await prepareCommentAvatar(new Blob([await imageBytes('jpeg')],{type}),{environment:fixture.environment})
    assert.equal(decodedType,'image/jpeg'); assert.equal(jpeg.type,'image/jpeg')
  }
  await assert.rejects(prepareCommentAvatar(new Blob(['<svg/>'],{type:'image/jpeg'})),errorCode('avatar_format'))
  await assert.rejects(prepareCommentAvatar(new Blob(['GIF89a'],{type:'image/png'})),errorCode('avatar_format'))
})

test('decoding failure and account cancellation release object URLs', async () => {
  const failed = processingEnvironment({ decodeError: new Error('bad image') })
  await assert.rejects(prepareCommentAvatar(await inputImage('png'), { environment: failed.environment }), errorCode('avatar_processing'))
  assert.deepEqual(failed.revoked, ['blob:original'])
  const controller = new AbortController(), aborted = processingEnvironment({ signal: controller })
  await assert.rejects(prepareCommentAvatar(await inputImage('webp'), { signal: controller.signal, environment: aborted.environment }), error => error.name === 'AbortError')
  assert.deepEqual(aborted.revoked, ['blob:original'])
})

test('JPEG encoding never accepts an oversized result', async () => {
  const fixture = processingEnvironment({ size: AVATAR_MAX_BYTES + 1 })
  await assert.rejects(prepareCommentAvatar(await inputImage('png'), { environment: fixture.environment }), errorCode('avatar_processing'))
  assert.equal(fixture.calls.filter(call => call[0] === 'encode').length, 4)
  assert.deepEqual(fixture.revoked, ['blob:original'])
})

test('capture requires the expected verified account and opaque key', async () => {
  const client = sessionClient(verified('account-a'))
  const auth = await captureAvatarAuthorization(client, { accountId: 'account-a', avatarKey: key }, project, 'sb_publishable_test')
  assert.equal(auth.accessToken, 'account-a-token'); assert.equal(Object.isFrozen(auth), true)
  await assert.rejects(captureAvatarAuthorization(client, { accountId: 'account-b', avatarKey: key }, project, 'sb_publishable_test'), errorCode('avatar_account_changed'))
  await assert.rejects(captureAvatarAuthorization(client, { accountId: 'account-a', avatarKey: '../x' }, project, 'sb_publishable_test'), errorCode('avatar_account_changed'))
  await assert.rejects(captureAvatarAuthorization(sessionClient({ ...verified('account-a'), user: { id: 'account-a' } }), { accountId: 'account-a', avatarKey: key }, project, 'sb_publishable_test'), errorCode('avatar_account_changed'))
})

test('storage uses the captured token even when shared session changes, and uploads only prepared JPEG', async () => {
  let session = verified('account-a')
  const client = { auth: { getSession: async () => ({ data: { session }, error: null }) } }
  const auth = await captureAvatarAuthorization(client, { accountId: 'account-a', avatarKey: key }, project, 'sb_publishable_test')
  session = verified('account-b')
  const calls = []
  await saveCommentAvatar(auth, blob, { fetch: async (...args) => { calls.push(args); return new Response('{}') } })
  assert.equal(calls[0][0], `${project}/storage/v1/object/comment-avatars/${key}.jpg`)
  assert.equal(calls[0][1].headers.Authorization, 'Bearer account-a-token')
  assert.equal(calls[0][1].headers['Content-Type'], 'image/jpeg')
  assert.equal(calls[0][1].body, blob); assert.equal(calls[0][1].credentials, 'omit'); assert.equal(calls[0][1].redirect, 'error')
  await assert.rejects(saveCommentAvatar(auth, new Blob(['svg'], { type: 'image/svg+xml' })), errorCode('avatar_file_size'))
})

test('remove uses exact single-object prefixes and never reads a replacement account token', async () => {
  const auth = await captureAvatarAuthorization(sessionClient(verified('a')), { accountId: 'a', avatarKey: key }, project, 'sb_publishable_test')
  let call
  await removeCommentAvatar(auth, { fetch: async (...args) => { call = args; return new Response('[]') } })
  assert.equal(call[0], `${project}/storage/v1/object/comment-avatars`); assert.equal(call[1].method, 'DELETE')
  assert.deepEqual(JSON.parse(call[1].body), { prefixes: [`${key}.jpg`] })
  assert.equal(call[1].headers.Authorization, 'Bearer a-token')
})

test('abort blocks writes, propagates in-flight cancellation and permission responses stay private', async () => {
  const auth = await captureAvatarAuthorization(sessionClient(verified('a')), { accountId: 'a', avatarKey: key }, project, 'sb_publishable_test')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(saveCommentAvatar(auth, blob, { signal: controller.signal, fetch: () => assert.fail('Aborted request must not start') }), error => error.name === 'AbortError')
  const active = new AbortController()
  const result = saveCommentAvatar(auth, blob, { signal: active.signal, fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) })
  active.abort(); await assert.rejects(result, error => error.name === 'AbortError')
  await assert.rejects(saveCommentAvatar(auth, blob, { fetch: async () => new Response('secret provider details', { status: 403 }) }), error => error.code === 'avatar_permission' && !commentAvatarMessage(error, true).includes('secret'))
})

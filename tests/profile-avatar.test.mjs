import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import sharp from 'sharp'
import { renderProfileAvatar } from '../scripts/profile-avatar.mjs'
import { PROFILE_AVATAR_URL, profileAvatarSource } from '../src/lib/profile-avatar.ts'

async function fixture(t) {
  const base = resolve('work'); await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'avatar-test-'))
  assert.ok(root.startsWith(base + sep))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const dir of ['src/data', 'src/assets', 'public/media']) await mkdir(join(root, dir), { recursive: true })
  const original = await sharp({ create: { width: 7, height: 11, channels: 4, background: '#35609a80' } }).png().toBuffer()
  await writeFile(join(root, 'public/media/original.png'), original)
  const setAvatar = value => writeFile(join(root, 'src/data/profile.json'), JSON.stringify({ avatar: value }))
  const fetcher = () => { throw new Error('Local avatar must never fetch the deployed permalink') }
  await setAvatar('/media/original.png')
  return { root, original, setAvatar, fetcher }
}
const pixels = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

test('missing or generated sources cannot silently restore a hardcoded avatar', () => {
  for (const value of ['', undefined, '/avatar/avatar.png', PROFILE_AVATAR_URL, PROFILE_AVATAR_URL + '?v=old', 'https://www.cyril-fan.top/avatar/avatar.png']) {
    assert.throws(()=>profileAvatarSource(value))
  }
  assert.equal(profileAvatarSource('/media/new.webp'), '/media/new.webp')
})

test('avatar export preserves the entire image, exact pixels and transparency', async t => {
  const f = await fixture(t), output = await renderProfileAvatar(f)
  assert.equal((await sharp(output).metadata()).format, 'png')
  assert.deepEqual(await pixels(output), await pixels(f.original))
  await assert.rejects(readFile(join(f.root, 'public/avatar/avatar.png')), { code: 'ENOENT' })
})

test('changing the profile source changes the stable PNG without editing a second file', async t => {
  const f = await fixture(t), before = await renderProfileAvatar(f)
  const replacement = await sharp({ create: { width: 19, height: 5, channels: 4, background: '#ecbd24' } }).webp({ lossless: true }).toBuffer()
  await writeFile(join(f.root, 'public/media/new.webp'), replacement)
  await f.setAvatar('/media/new.webp')
  const after = await renderProfileAvatar(f)
  assert.notDeepEqual(after, before)
  assert.deepEqual(await pixels(after), await pixels(replacement))
  assert.deepEqual(await readFile(join(f.root, 'public/media/original.png')), f.original)
  await f.setAvatar('https://cyril-fan.top/media/new.webp?v=1')
  assert.deepEqual(await renderProfileAvatar(f), after)
})

test('referencing the public permalink cannot recurse into an old deployment', async t => {
  const f = await fixture(t)
  await f.setAvatar(PROFILE_AVATAR_URL)
  await assert.rejects(renderProfileAvatar(f), /source image/)
})

test('a configured remote image is bounded and exported, never prefixed with the site origin', async t => {
  const f = await fixture(t); await f.setAvatar('https://images.example.org/current.jpg')
  let calls = 0
  const output = await renderProfileAvatar({ ...f, fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://images.example.org/current.jpg')
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit')
    return new Response(f.original, { headers: { 'Content-Type': 'image/png' } })
  } })
  assert.equal(calls, 1); assert.deepEqual(await pixels(output), await pixels(f.original))
})

test('missing or invalid sources fail the build instead of silently publishing the old avatar', async t => {
  const f = await fixture(t)
  for (const value of ['/media/missing.png', '/src/data/profile.json', 'https://127.0.0.1/secret.png', 'https://localhost/secret.png']) {
    await f.setAvatar(value); await assert.rejects(renderProfileAvatar(f))
  }
  await f.setAvatar('https://images.example.org/photo')
  await assert.rejects(renderProfileAvatar({ ...f, fetcher: async () => new Response('unavailable', { status: 503 }) }), /503/)
  await assert.rejects(renderProfileAvatar({ ...f, fetcher: async () => new Response(f.original, { headers: { 'content-length': String(9 * 1024 * 1024) } }) }), /8 MB/)
})


test('education preserves three lines, shows second above first, and clears without reviving legacy fields', async () => {
  const {educationFields,educationCards}=await import('../src/lib/profile-education.ts')
  const legacy={school:'School A',major:'Major A',period:'2024 - Present'}
  assert.deepEqual(educationFields(legacy),{first:'School A\nMajor A\n2024 - Present',second:''})
  assert.equal(educationCards(legacy,'https://example.org')[0].href,'https://example.org')
  const value={...legacy,education:{first:'School A\nMajor A\n2024 - Present',second:'School B\nMajor B\n2028 - Present'}}
  assert.deepEqual(educationCards(value).map(c=>c.school),['School B','School A'])
  value.education.second='';assert.equal(educationCards(value).length,1)
  value.education.first='';assert.deepEqual(educationCards(value),[])
  value.education.first='School\n\nDates';assert.equal(educationCards(value)[0].period,'Dates')
})

test('education and avatar schemas validate before any GitHub writes', async () => {
  const {validateText}=await import('../supabase/functions/_shared/git-content.ts')
  const profile=JSON.parse(await readFile('src/data/profile.json','utf8'))
  profile.zh.education.second='隔离学校\n隔离专业\n2028 - Present';validateText('src/data/profile.json',JSON.stringify(profile))
  profile.zh.education.second='';validateText('src/data/profile.json',JSON.stringify(profile))
  profile.zh.education.second='1\n2\n3\n4';assert.throws(()=>validateText('src/data/profile.json',JSON.stringify(profile)),/three lines/)
  profile.zh.education.second=''
  for(const source of ['',PROFILE_AVATAR_URL,'/src/assets/avatar.png']){profile.avatar=source;assert.throws(()=>validateText('src/data/profile.json',JSON.stringify(profile)))}
})

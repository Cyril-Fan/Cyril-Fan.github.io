import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { isIP } from 'node:net'
import sharp from 'sharp'
import { profileAvatarSource } from '../src/lib/profile-avatar.ts'
import { imageRepositoryPath, pathKind } from '../supabase/functions/_shared/git-content.ts'

const maxBytes = 8 * 1024 * 1024

async function remoteImage(value, fetcher) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) {
    throw new Error('Avatar must use a public HTTPS image URL or a repository image')
  }
  const response = await fetcher(url.href, {
    redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    signal: AbortSignal.timeout(15000), headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' }
  })
  if (!response.ok || !response.body) throw new Error(`Avatar download failed: HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel()
    throw new Error('Avatar exceeds 8 MB')
  }
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { value: chunk, done } = await reader.read()
      if (done) break
      size += chunk.length
      if (size > maxBytes) throw new Error('Avatar exceeds 8 MB')
      chunks.push(chunk)
    }
  } finally { await reader.cancel() }
  return Buffer.concat(chunks)
}

/** Build the existing public PNG permalink from the same profile source as Home
 * and comments. No second editable image or network-time image proxy is stored.
 * PNG is deliberately a still image; animated originals remain untouched. */
export async function renderProfileAvatar({ root = process.cwd(), fetcher = fetch } = {}) {
  const profile = JSON.parse(await readFile(resolve(root, 'src/data/profile.json'), 'utf8'))
  const source = profileAvatarSource(profile.avatar)
  const url = new URL(source, 'https://cyril-fan.top')
  let input
  if (['cyril-fan.top', 'www.cyril-fan.top'].includes(url.hostname)) {
    const path = imageRepositoryPath(url.pathname)
    if (pathKind(path) !== 'media') throw new Error('Unsupported profile avatar source')
    const filename = resolve(root, path)
    if (!filename.startsWith(resolve(root) + sep)) throw new Error('Avatar is outside the repository')
    input = await readFile(filename)
  } else input = await remoteImage(source, fetcher)
  if (!input.length || input.length > maxBytes) throw new Error('Invalid avatar size (maximum 8 MB)')
  const image = sharp(input, { limitInputPixels: 40000000, pages: 1 })
  const metadata = await image.metadata()
  if (!['png', 'jpeg', 'webp', 'gif', 'heif', 'avif'].includes(metadata.format)) throw new Error('Unsupported avatar format')
  // No crop, resize, palette reduction or lossy encoding. Preserve transparency.
  return image.rotate().png({ compressionLevel: 9 }).toBuffer()
}

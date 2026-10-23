import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { brandSvg, iconLinks, iconPrefix, iconRecipe, maskSvg, rasterSvg } from './branding.mjs'

function pngsToIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let position = header.length
  images.forEach(({ size, buffer }, index) => {
    const offset = 6 + index * 16
    header.writeUInt8(size, offset)
    header.writeUInt8(size, offset + 1)
    header.writeUInt16LE(1, offset + 4)
    header.writeUInt16LE(32, offset + 6)
    header.writeUInt32LE(buffer.length, offset + 8)
    header.writeUInt32LE(position, offset + 12)
    position += buffer.length
  })
  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)])
}

export async function generateBranding() {
  const publicDir = new URL('../public/', import.meta.url)
  const versionDir = new URL(`.${iconPrefix}/`, publicDir)
  const legacyDir = new URL('favicon/', publicDir)
  // Static JSON is bundled into Astro layouts; no filesystem reads are needed
  // from a relocated prerendered server chunk.
  await writeFile(new URL('../src/assets/brand/generated-icons.json', import.meta.url), `${JSON.stringify(iconLinks, null, 2)}\n`)
  await mkdir(versionDir, { recursive: true })
  const sizes = iconRecipe.sizes
  const images = await Promise.all(sizes.map(async (size) => ({
    size, buffer: await sharp(Buffer.from(rasterSvg), { density: iconRecipe.density }).resize(size, size).png().toBuffer()
  })))
  const ico = pngsToIco(images.filter(({ size }) => size <= 48))
  const manifest = `${JSON.stringify({
    id: '/',
    name: '范星宇 · Cyril Fan',
    short_name: 'Cyril Fan',
    icons: [
      { src: `${iconPrefix}/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ...[192, 512].map(size => ({ src: `${iconPrefix}/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' }))
    ],
    start_url: '/',
    display: 'browser'
  }, null, 2)}\n`
  const files = [
    ['icon.svg', brandSvg],
    ['safari-pinned-tab.svg', maskSvg],
    ['favicon.ico', ico],
    ['site.webmanifest', manifest],
    ...images.map(({ size, buffer }) => [size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`, buffer])
  ]
  for (const [name, content] of files) {
    await writeFile(new URL(name, versionDir), content)
    await writeFile(new URL(name, legacyDir), content)
  }
  // Some mobile launchers, old bookmarks and crawlers probe these conventional paths.
  await writeFile(new URL('favicon.svg', publicDir), brandSvg)
  await writeFile(new URL('favicon.svg', legacyDir), brandSvg)
  await writeFile(new URL('favicon.ico', publicDir), ico)
  await writeFile(new URL('apple-touch-icon.png', publicDir), images.find(({ size }) => size === 180).buffer)
  await writeFile(new URL('apple-touch-icon-precomposed.png', publicDir), images.find(({ size }) => size === 180).buffer)
  for (const size of [120, 152, 167, 180]) {
    const buffer = images.find(image => image.size === size).buffer
    // iOS also probes sized root icons when opening saved tabs/bookmarks.
    for (const suffix of ['', '-precomposed']) {
      await writeFile(new URL(`apple-touch-icon-${size}x${size}${suffix}.png`, publicDir), buffer)
    }
  }
  await writeFile(new URL('site.webmanifest', publicDir), manifest)
  // Replace an obsolete legacy bitmap too; it is no longer advertised as maskable.
  await writeFile(new URL('maskable-512.png', legacyDir), images.find(({ size }) => size === 512).buffer)
}

import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { brandSvg, iconMarkup, iconPrefix, iconRecipe, getBrandVersion, rasterSvg, maskSvg } from '../scripts/branding.mjs'
import { verifyDocument } from '../scripts/verify-site-output.mjs'

test('browser and mobile raster icons have transparent exteriors and visible star shapes', async () => {
  assert.doesNotMatch(brandSvg, /<rect\b/)
  assert.match(brandSvg, /prefers-color-scheme:\s*dark/)
  for (const size of [16, 32, 48, 180, 512]) {
    const { data, info } = await sharp(Buffer.from(rasterSvg)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(info.channels, 4)
    for (const [x, y] of [[0,0], [size-1,0], [0,size-1], [size-1,size-1]]) {
      assert.equal(data[(y*size+x)*4+3], 0, `${size}px corner should be transparent`)
    }
    assert.ok(data.some((value, index) => index % 4 === 3 && value > 200))
  }
})

test('raster recipe changes invalidate every versioned browser icon', () => {
  const current = getBrandVersion(brandSvg, iconRecipe)
  assert.notEqual(getBrandVersion(brandSvg, { ...iconRecipe, rasterColor: '#000000' }), current)
  assert.notEqual(getBrandVersion(brandSvg, { ...iconRecipe, density: 144 }), current)
  assert.notEqual(getBrandVersion(brandSvg.replace('30.5', '31.5'), iconRecipe), current)
  assert.match(maskSvg, /fill:#000/)
  assert.doesNotMatch(maskSvg, /<rect\b|prefers-color-scheme/)
})

test('published PNGs and every ICO frame contain the entire current transparent artwork', async () => {
  const ico = await readFile(new URL('../public/favicon.ico', import.meta.url))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 3)
  for (let index = 0; index < 3; index++) {
    const entry = 6 + index * 16
    const size = [16, 32, 48][index]
    assert.equal(ico[entry], size)
    assert.equal(ico[entry + 1], size)
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    assert.ok(offset >= 54 && offset + length <= ico.length)
    const frame = ico.subarray(offset, offset + length)
    const expected = await sharp(Buffer.from(rasterSvg), { density: iconRecipe.density }).resize(size, size).ensureAlpha().raw().toBuffer()
    assert.deepEqual(await sharp(frame).ensureAlpha().raw().toBuffer(), expected, `${size}px ICO frame differs from source`)
  }
  for (const size of iconRecipe.sizes) {
    const filename = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
    const image = await readFile(new URL(`../public${iconPrefix}/${filename}`, import.meta.url))
    const expected = await sharp(Buffer.from(rasterSvg), { density: iconRecipe.density }).resize(size, size).ensureAlpha().raw().toBuffer()
    assert.deepEqual(await sharp(image).ensureAlpha().raw().toBuffer(), expected, `${filename} differs from source`)
    // The orbit ends well above this bottom band. A rounded square (even with
    // transparent corners) would add pixels here, so test the whole quiet zone.
    for (let y = Math.ceil(size * 0.88); y < size; y++) {
      for (let x = 0; x < size; x++) assert.equal(expected[(y * size + x) * 4 + 3], 0, `${filename}: unwanted background`)
    }
  }
})

test('a future page cannot build with a stale icon, missing icon, or remote executable script', () => {
  const policy = `<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self'"><meta name="referrer" content="strict-origin-when-cross-origin">`
  const page = `<html><head><title>关于 • Cyril Fan</title>${policy}${iconMarkup}</head><body></body></html>`
  assert.doesNotThrow(() => verifyDocument(page, '/about'))
  assert.throws(() => verifyDocument(page.replace(iconPrefix, '/favicon/old-c'), '/new-feature'), /missing current/)
  assert.throws(() => verifyDocument(page.replace(iconMarkup, ''), '/new-feature'), /shared SiteIcons/)
  assert.throws(() => verifyDocument(page.replace("form-action 'self'", ''), '/about'), /form-action/)
  assert.throws(() => verifyDocument(page.replace('</head>', '<script src="https://cdn.example/library.js"></script></head>'), '/about'), /bundle executable scripts locally/)
})

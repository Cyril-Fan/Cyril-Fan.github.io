import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { brandSvg, iconMarkup, iconPrefix, rasterSvg } from '../scripts/branding.mjs'
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

test('a future page cannot build with a stale icon, missing icon, or remote executable script', () => {
  const policy = `<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self'"><meta name="referrer" content="strict-origin-when-cross-origin">`
  const page = `<html><head><title>关于 • Cyril Fan</title>${policy}${iconMarkup}</head><body></body></html>`
  assert.doesNotThrow(() => verifyDocument(page, '/about'))
  assert.throws(() => verifyDocument(page.replace(iconPrefix, '/favicon/old-c'), '/new-feature'), /missing current/)
  assert.throws(() => verifyDocument(page.replace(iconMarkup, ''), '/new-feature'), /shared SiteIcons/)
  assert.throws(() => verifyDocument(page.replace("form-action 'self'", ''), '/about'), /form-action/)
  assert.throws(() => verifyDocument(page.replace('</head>', '<script src="https://cdn.example/library.js"></script></head>'), '/about'), /bundle executable scripts locally/)
})

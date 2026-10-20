import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { brandSvg, iconMarkup, iconPrefix, rasterSvg } from '../scripts/branding.mjs'
import { verifyDocument } from '../scripts/verify-site-output.mjs'
import { pageTitle } from '../src/lib/page-title.mjs'

test('all known section routes receive English browser-tab prefixes in either locale', () => {
  const samples = [
    ['/', '首页', 'Home'], ['/about/', '关于', 'About'], ['/academic', '研究', 'Academic'],
    ['/blog/all', '全部文章 - 博客', 'Blog — All Posts'], ['/blog/tech/2', '技术 - 博客', 'Blog — Technical'],
    ['/links', '友链', 'Links'], ['/search', '站内搜索', 'Search'], ['/archives', '归档', 'Archives'],
    ['/tags/科研', '标签：科研', 'Tags — 科研'], ['/terms/privacy-policy', '隐私说明', 'Privacy'],
    ['/auth/confirm', '确认账户操作', 'Confirm Account'], ['/404.html', '404', 'Page Not Found'],
    ['/collection/research', '论文阅读', 'Collections — 论文阅读']
  ]
  for (const [path, title, expected] of samples) {
    assert.equal(pageTitle(path, title), expected)
    assert.equal(pageTitle(`/en${path}`, title), expected)
  }
  assert.equal(pageTitle('/blog/my-post', '论文阅读', true), 'Blog — 论文阅读')
  assert.equal(pageTitle('/new-feature', '新功能'), 'New Feature — 新功能')
  assert.equal(pageTitle('/constructor', '新功能'), 'Constructor — 新功能')
})

test('every raster icon has transparent exterior and an actual nonempty star pattern', async () => {
  assert.doesNotMatch(brandSvg, /<rect\b/)
  assert.match(brandSvg, /prefers-color-scheme:\s*dark/)
  for (const size of [16, 32, 180, 512]) {
    const { data, info } = await sharp(Buffer.from(rasterSvg)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(info.channels, 4)
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      assert.equal(data[(y * size + x) * 4 + 3], 0, `${size}px icon corner must be transparent`)
    }
    assert.ok(data.some((value, index) => index % 4 === 3 && value > 200), 'star should be visible')
  }
})

test('build guard rejects old or missing icons and Chinese browser-title prefixes', () => {
  const security = `<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self'"><meta name="referrer" content="strict-origin-when-cross-origin">`
  const good = `<html><head><title>About • 范星宇</title>${security}${iconMarkup}</head><body></body></html>`
  assert.doesNotThrow(() => verifyDocument(good, '/about'))
  assert.throws(() => verifyDocument(good.replace('About', '关于'), '/about'), /English section/)
  assert.throws(() => verifyDocument(good.replace(iconPrefix, '/favicon/stale'), '/about'), /missing current/)
  assert.throws(() => verifyDocument(good.replace(iconMarkup, ''), '/about'), /shared SiteIcons/)
  assert.throws(() => verifyDocument(good.replace("form-action 'self'", ''), '/about'), /form-action/)
  assert.throws(() => verifyDocument(good.replace('</head>', '<script src="https://cdn.example/library.js"></script></head>'), '/about'), /bundle executable scripts locally/)
})

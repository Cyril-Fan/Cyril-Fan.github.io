import assert from 'node:assert/strict'
import { readFile, readdir, writeFile, access } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parse } from 'node-html-parser'
import { iconLinks, iconMarkup, iconPrefix } from './branding.mjs'

export function verifyDocument(html, route) {
  const root = parse(html)
  for (const script of root.querySelectorAll('script[src]')) {
    const source = new URL(script.getAttribute('src'), 'https://cyril-fan.top/')
    assert.equal(source.origin, 'https://cyril-fan.top', `${route}: bundle executable scripts locally instead of loading a third-party CDN`)
  }
  const title = root.querySelector('title')?.textContent || ''
  assert.ok(title.trim(), `${route}: missing browser title`)
  const redirect = root.querySelector('meta[http-equiv="refresh"]')
  if (!redirect) {
    const policy = root.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || ''
    for (const directive of ["object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      assert.ok(policy.split(';').some(value => value.trim() === directive), `${route}: missing ${directive} policy`)
    }
    const referrer = root.querySelector('meta[name="referrer"]')?.getAttribute('content')
    assert.ok(['no-referrer', 'strict-origin-when-cross-origin'].includes(referrer), `${route}: missing referrer policy`)
  }
  const links = root.querySelectorAll('link').filter(link => /(?:^|\s)(?:icon|apple-touch-icon(?:-precomposed)?|mask-icon|manifest)(?:\s|$)/.test(link.getAttribute('rel') || ''))
  assert.equal(links.length, iconLinks.length, `${route}: use the shared SiteIcons component for every page`)
  for (const expected of iconLinks) {
    const found = links.find(link => link.getAttribute('rel') === expected.rel && link.getAttribute('href') === expected.href)
    assert.ok(found, `${route}: missing current ${expected.rel} ${expected.href}`)
    if (expected.type) assert.equal(found.getAttribute('type'), expected.type, `${route}: incorrect icon MIME type`)
    if (expected.sizes) assert.equal(found.getAttribute('sizes'), expected.sizes, `${route}: incorrect icon sizes`)
  }
  const navigation = root.querySelector('header-component')
  if (navigation) {
    const language = navigation.querySelector('a#language-switch-btn')
    const target = language?.getAttribute('href') || ''
    assert.ok(target.startsWith('/') && !target.startsWith('//'), `${route}: language navigation must work as a native local link`)
    const english = root.querySelector('html')?.getAttribute('lang') === 'en'
    assert.equal(/^\/en(?:\/|$)/.test(target), !english, `${route}: language link must lead to the other locale`)
    assert.doesNotMatch(navigation.textContent, /Month Journal|月记|(?:'|’)s? Blog/, `${route}: obsolete navigation label`)
    assert.ok(navigation.querySelector('[data-all-posts]'), `${route}: missing All posts group separator`)
    assert.ok(!navigation.querySelectorAll('a').some(link => /\/blog\/(?:journal|month-journal)(?:\/|$)/.test(link.getAttribute('href') || '')), `${route}: obsolete month-journal category`)
  }
}

export async function verifySiteOutput(directory) {
  let count = 0
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const filename = join(folder, entry.name)
      if (entry.isDirectory()) await walk(filename)
      else if (entry.name.endsWith('.html')) {
        let html = await readFile(filename, 'utf8')
        // Astro's automatic redirect documents bypass all layouts. Give them the
        // same icons too, so old bookmark URLs never briefly revive a cached C.
        if (/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html) && !html.includes(iconPrefix)) {
          html = html.replace(/<\/title>/i, `</title>${iconMarkup}`)
          await writeFile(filename, html)
        }
        verifyDocument(html, relative(directory, filename))
        count++
      }
    }
  }
  await walk(directory)
  assert.ok(count > 0, 'No built pages found to verify')
  for (const icon of iconLinks) await access(join(directory, icon.href))
  // Catch a stale root fallback even if all page-level icon links are current.
  for (const [fallback, current] of [
    ['favicon.ico', 'favicon.ico'],
    ['favicon.svg', 'icon.svg'],
    ['favicon/favicon.ico', 'favicon.ico'],
    ['favicon/favicon.svg', 'icon.svg'],
    ['apple-touch-icon.png', 'apple-touch-icon.png'],
    ['apple-touch-icon-precomposed.png', 'apple-touch-icon.png'],
    ['favicon/apple-touch-icon.png', 'apple-touch-icon.png'],
    ['favicon/maskable-512.png', 'icon-512.png'],
    ['site.webmanifest', 'site.webmanifest']
  ]) {
    assert.deepEqual(await readFile(join(directory, fallback)), await readFile(join(directory, iconPrefix, current)), `Stale icon fallback: ${fallback}`)
  }
  for (const size of [120, 152, 167, 180]) {
    const current = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
    for (const suffix of ['', '-precomposed']) {
      const fallback = `apple-touch-icon-${size}x${size}${suffix}.png`
      assert.deepEqual(await readFile(join(directory, fallback)), await readFile(join(directory, iconPrefix, current)), `Stale iOS icon fallback: ${fallback}`)
    }
  }
  // Merely testing transparent corners misses the old rounded-square backdrop.
  // Compare every published historical payload, including every ICO frame, to
  // this release's generated bytes so a retired URL cannot serve old artwork.
  const currentFiles = await readdir(join(directory, iconPrefix))
  const previousVersions = (await readdir(join(directory, 'favicon'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^[a-f0-9]{12}$/.test(entry.name))
  for (const { name } of previousVersions) {
    for (const file of currentFiles) {
      assert.deepEqual(await readFile(join(directory, 'favicon', name, file)), await readFile(join(directory, iconPrefix, file)), `Stale historical icon: ${name}/${file}`)
    }
  }
  const manifest = JSON.parse(await readFile(join(directory, iconPrefix, 'site.webmanifest'), 'utf8'))
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith(`${iconPrefix}/`), 'Manifest contains a stale icon URL')
    await access(join(directory, icon.src))
  }
  console.log(`[site-check] ${count} pages have current icons, navigation and basic security metadata.`)
}

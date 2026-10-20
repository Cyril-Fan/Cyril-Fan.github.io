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
  const links = root.querySelectorAll('link').filter(link => /(?:^|\s)(?:icon|apple-touch-icon|manifest)(?:\s|$)/.test(link.getAttribute('rel') || ''))
  assert.equal(links.length, iconLinks.length, `${route}: use the shared SiteIcons component for every page`)
  for (const expected of iconLinks) {
    const found = links.find(link => link.getAttribute('rel') === expected.rel && link.getAttribute('href') === expected.href)
    assert.ok(found, `${route}: missing current ${expected.rel} ${expected.href}`)
    if (expected.type) assert.equal(found.getAttribute('type'), expected.type, `${route}: incorrect icon MIME type`)
  }
  const navigation = root.querySelector('header-component')
  if (navigation) {
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
  const manifest = JSON.parse(await readFile(join(directory, iconPrefix, 'site.webmanifest'), 'utf8'))
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith(`${iconPrefix}/`), 'Manifest contains a stale icon URL')
    await access(join(directory, icon.src))
  }
  console.log(`[site-check] ${count} pages have current icons, navigation and basic security metadata.`)
}

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// One vector is the source of every browser, mobile, manifest and fallback icon.
export const brandSvg = readFileSync(new URL('../src/assets/brand/star-orbit.svg', import.meta.url), 'utf8')
export const brandVersion = createHash('sha256').update(brandSvg).digest('hex').slice(0, 12)
export const iconPrefix = `/favicon/${brandVersion}`
export const iconLinks = [
  { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: `${iconPrefix}/favicon.ico` },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${iconPrefix}/icon-32.png` },
  { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: `${iconPrefix}/icon.svg` },
  { rel: 'apple-touch-icon', sizes: '180x180', href: `${iconPrefix}/apple-touch-icon.png` },
  { rel: 'manifest', href: `${iconPrefix}/site.webmanifest` }
]
export const iconMarkup = iconLinks
  .map((attributes) => `<link ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')}>`)
  .join('')

/** Raster assets cannot follow media queries; this medium slate remains visible on both themes. */
export const rasterSvg = brandSvg.replace(/<style>[\s\S]*?<\/style>/, '<style>.star{fill:#70839d}.orbit{stroke:#70839d}.satellite{fill:#70839d}</style>')

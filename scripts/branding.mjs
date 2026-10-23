import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// One vector is the source of every browser, mobile, manifest and fallback icon.
export const brandSvg = readFileSync(new URL('../src/assets/brand/star-orbit.svg', import.meta.url), 'utf8')
// Cache keys cover the rendering recipe too, so PNG/ICO changes get new URLs
// even when vector geometry is unchanged. Saved browser history may lag behind.
export const rasterColor = '#70839d'
export const iconRecipe = { version: 3, density: 300, rasterColor, transparent: true, sizes: [16, 32, 48, 96, 120, 152, 167, 180, 192, 512] }
export const getBrandVersion = (svg, recipe) => createHash('sha256').update(svg).update(JSON.stringify(recipe)).digest('hex').slice(0, 12)
export const brandVersion = getBrandVersion(brandSvg, iconRecipe)
export const iconPrefix = `/favicon/${brandVersion}`
export const iconLinks = [
  { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: `${iconPrefix}/favicon.ico` },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${iconPrefix}/icon-32.png` },
  { rel: 'icon', type: 'image/png', sizes: '96x96', href: `${iconPrefix}/icon-96.png` },
  { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: `${iconPrefix}/icon.svg` },
  { rel: 'apple-touch-icon', sizes: '180x180', href: `${iconPrefix}/apple-touch-icon.png` },
  { rel: 'apple-touch-icon-precomposed', sizes: '180x180', href: `${iconPrefix}/apple-touch-icon.png` },
  { rel: 'mask-icon', color: '#64748b', href: `${iconPrefix}/safari-pinned-tab.svg` },
  { rel: 'manifest', href: `${iconPrefix}/site.webmanifest` }
]
// Standalone images have no HTML <head>. Browsers may load these paths instead
// of the versioned icons advertised by our pages. Keep their HTTP cache fresh
// too; this does not give the site access to the browser's private favicon DB.
export const defaultIconPaths = ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']
export const iconMarkup = iconLinks
  .map((attributes) => `<link ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')}>`)
  .join('')

/** Raster assets cannot follow media queries; this medium slate remains visible on both themes. */
export const rasterSvg = brandSvg.replace(/<style>[\s\S]*?<\/style>/, `<style>.star{fill:${rasterColor}}.orbit{stroke:${rasterColor}}.satellite{fill:${rasterColor}}</style>`)
export const maskSvg = brandSvg.replace(/<style>[\s\S]*?<\/style>/, '<style>.star,.satellite{fill:#000}.orbit{stroke:#000}</style>')

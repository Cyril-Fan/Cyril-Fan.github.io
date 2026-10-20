import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'node-html-parser'

export const snakeSources = {
  light: 'https://raw.githubusercontent.com/Cyril-Fan/Cyril-Fan/main/assets/github-contribution-grid-snake.svg',
  dark: 'https://raw.githubusercontent.com/Cyril-Fan/Cyril-Fan/main/assets/github-contribution-grid-snake-dark.svg'
}
const directory = new URL('../public/contributions/', import.meta.url)
const metadataFile = new URL('../src/assets/contributions.json', import.meta.url)
const allowedElements = new Set(['svg', 'desc', 'title', 'style', 'g', 'rect', 'path'])
const allowedAttributes = new Set(['viewbox', 'width', 'height', 'xmlns', 'class', 'x', 'y', 'rx', 'ry', 'd', 'fill', 'stroke', 'stroke-width', 'transform'])

/** Only accept the passive SVG shape/CSS format produced by the profile's snake generator. */
export function validateSnake(svg) {
  if (Buffer.byteLength(svg) > 500_000 || !svg.startsWith('<svg ') || !svg.endsWith('</svg>')) throw new Error('Unexpected snake SVG envelope')
  const root = parse(svg)
  for (const node of root.querySelectorAll('*')) {
    const tag = node.tagName.toLowerCase()
    if (!allowedElements.has(tag)) throw new Error(`Unexpected snake element: ${tag}`)
    for (const name of Object.keys(node.attributes)) {
      if (!allowedAttributes.has(name.toLowerCase())) throw new Error(`Unexpected snake attribute: ${name}`)
    }
  }
  // No remote resources, escapes, imports or scriptable CSS. Never inline this
  // external SVG into a page; it is served through the browser's image context.
  if (/url\s*\(|@import|expression\s*\(|javascript:|\\|<!|<\?/i.test(svg)) throw new Error('Active SVG content rejected')
  if (!root.querySelector('style')?.textContent.includes('@keyframes') || root.querySelectorAll('rect').length < 300) throw new Error('Incomplete contribution animation')
  return svg
}

export function staticSnake(svg) {
  // Disable every CSS animation and transition; keep the original contribution
  // colors and the starting snake position without producing a second data set.
  return svg.replace('</style>', '*{animation:none!important;transition:none!important}</style>')
}

export async function syncContributionSnake({ fetcher = fetch } = {}) {
  await mkdir(directory, { recursive: true })
  let svgs
  try {
    const results = await Promise.all(Object.values(snakeSources).map(async url => {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), redirect: 'error' })
      if (!response.ok) throw new Error(`Snake download returned ${response.status}`)
      const data = await response.text()
      return validateSnake(data.trim())
    }))
    svgs = { light: results[0], dark: results[1] }
    if (svgs.light === svgs.dark) throw new Error('Light and dark animations must differ')
  } catch (error) {
    // A temporary GitHub outage must not remove the last verified animation or
    // make the entire static website unavailable.
    const existing = JSON.parse(await readFile(metadataFile, 'utf8'))
    for (const variant of ['light', 'dark']) {
      const asset = existing[variant]
      if (!/^\/contributions\/snake-(?:light|dark)-[a-f0-9]{12}\.svg$/.test(asset)) throw error
      validateSnake(await readFile(new URL(`../public${asset}`, import.meta.url), 'utf8'))
      await readFile(new URL(`../public${existing[`${variant}Static`]}`, import.meta.url))
    }
    console.warn('[contributions] GitHub fetch unavailable; keeping the last verified profile animations.')
    return existing
  }
  const metadata = { source: 'https://github.com/Cyril-Fan', syncedAt: new Date().toISOString() }
  for (const variant of ['light', 'dark']) {
    const svg = svgs[variant]
    const version = createHash('sha256').update(svg).digest('hex').slice(0, 12)
    const name = `snake-${variant}-${version}`
    await writeFile(new URL(`${name}.svg`, directory), svg)
    await writeFile(new URL(`${name}-static.svg`, directory), staticSnake(svg))
    metadata[variant] = `/contributions/${name}.svg`
    metadata[`${variant}Static`] = `/contributions/${name}-static.svg`
  }
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`)
  console.log('[contributions] Synced both profile snake animations.')
  return metadata
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncContributionSnake()

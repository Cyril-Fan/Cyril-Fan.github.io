import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isCurrentContributionCalendar, normalizeContributions } from '../src/lib/github-contributions.ts'
import { calendarHash, fetchContributionBundle, fetchPublishedContributionBundle, MAX_SOURCE_AGE_MS, RENDERER, validateProfileSnake } from '../src/lib/contribution-feed.ts'

const defaultRoot = new URL('../', import.meta.url)
async function writeJson(file, data) {
  const temporary = new URL(`${file.pathname.split('/').at(-1)}.tmp`, file)
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
  await rename(temporary, file)
}

async function saveBundle(bundle, root) {
  const directory = new URL('public/contributions/', root)
  await mkdir(directory, { recursive: true })
  await mkdir(new URL('src/assets/', root), { recursive: true })
  const metadata = {
    source: 'https://github.com/Cyril-Fan', sourceCommit: bundle.sourceCommit,
    fetchedAt: bundle.fetchedAt, checkedAt: bundle.checkedAt,
    dataThrough: bundle.dataThrough, dataHash: bundle.dataHash,
    rendererVersion: RENDERER, width: bundle.width, height: bundle.height, cycleDurationMs: bundle.duration
  }
  for (const theme of ['light', 'dark']) {
    const svg = bundle[theme]
    const name = `snake-${theme}-${createHash('sha256').update(svg).digest('hex').slice(0, 12)}.svg`
    await writeFile(new URL(name, directory), svg)
    metadata[theme] = `/contributions/${name}`
  }
  await writeJson(new URL('src/assets/contribution-calendar.json', root), {
    username: 'Cyril-Fan', sourceCommit: bundle.sourceCommit, fetchedAt: bundle.fetchedAt, checkedAt: bundle.checkedAt,
    dataThrough: bundle.dataThrough, dataHash: bundle.dataHash,
    contributions: bundle.calendar.contributions, total: { lastYear: bundle.calendar.total }
  })
  await writeJson(new URL('src/assets/contributions.json', root), metadata)
  await mkdir(new URL('public/data/', root), { recursive:true })
  await writeJson(new URL('public/data/contributions.json', root), { version:1, ...bundle })
  // Keep only the current pair, after every part of the new snapshot is saved.
  const current = new Set([metadata.light, metadata.dark])
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    if (entry.isFile() && /^snake-(?:light|dark)-[a-f0-9]{12}(?:-static)?\.svg$/.test(entry.name)
      && !current.has(`/contributions/${entry.name}`)) await unlink(new URL(entry.name, directory))
  }
  console.log(`[contributions] GitHub profile ${bundle.sourceCommit?.slice(0, 7) || 'main (calendar hash verified)'}: ${bundle.calendar.total} contributions; original Platane/snk animation, ${bundle.duration}ms.`)
  return metadata
}

export async function syncContributionSnake({ root = defaultRoot, token = process.env.GITHUB_TOKEN, ...options } = {}) {
  // No writes until the profile calendar and original animations agree.
  const bundle = await fetchContributionBundle({ ...options, token })
  if (!bundle) throw new Error('Missing contribution bundle')
  return saveBundle(bundle, root)
}

export async function verifyContributionBundle({ root = defaultRoot, now = new Date(), requireFresh = true } = {}) {
  const snapshot = JSON.parse(await readFile(new URL('src/assets/contribution-calendar.json', root), 'utf8'))
  const metadata = JSON.parse(await readFile(new URL('src/assets/contributions.json', root), 'utf8'))
  const calendar = normalizeContributions(snapshot)
  if (!calendar || snapshot.dataHash !== await calendarHash(calendar) || metadata.dataHash !== snapshot.dataHash || metadata.fetchedAt !== snapshot.fetchedAt || metadata.dataThrough !== calendar.contributions.at(-1).date || metadata.rendererVersion !== RENDERER || metadata.sourceCommit !== snapshot.sourceCommit) throw new Error('Contribution bundle identity mismatch')
  const age = now.getTime() - Date.parse(snapshot.fetchedAt)
  if (!Number.isFinite(age) || age < -300_000 || (metadata.sourceCommit !== null && !/^[a-f0-9]{40}$/.test(metadata.sourceCommit))) throw new Error('Invalid contribution snapshot identity or timestamp')
  if (requireFresh && (!isCurrentContributionCalendar(calendar, now) || age > MAX_SOURCE_AGE_MS)) throw new Error('Contribution bundle is stale')
  for (const theme of ['light', 'dark']) {
    const path = metadata[theme]
    if (!new RegExp(`^/contributions/snake-${theme}-[a-f0-9]{12}\\.svg$`).test(path)) throw new Error('Invalid contribution asset path')
    const svg = await readFile(new URL(`public${path}`, root), 'utf8')
    if (!path.endsWith(`-${createHash('sha256').update(svg).digest('hex').slice(0, 12)}.svg`)) throw new Error('Contribution asset hash mismatch')
    const geometry = validateProfileSnake(svg, calendar, theme)
    if (metadata.width !== geometry.width || metadata.height !== geometry.height || metadata.cycleDurationMs !== geometry.duration) throw new Error('Contribution canvas or timing mismatch')
  }
  return { snapshot, metadata, calendar }
}

/** Keep the newest complete version. Neither rate limits nor a half-published
 * profile should block publishing unrelated articles, RSS or fixes. */
export async function refreshContributionSnapshot({ root = defaultRoot, fetcher = fetch, now = new Date(), token = process.env.GITHUB_TOKEN,
  publishedOrigin = 'https://cyril-fan.top', retry = true } = {}) {
  let best
  try {
    const { snapshot, metadata, calendar } = await verifyContributionBundle({ root, now, requireFresh:false })
    best = { sourceCommit:metadata.sourceCommit, fetchedAt:snapshot.fetchedAt, checkedAt:metadata.checkedAt || snapshot.fetchedAt,
      dataThrough:metadata.dataThrough, dataHash:metadata.dataHash, width:metadata.width, height:metadata.height, duration:metadata.cycleDurationMs,
      calendar, light:await readFile(new URL(`public${metadata.light}`, root),'utf8'), dark:await readFile(new URL(`public${metadata.dark}`, root),'utf8') }
  } catch { /* A remote verified bundle can repair a missing local snapshot. */ }
  const select = bundle => {
    if (bundle && (!best || Date.parse(bundle.fetchedAt) > Date.parse(best.fetchedAt) ||
      (bundle.fetchedAt === best.fetchedAt && Date.parse(bundle.checkedAt) >= Date.parse(best.checkedAt)))) best = bundle
  }
  // Read the fallback concurrently: a slow deployed site must not delay GitHub.
  const fallback = fetchPublishedContributionBundle({ fetcher, now, origin:publishedOrigin }).catch(() => null)
  let refreshed = false
  for (let attempt=0; attempt<(retry ? 2 : 1); attempt++) {
    try { select(await fetchContributionBundle({ fetcher, now, token })); refreshed = true; break }
    catch {
      if (retry && attempt === 0) await new Promise(resolve => setTimeout(resolve, 750))
    }
  }
  select(await fallback)
  if (!best) throw new Error('No complete verified contribution snapshot is available')
  if (!refreshed) console.warn(`[contributions] GitHub refresh unavailable. Keeping the complete snapshot from ${best.fetchedAt}; its original date is preserved.`)
  return saveBundle(best, root)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await refreshContributionSnapshot()

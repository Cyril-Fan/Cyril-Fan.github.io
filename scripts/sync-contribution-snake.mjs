import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isCurrentContributionCalendar, normalizeContributions } from '../src/lib/github-contributions.ts'
import { calendarHash, fetchContributionBundle, MAX_SOURCE_AGE_MS, RENDERER, validateProfileSnake } from '../src/lib/contribution-feed.ts'

const defaultRoot = new URL('../', import.meta.url)
async function writeJson(file, data) {
  const temporary = new URL(`${file.pathname.split('/').at(-1)}.tmp`, file)
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
  await rename(temporary, file)
}

export async function syncContributionSnake({ root = defaultRoot, token = process.env.GITHUB_TOKEN, ...options } = {}) {
  // No writes until the profile calendar and original animations agree.
  const bundle = await fetchContributionBundle({ ...options, token })
  if (!bundle) throw new Error('Missing contribution bundle')
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
  console.log(`[contributions] GitHub profile ${bundle.sourceCommit.slice(0, 7)}: ${bundle.calendar.total} contributions; original Platane/snk animation, ${bundle.duration}ms.`)
  return metadata
}

export async function verifyContributionBundle({ root = defaultRoot, now = new Date(), requireFresh = true } = {}) {
  const snapshot = JSON.parse(await readFile(new URL('src/assets/contribution-calendar.json', root), 'utf8'))
  const metadata = JSON.parse(await readFile(new URL('src/assets/contributions.json', root), 'utf8'))
  const calendar = normalizeContributions(snapshot)
  if (!calendar || snapshot.dataHash !== await calendarHash(calendar) || metadata.dataHash !== snapshot.dataHash || metadata.fetchedAt !== snapshot.fetchedAt || metadata.dataThrough !== calendar.contributions.at(-1).date || metadata.rendererVersion !== RENDERER || metadata.sourceCommit !== snapshot.sourceCommit) throw new Error('Contribution bundle identity mismatch')
  const age = now.getTime() - Date.parse(snapshot.fetchedAt)
  if (requireFresh && (!isCurrentContributionCalendar(calendar, now) || !Number.isFinite(age) || age < -300_000 || age > MAX_SOURCE_AGE_MS)) throw new Error('Contribution bundle is stale')
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

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncContributionSnake()

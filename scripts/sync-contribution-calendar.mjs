import { readFile, writeFile } from 'node:fs/promises'
import { normalizeContributions } from '../src/lib/github-contributions.ts'

const file = new URL('../src/assets/contribution-calendar.json', import.meta.url)
const source = 'https://github-contributions-api.jogruber.de/v4/Cyril-Fan?y=last'
try {
  const response = await fetch(source, { signal: AbortSignal.timeout(12_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Contribution feed: ${response.status}`)
  const payload = await response.json()
  const calendar = normalizeContributions(payload)
  if (!calendar) throw new Error('Invalid or incomplete contribution feed')
  await writeFile(file, JSON.stringify({ source, syncedAt: new Date().toISOString(), contributions:calendar.contributions, total:{lastYear:calendar.total} }) + '\n')
  console.log(`[contributions] Saved ${calendar.contributions.length} real days, ${calendar.total} contributions.`)
} catch (error) {
  // A failed refresh must never replace real history with fabricated zeroes.
  const existing = JSON.parse(await readFile(file, 'utf8'))
  if (!normalizeContributions(existing)) throw error
  console.warn('[contributions] Feed unavailable; keeping the last verified daily calendar.')
}

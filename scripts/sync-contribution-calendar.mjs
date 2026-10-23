import { verifyContributionBundle } from './sync-contribution-snake.mjs'

// Compatibility with the existing build command: verify the unified bundle,
// without fetching a different feed. An old but complete snapshot is allowed
// during upstream outages, with its original date still shown to readers.
const { calendar, snapshot } = await verifyContributionBundle({ requireFresh:false })
console.log(`[contributions] Verified matching calendar and animations: ${calendar.total} contributions, fetched ${snapshot.fetchedAt}.`)

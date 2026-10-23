import { verifyContributionBundle } from './sync-contribution-snake.mjs'

// Compatibility with the existing build command: verify the unified bundle,
// without fetching another feed or silently deploying a checked-in fallback.
const { calendar, snapshot } = await verifyContributionBundle()
console.log(`[contributions] Verified matching calendar and animations: ${calendar.total} contributions, fetched ${snapshot.fetchedAt}.`)

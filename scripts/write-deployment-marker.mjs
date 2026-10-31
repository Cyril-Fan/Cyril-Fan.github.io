import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Written only into the build artifact. Git's content marker names the parent
// commit; only the build knows the SHA that is actually being deployed.
export async function writeDeploymentMarker(directory, sha = process.env.GITHUB_SHA) {
  if (!sha) return
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid deployment commit')
  const file = join(directory, 'data/cms-release.json')
  let previous = {}
  try { previous = JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  await mkdir(join(directory, 'data'), { recursive: true })
  await writeFile(file, JSON.stringify({ ...previous, deployedCommit:sha }) + '\n')
}

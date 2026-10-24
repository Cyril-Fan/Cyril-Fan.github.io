import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Usage: npm run avatar:friend -- /path/to/photo.jpg friend-name
const [input, name] = process.argv.slice(2)
if (!input || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name || '')) {
  throw new Error('Usage: npm run avatar:friend -- <image-file> <lowercase-name>')
}
const outputDirectory = fileURLToPath(new URL('../public/links/', import.meta.url))
const output = path.join(outputDirectory, `${name}.webp`)
if (path.resolve(input) === path.resolve(output)) throw new Error('Use the original image as input; do not repeatedly recompress an existing avatar.')
const image = sharp(input, { limitInputPixels: 40_000_000 })
const metadata = await image.metadata()
if ((metadata.pages || 1) > 1) throw new Error('Use a still image for a friend avatar.')
await mkdir(outputDirectory, { recursive: true })
await image.rotate().webp({ lossless:true, effort:6 }).toFile(output)
console.log(`Saved ${path.relative(process.cwd(), output)} (lossless WebP, original dimensions, metadata removed).`)

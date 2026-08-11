/**
 * Genere les icones PWA a partir de `assets/logo-source.png`.
 * Usage : node scripts/generate-icons.mjs
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const PUBLIC = join(process.cwd(), 'public')
const ASSETS = join(process.cwd(), 'assets')
const SOURCE = join(ASSETS, 'logo-source.png')

/* Le logo source est opaque : son pourtour est deja blanc. On complete donc
   en blanc, sinon le carre blanc de l'image ressortirait sur un fond mint. */
const BACKGROUND = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 }

if (!existsSync(SOURCE)) {
  console.error(`Source introuvable : ${SOURCE}`)
  console.error('Enregistre le logo sous assets/logo-source.png puis relance.')
  process.exit(1)
}

const targets = [
  { file: 'icon-192.png', size: 192, flatten: false },
  { file: 'icon-512.png', size: 512, flatten: false },
  // iOS n'applique pas de masque et gere mal l'alpha : fond opaque.
  { file: 'apple-touch-icon.png', size: 180, flatten: true },
  { file: 'favicon-32.png', size: 32, flatten: false },
]

for (const { file, size, flatten } of targets) {
  let pipeline = sharp(SOURCE).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  if (flatten) pipeline = pipeline.flatten({ background: BACKGROUND })
  await pipeline.png({ compressionLevel: 9 }).toFile(join(PUBLIC, file))
  console.log(`✓ ${file} (${size}×${size})`)
}

/* Icone maskable : Android rogne jusqu'a 20 % sur chaque bord. On reduit donc
   le logo a 80 % et on comble avec le fond de marque. */
const MASKABLE = 512
const inner = Math.round(MASKABLE * 0.8)
const pad = Math.round((MASKABLE - inner) / 2)

await sharp({
  create: { width: MASKABLE, height: MASKABLE, channels: 4, background: BACKGROUND },
})
  .composite([
    {
      input: await sharp(SOURCE)
        .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
      top: pad,
      left: pad,
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(join(PUBLIC, 'icon-maskable-512.png'))

console.log(`✓ icon-maskable-512.png (512×512, zone sure 80 %)`)

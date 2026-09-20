/**
 * Genere les icones PWA a partir de `assets/logo-source.png`.
 * Usage : node scripts/generate-icons.mjs
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
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

/* ──────────────────────────────────────────────────────────────────────────
   Ecrans de demarrage iOS.

   Android compose le sien a partir du manifeste (`background_color`, icone,
   nom). iOS, lui, n'affiche RIEN sans `apple-touch-startup-image` : une PWA
   installee s'ouvre sur un blanc franc le temps du chargement. On genere donc
   une image par gabarit d'ecran, reprenant le degrade et le logo du splash
   applicatif — la transition de l'une a l'autre devient invisible.
   ────────────────────────────────────────────────────────────────────────── */

const SPLASH_DIR = join(PUBLIC, 'splash')

/** Gabarits portrait des iPhone encore en service. */
const SPLASHES = [
  { w: 1290, h: 2796 }, // 430 x 932 @3  — 14/15/16 Pro Max
  { w: 1284, h: 2778 }, // 428 x 926 @3  — 12/13/14 Plus, Pro Max
  { w: 1242, h: 2688 }, // 414 x 896 @3  — XS Max, 11 Pro Max
  { w: 1179, h: 2556 }, // 393 x 852 @3  — 14/15/16 Pro
  { w: 1170, h: 2532 }, // 390 x 844 @3  — 12/13/14
  { w: 1125, h: 2436 }, // 375 x 812 @3  — X, XS, 11 Pro
  { w: 828, h: 1792 },  // 414 x 896 @2  — XR, 11
  { w: 750, h: 1334 },  // 375 x 667 @2  — SE 2/3, 8
  { w: 640, h: 1136 },  // 320 x 568 @2  — SE 1
]

function gradient(w, h) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <defs>
         <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0%" stop-color="#E9FFF4"/>
           <stop offset="45%" stop-color="#A9FBD7"/>
           <stop offset="100%" stop-color="#E4EEE8"/>
         </linearGradient>
       </defs>
       <rect width="${w}" height="${h}" fill="url(#g)"/>
     </svg>`
  )
}

async function generateSplashes() {
  await mkdir(SPLASH_DIR, { recursive: true })

  for (const { w, h } of SPLASHES) {
    // Le logo occupe ~22 % de la largeur : assez present pour etre le sujet,
    // assez discret pour ne pas paraitre etire sur les petits ecrans.
    const logoSize = Math.round(w * 0.22)
    const logo = await sharp(SOURCE)
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()

    await sharp(gradient(w, h))
      .composite([{ input: logo, gravity: 'centre' }])
      .png()
      .toFile(join(SPLASH_DIR, `splash-${w}x${h}.png`))

    console.log(`  public/splash/splash-${w}x${h}.png`)
  }
}

await generateSplashes()
console.log('Ecrans de demarrage iOS generes.')

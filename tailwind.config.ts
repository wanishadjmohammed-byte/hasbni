import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: '#0B3A2B',   // ink : texte, titres
        brand: '#22A06B',  // CTA principal, etats actifs, focus rings
        ocean: '#14724F',  // hover des boutons brand
        cream: '#FFFAE6',
        mist: '#E9FFF4',   // base du fond de page
        frost: '#A9FBD7',  // milieu du degrade
        silver: '#E4EEE8', // bordures, fonds discrets
        credit: '#15A05F', // il me doit (+)
        debit: '#E5484D',  // je lui dois (-)
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config

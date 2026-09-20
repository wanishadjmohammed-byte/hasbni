import type { NextConfig } from 'next'

/**
 * Identifiant de build, injecte dans le client.
 *
 * Il sert a nommer le service worker (`/sw.js?v=…`). Comme l'URL change a
 * chaque deploiement, le navigateur considere le fichier comme un NOUVEAU
 * service worker et l'installe — au lieu de garder l'ancien indefiniment.
 *
 * C'est ce qui evite d'avoir a se souvenir d'incrementer un numero de version
 * a la main dans `public/sw.js` : un oubli, et les appareils deja installes
 * restent sur l'ancienne version sans que personne ne s'en apercoive.
 */
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  process.env.GITHUB_SHA?.slice(0, 12) ??
  String(Date.now())

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
}

export default nextConfig

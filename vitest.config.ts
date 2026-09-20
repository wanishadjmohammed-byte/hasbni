import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` leve une exception hors contexte serveur React. Les
      // modules de la console l'importent comme garde-fou de build ; sous
      // Vitest on le neutralise pour pouvoir les tester.
      'server-only': fileURLToPath(new URL('./src/lib/__tests__/stub-server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

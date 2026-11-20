import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Chemin de base : "/" en local ; ex. "/repere-rail/" pour GitHub Pages (BASE_PATH=/repere-rail/).
const base = process.env.BASE_PATH ?? '/';
// Aperçu publié sur claude.ai (VITE_PREVIEW=1) : chemins relatifs, sans service worker ni dossier public.
const preview = process.env.VITE_PREVIEW === '1';

export default defineConfig({
  base: preview ? './' : base,
  build: preview ? { outDir: 'dist-preview', copyPublicDir: false } : undefined,
  plugins: [
    react(),
    !preview && VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png', 'fonts/**/*.pbf'],
      manifest: {
        name: 'Repère Rail',
        short_name: 'Repère Rail',
        description: 'Se repérer le long des voies : PK, ligne, signaux, PN, gares, tunnels.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#112f54',
        theme_color: '#112f54',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // L'appli elle-même est précachée ; les données sont gérées à part (bouton « hors-ligne »).
        globPatterns: ['**/*.{js,css,html,png,svg,pbf}'],
        globIgnores: ['data/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/\/data\//],
        runtimeCaching: [
          {
            // Cases de localisation, fiches de ligne, index : même cache que le téléchargement hors-ligne.
            urlPattern: ({ url }) => /\/data\/(cells|lines)\/|\/data\/gares\.json$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'repere-data' },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/data/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'repere-data', networkTimeoutSeconds: 4 },
          },
          {
            // Fond de carte OpenFreeMap (style, tuiles, sprites).
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fond-plan', expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 24 * 3600 } },
          },
          {
            // Photo aérienne IGN.
            urlPattern: ({ url }) => url.hostname === 'data.geopf.fr',
            handler: 'CacheFirst',
            options: { cacheName: 'fond-photo', expiration: { maxEntries: 2500, maxAgeSeconds: 90 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
});

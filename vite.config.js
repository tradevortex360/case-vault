import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [preact(), VitePWA({
    injectRegister: null, registerType: 'autoUpdate', filename: 'sw.js',
    includeAssets: ['fonts/*.ttf', 'icon.svg'],
    manifest: { name: 'Case Vault', short_name: 'Case Vault', description: 'Your cases, timelines and replies — offline', theme_color: '#24456b', background_color: '#f6f4ef', display: 'standalone', start_url: './', scope: './',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ttf,png,svg,mjs}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      runtimeCaching: [
        { urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co') || url.hostname.endsWith('huggingface.co'), handler: 'CacheFirst', options: { cacheName: 'smart-search-model', expiration: { maxEntries: 60 }, cacheableResponse: { statuses: [0, 200] } } },
      ],
    },
  })],
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
});

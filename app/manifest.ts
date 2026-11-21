import type { MetadataRoute } from 'next'

// Served at /manifest.webmanifest. Placeholder icons until brand icons land.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hudo',
    short_name: 'Hudo',
    description: 'Video review platform for talent agencies',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#111827',
    theme_color: '#111827',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

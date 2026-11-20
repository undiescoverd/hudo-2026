import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hudo',
    short_name: 'Hudo',
    description: 'Video review platform for talent agencies',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1f232b',
    theme_color: '#1f232b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

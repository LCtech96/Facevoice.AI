/** @type {import('next').NextConfig} */
const nextConfig = {
  // Font del marchio per le immagini dei caroselli del blog (lette dal server).
  outputFileTracingIncludes: {
    '/api/blog/post': ['./lib/fonts/**'],
    '/api/admin/blog-auto/run': ['./lib/fonts/**'],
    // Area clienti: slide con i font del marchio e prova dei font caricati.
    '/api/app/assistant': ['./lib/fonts/**'],
    '/api/app/posts': ['./lib/fonts/**'],
    '/api/app/brand': ['./lib/fonts/**'],
  },
  // Pagine dei contratti condivisi (/c/<token>): mai indicizzate, mai dentro un'altra pagina,
  // il token non esce come referrer.
  async headers() {
    return [
      {
        source: '/c/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      // Video risposte mandate come link (/v/<codice>): mai indicizzate, il codice non esce come referrer.
      {
        source: '/v/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/intrattenimento',
        destination: '/home',
        permanent: true,
      },
      {
        source: '/intrattenimento/:slug',
        destination: '/home',
        permanent: true,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'anbkdvcnewocappmsbnc.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'https',
        hostname: '**.higgsfield.ai',
      },
      {
        protocol: 'https',
        hostname: '**.runwayml.com',
      },
      {
        protocol: 'https',
        hostname: '**.domoai.app',
      },
      {
        protocol: 'https',
        hostname: '**.synthesia.io',
      },
      {
        protocol: 'https',
        hostname: '**.pika.art',
      },
      {
        protocol: 'https',
        hostname: '**.google.dev',
      },
      {
        protocol: 'https',
        hostname: '**.google.com',
      },
      {
        protocol: 'https',
        hostname: '**.openai.com',
      },
      {
        protocol: 'https',
        hostname: '**.midjourney.com',
      },
      {
        protocol: 'https',
        hostname: '**.canva.com',
      },
      {
        protocol: 'https',
        hostname: '**.adobe.com',
      },
      {
        protocol: 'https',
        hostname: '**.openart.ai',
      },
      {
        protocol: 'https',
        hostname: '**.khroma.co',
      },
      {
        protocol: 'https',
        hostname: '**.deeparteffects.com',
      },
      {
        protocol: 'https',
        hostname: '**.jasper.ai',
      },
      {
        protocol: 'https',
        hostname: '**.vreelabs.ai',
      },
      {
        protocol: 'https',
        hostname: '**.figma.com',
      },
      {
        protocol: 'https',
        hostname: '**.uizard.io',
      },
      {
        protocol: 'https',
        hostname: '**.visily.ai',
      },
      {
        protocol: 'https',
        hostname: '**.uxpin.com',
      },
      {
        protocol: 'https',
        hostname: '**.uxpilot.ai',
      },
      {
        protocol: 'https',
        hostname: '**.wordtune.com',
      },
      {
        protocol: 'https',
        hostname: '**.fireflies.ai',
      },
      {
        protocol: 'https',
        hostname: '**.otter.ai',
      },
      {
        protocol: 'https',
        hostname: '**.elevenlabs.io',
      },
      {
        protocol: 'https',
        hostname: '**.creatio.com',
      },
      {
        protocol: 'https',
        hostname: '**.opus.pro',
      },
      {
        protocol: 'https',
        hostname: '**.muapi.ai',
      },
      {
        protocol: 'https',
        hostname: '**.aitryon.ai',
      },
      {
        protocol: 'https',
        hostname: '**.descript.com',
      },
      {
        protocol: 'https',
        hostname: '**.klingai.com',
      },
      {
        protocol: 'https',
        hostname: '**.chatgpt.com',
      },
      {
        protocol: 'https',
        hostname: '**.gemini.google.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
}

export default nextConfig


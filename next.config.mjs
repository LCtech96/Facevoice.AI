/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ],
  },
}

export default nextConfig


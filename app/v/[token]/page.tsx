import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { watchVideo } from '@/lib/saas/video-replies'

// Pagina di un video risposta mandato come link nei messaggi diretti (file troppo pesante per
// l'allegato del canale). Si apre solo con il codice del link; mostra solo il video e il suo
// titolo, nessun altro dato dello spazio. Mai indicizzata.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Video',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
  openGraph: null,
  twitter: null,
}

export default async function VideoWatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const video = await watchVideo(typeof token === 'string' ? token.slice(0, 64) : '')
  if (!video) notFound()
  return (
    <main style={{ minHeight: '100dvh', background: '#000', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }}>
      <video src={video.url} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 480, maxHeight: '80dvh', borderRadius: 16, background: '#111' }} />
      <h1 translate="no" style={{ fontSize: 16, fontWeight: 600, textAlign: 'center', margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {video.title}
      </h1>
    </main>
  )
}

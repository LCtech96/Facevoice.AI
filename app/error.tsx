'use client'

import { useEffect } from 'react'

// Al posto della pagina bianca: messaggio e pulsante per ricaricare.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('page error:', error)
  }, [error])

  return (
    <main
      style={{ minHeight: '100vh', background: '#120400', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <p style={{ fontSize: 20, fontWeight: 600 }}>Qualcosa non si è caricato bene</p>
        <p style={{ marginTop: 8, opacity: 0.7, fontSize: 15 }}>Probabilmente il sito è stato appena aggiornato.</p>
        <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 18px', borderRadius: 999, background: '#ff6a1a', color: '#fff', fontWeight: 600, border: 0 }}
          >
            Ricarica
          </button>
          <button
            onClick={reset}
            style={{ padding: '10px 18px', borderRadius: 999, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.3)' }}
          >
            Riprova
          </button>
        </div>
      </div>
    </main>
  )
}

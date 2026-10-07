'use client'

// Errore nel layout principale: pagina minima autonoma (ha il suo <html>).
export default function GlobalError() {
  return (
    <html lang="it">
      <body style={{ margin: 0, minHeight: '100vh', background: '#120400', color: '#fff', fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <p style={{ fontSize: 20, fontWeight: 600 }}>Qualcosa non si è caricato bene</p>
          <p style={{ marginTop: 8, opacity: 0.7, fontSize: 15 }}>Probabilmente il sito è stato appena aggiornato.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: '10px 18px', borderRadius: 999, background: '#ff6a1a', color: '#fff', fontWeight: 600, border: 0 }}
          >
            Ricarica
          </button>
        </div>
      </body>
    </html>
  )
}

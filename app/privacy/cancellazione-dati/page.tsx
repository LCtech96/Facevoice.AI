import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import { SITE_URL } from '@/lib/seo/site'

const PATH = '/privacy/cancellazione-dati'

export const metadata: Metadata = {
  title: 'Cancellazione dei dati | Facevoice AI',
  description:
    'Come richiedere la cancellazione dei dati personali trattati da Facevoice AI, inclusi i messaggi ricevuti tramite WhatsApp, Messenger e Instagram.',
  alternates: { canonical: `${SITE_URL}${PATH}` },
}

export default function DataDeletionPage() {
  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-24">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
          Cancellazione dei dati
        </h1>

        <div className="mt-8 space-y-8 text-[var(--text-secondary)] leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Quali dati conserviamo</h2>
            <p>
              Quando scrivi a Facevoice AI tramite WhatsApp, Messenger o Instagram, conserviamo il
              numero di telefono o l&apos;identificativo dell&apos;account, il nome del profilo, il
              testo dei messaggi e le risposte inviate, compresi quelli generati dal nostro
              assistente AI. Li usiamo solo per rispondere alle tue richieste e per mantenere lo
              storico della conversazione.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Come chiedere la cancellazione</h2>
            <p>
              Scrivi a{' '}
              <a href="mailto:privacy@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                privacy@facevoice.ai
              </a>{' '}
              con oggetto &ldquo;Cancellazione dati&rdquo;, indicando il numero di telefono o
              l&apos;account social con cui ci hai contattato.
            </p>
            <p>
              Cancelleremo i dati collegati e ti invieremo una conferma entro un mese dalla
              richiesta, come previsto dall&apos;art. 12 del Regolamento UE 2016/679. Restano esclusi
              solo i dati che la legge ci obbliga a conservare.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Maggiori informazioni</h2>
            <p>
              Per tutti i dettagli sul trattamento dei dati personali consulta l&apos;
              <a href="/privacy" className="text-[var(--accent-blue)] hover:underline">
                Informativa Privacy
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}

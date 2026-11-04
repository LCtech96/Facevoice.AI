import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { SITE_URL } from '@/lib/seo/site'

const PATH = '/piattaforma'

export const metadata: Metadata = {
  title: 'Piattaforma Facevoice AI | Tutti i messaggi in un unico posto',
  description:
    'La piattaforma Facevoice AI raccoglie in una sola casella i messaggi di Facebook, Instagram, WhatsApp ed email e prepara le risposte con l’intelligenza artificiale.',
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    url: `${SITE_URL}${PATH}`,
    type: 'website',
    siteName: 'Facevoice AI',
    title: 'Piattaforma Facevoice AI',
    description: 'Tutti i messaggi di Facebook, Instagram, WhatsApp ed email in un unico posto, con risposte preparate dall’AI.',
    images: [{ url: `${SITE_URL}/icon-512.png`, width: 512, height: 512 }],
  },
}

const FEATURES = [
  {
    title: 'Un’unica casella per tutti i messaggi',
    text: 'I messaggi ricevuti su Facebook Messenger, Instagram Direct, WhatsApp ed email arrivano in un solo posto, l’omnichat. Ogni conversazione resta completa, con i messaggi ricevuti e le risposte inviate.',
  },
  {
    title: 'Istruzioni per ogni canale',
    text: 'Scrivi come vuoi che si risponda: tono, prezzi, orari, cosa dire e cosa evitare. Puoi dare istruzioni diverse per Instagram, Facebook, WhatsApp ed email.',
  },
  {
    title: 'Risposte preparate dall’AI, decidi tu',
    text: 'Per ogni canale scegli se tenere l’automazione spenta, approvare ogni risposta prima dell’invio o lasciare che le risposte partano da sole. Le risposte seguono le tue istruzioni e la lingua di chi scrive.',
  },
  {
    title: 'I tuoi dati restano tuoi',
    text: 'Colleghi solo gli account che scegli tu, con l’accesso ufficiale di Meta o con la tua casella email. Non usiamo i dati per pubblicità e puoi scollegare ogni account quando vuoi.',
  },
]

const STEPS = [
  'Ti registri con email o con Google e crei lo spazio della tua attività.',
  'Colleghi la tua Pagina Facebook e il tuo Instagram professionale con l’accesso di Facebook, e la tua email.',
  'Scrivi le istruzioni per ogni canale e scegli il livello di automazione.',
  'Rispondi a tutti dall’omnichat, o approvi le risposte preparate dall’AI.',
]

export default function PlatformPage() {
  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-24">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--accent-blue)]">Piattaforma</p>
        <h1 className="mt-2 text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
          Tutti i messaggi della tua attività in un unico posto
        </h1>
        <p className="mt-4 text-lg text-[var(--text-secondary)] leading-relaxed">
          Facevoice AI è la piattaforma per piccole e medie imprese che ricevono messaggi su più canali.
          Raccoglie Facebook, Instagram, WhatsApp ed email in una sola casella e prepara le risposte con
          l&apos;intelligenza artificiale, seguendo le tue istruzioni.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <section key={f.title} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-5">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{f.title}</h2>
              <p className="mt-2 text-[var(--text-secondary)] leading-relaxed">{f.text}</p>
            </section>
          ))}
        </div>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Come funziona</h2>
          <ol className="mt-4 space-y-3 list-decimal pl-6 text-[var(--text-secondary)] leading-relaxed">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section className="mt-12 space-y-3 text-[var(--text-secondary)] leading-relaxed">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Chi siamo</h2>
          <p>
            La piattaforma è sviluppata e gestita da FacevoiceAI (P. IVA 07272010823), Via Vito Di Stefano 32 -
            Terrasini (PA), Italia. Contatti:{' '}
            <a href="mailto:info@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
              info@facevoice.ai
            </a>
            .
          </p>
          <p>
            Leggi l&apos;
            <Link href="/privacy" className="text-[var(--accent-blue)] hover:underline">
              Informativa Privacy
            </Link>
            , le{' '}
            <Link href="/termini" className="text-[var(--accent-blue)] hover:underline">
              Condizioni d&apos;uso
            </Link>{' '}
            e come richiedere la{' '}
            <Link href="/privacy/cancellazione-dati" className="text-[var(--accent-blue)] hover:underline">
              cancellazione dei dati
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  )
}

import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import { SITE_URL } from '@/lib/seo/site'

const PATH = '/termini'

export const metadata: Metadata = {
  title: "Condizioni d'uso | Facevoice AI",
  description:
    "Condizioni d'uso del sito e della piattaforma Facevoice AI, compreso il collegamento degli account Facebook, Instagram, WhatsApp ed email.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: { url: `${SITE_URL}${PATH}`, type: 'website', siteName: 'Facevoice AI' },
}

const link = 'text-[var(--accent-blue)] hover:underline'

export default function TermsPage() {
  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-24">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
          Condizioni d&apos;uso
        </h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Ultimo aggiornamento: 3 novembre 2026</p>

        <div className="mt-8 space-y-8 text-[var(--text-secondary)] leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">1. Chi siamo</h2>
            <p>
              Il sito facevoice.ai e la piattaforma Facevoice AI sono gestiti da FacevoiceAI (P. IVA
              07272010823), Via Vito Di Stefano 32 - Terrasini (PA), Italia. Contatti:{' '}
              <a href="mailto:info@facevoice.ai" className={link}>
                info@facevoice.ai
              </a>
              .
            </p>
            <p>
              Usando il sito o la piattaforma accetti queste condizioni. Se non le accetti, non usare
              il servizio.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">2. Il servizio</h2>
            <p>
              La piattaforma permette alle attività registrate di raccogliere in un&apos;unica
              casella (omnichat) i messaggi ricevuti su Facebook Messenger, Instagram Direct,
              WhatsApp ed email, di scrivere istruzioni per ogni canale e di far preparare o inviare
              risposte da un assistente di intelligenza artificiale.
            </p>
            <p>
              Per ogni canale puoi scegliere se tenere l&apos;automazione spenta, approvare ogni
              risposta prima dell&apos;invio o lasciare che le risposte partano in automatico.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">3. Account e collegamento dei canali</h2>
            <p>
              Ti registri con email o con Google e devi fornire dati veri. Sei responsabile di chi
              usa il tuo account e del tuo spazio di lavoro.
            </p>
            <p>
              Puoi collegare solo Pagine Facebook, account Instagram, numeri WhatsApp e caselle
              email che gestisci o che hai il diritto di usare. Il collegamento a Facebook e
              Instagram avviene con l&apos;accesso di Meta: scegli tu quali Pagine e account
              autorizzare e puoi revocare l&apos;accesso in qualsiasi momento dalla piattaforma o
              dalle impostazioni del tuo account Facebook.
            </p>
            <p>
              Usiamo i dati ricevuti da Meta solo per mostrarti i messaggi, preparare e inviare le
              risposte che hai autorizzato e far funzionare il servizio. Non li vendiamo e non li
              usiamo per pubblicità. Rispettiamo le{' '}
              <a href="https://developers.facebook.com/terms" className={link} target="_blank" rel="noopener noreferrer">
                Condizioni della piattaforma Meta
              </a>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">4. Uso corretto</h2>
            <p>Non puoi usare il servizio per:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>inviare spam o messaggi non richiesti;</li>
              <li>violare le regole di Meta, WhatsApp, Google o del tuo fornitore di posta;</li>
              <li>trattare dati di altre persone senza una base legale;</li>
              <li>contenuti illegali, offensivi, ingannevoli o che violano diritti di terzi.</li>
            </ul>
            <p>Possiamo sospendere gli account che violano queste regole.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">5. Risposte dell&apos;intelligenza artificiale</h2>
            <p>
              Le risposte sono generate automaticamente in base alle tue istruzioni e possono
              contenere errori. Sei responsabile delle istruzioni che dai e dei messaggi inviati dal
              tuo spazio di lavoro, anche quando l&apos;invio è automatico.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">6. Dati personali</h2>
            <p>
              Il trattamento dei dati è descritto nell&apos;
              <a href="/privacy" className={link}>
                Informativa Privacy
              </a>
              . Per i messaggi dei tuoi clienti tu sei titolare del trattamento e Facevoice AI agisce
              come responsabile, trattandoli solo per fornirti il servizio.
            </p>
            <p>
              Quando scolleghi un canale smettiamo di ricevere i suoi messaggi. Per cancellare i dati
              segui la pagina{' '}
              <a href="/privacy/cancellazione-dati" className={link}>
                Cancellazione dei dati
              </a>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">7. Disponibilità e responsabilità</h2>
            <p>
              Il servizio dipende anche da Meta, Google, dai fornitori di posta e di intelligenza
              artificiale. Facciamo il possibile per mantenerlo attivo, ma non garantiamo che sia
              sempre disponibile o privo di errori. Nei limiti consentiti dalla legge, non
              rispondiamo di danni indiretti o di perdite dovute a servizi di terzi.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">8. Modifiche e legge applicabile</h2>
            <p>
              Possiamo aggiornare queste condizioni: la data in alto indica l&apos;ultima versione.
              Si applica la legge italiana e, salvo diversa norma inderogabile a tutela del
              consumatore, è competente il Foro di Palermo.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}

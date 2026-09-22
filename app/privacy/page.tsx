import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import { SITE_URL } from '@/lib/seo/site'

const PATH = '/privacy'

export const metadata: Metadata = {
  title: 'Informativa Privacy | Facevoice AI',
  description:
    'Informativa Privacy per gli Utenti ai sensi degli Art. 13 e 14 del Regolamento UE n. 2016/679 (GDPR).',
  alternates: { canonical: `${SITE_URL}${PATH}` },
}

const SECTIONS = [
  { id: 'titolare', title: '1. Titolare e/o Contitolari del Trattamento e Responsabile per la protezione dei dati' },
  { id: 'finalita', title: '2. Finalità del trattamento' },
  { id: 'base-legale', title: '3. Base legale e natura obbligatoria o facoltativa del trattamento' },
  { id: 'fonte-dati', title: '4. Fonte dei dati personali e destinatari' },
  { id: 'modalita', title: '5. Modalità di trattamento e categorie di dati trattati' },
  { id: 'trasferimenti', title: '6. Trasferimenti dei dati personali' },
  { id: 'conservazione', title: '7. Conservazione dei dati personali' },
  { id: 'diritti', title: "8. Diritti dell'interessato" },
  { id: 'modifiche', title: '9. Modifiche' },
  { id: 'definizioni', title: '10. Definizioni' },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'Informativa Privacy per gli Utenti',
            url: `${SITE_URL}${PATH}`,
            dateModified: '2026-01-10',
            isPartOf: { '@id': `${SITE_URL}/#website` },
            about: { '@id': `${SITE_URL}/#organization` },
          }),
        }}
      />

      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-24">
        <article className="prose-privacy">
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-2">
            INF-UTPRIVACY · 10/01/2026
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
            Informativa Privacy per gli Utenti
          </h1>
          <p className="mt-2 text-[var(--text-secondary)]">
            Art. 13 e 14 Regolamento UE n. 2016/679
          </p>

          <div className="mt-8 space-y-4 text-[var(--text-secondary)] leading-relaxed">
            <p>
              FacevoiceAI ed i suoi Concessionari, così come definiti all&apos;Art. 10
              della presente informativa, si impegnano a proteggere e
              salvaguardare la Privacy dei propri Utenti e i dati personali da
              loro trattati attraverso i propri prodotti e servizi. La presente
              informativa, resa agli Utenti e alle persone fisiche che operano
              in nome e per loro conto, spiega come FacevoiceAI, in sinergia con
              i suoi Concessionari, si impegna a tutelare le informazioni
              raccolte per l&apos;utilizzo dei nostri prodotti e servizi. La
              tecnologia dei prodotti e servizi FacevoiceAI è, infatti, in
              continua evoluzione per assicurare adeguati livelli di Privacy,
              sicurezza e trasparenza.
            </p>
            <p>
              In particolare, questo documento descrive come vengono utilizzati
              e gestiti i dati raccolti. Forniamo nel prosieguo i recapiti
              necessari per contattarci nel caso l&apos;Interessato voglia
              porre ulteriori domande.
            </p>
            <p>
              In generale, ogni informazione o dato personale che verrà
              fornito a FacevoiceAI ed ai suoi Concessionari nell&apos;ambito
              dell&apos;utilizzo dei prodotti e servizi offerti da FacevoiceAI
              (i &ldquo;Servizi&rdquo;), come meglio definiti successivamente,
              sarà trattato secondo i principi, internazionalmente
              riconosciuti, di liceità, correttezza, trasparenza, limitazione
              delle finalità e della conservazione, minimizzazione dei dati,
              esattezza, integrità e riservatezza.
            </p>
            <p>
              La presente informativa è stata redatta in data 10 gennaio 2026;
              occasionalmente potremmo aver bisogno di modificarla, anche a
              causa di variazioni della normativa applicabile. Per restare
              aggiornato, invitiamo l&apos;Interessato a visitare con
              regolarità questa sezione per prendere cognizione della più
              recente ed aggiornata versione.
            </p>
            <p>
              Utilizzando i nostri Servizi, gli interessati acconsentono
              all&apos;uso dei propri dati ai sensi della presente Informativa
              sulla Privacy. Laddove l&apos;Interessato non fosse d&apos;accordo
              con questa Informativa sulla Privacy, sarà necessario
              interrompere l&apos;utilizzo dei nostri Servizi.
            </p>
          </div>

          <nav aria-label="Indice" className="mt-10 p-5 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 uppercase tracking-wide">
              Indice
            </h2>
            <ol className="space-y-1.5 text-sm">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-[var(--accent-blue)] hover:underline"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-12 space-y-10 text-[var(--text-secondary)] leading-relaxed">
            <section id="titolare">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[0].title}
              </h2>
              <div className="space-y-4">
                <p>
                  Per le finalità indicate in questa informativa, FacevoiceAI
                  (P. IVA 07272010823) può agire sia in qualità di Titolare del
                  trattamento ai sensi dell&apos;Art. 4 par. 7 del Regolamento
                  UE 2016/679, sia di Contitolare del trattamento dati ai sensi
                  dell&apos;Art. 26 del medesimo Regolamento UE 2016/679, a
                  seconda delle circostanze.
                </p>
                <p>
                  FacevoiceAI assume il ruolo di Titolare del trattamento in
                  tutte le circostanze in cui il rapporto tra FacevoiceAI e
                  l&apos;Utente è diretto e non coinvolge alcun soggetto agente
                  in qualità di Partner, distributore o promotore dei prodotti
                  e/o servizi di FacevoiceAI, qui indicati come Concessionari.
                </p>
                <p>
                  FacevoiceAI assume il ruolo di Contitolare del trattamento
                  congiuntamente con uno o più soggetti nei casi in cui il
                  rapporto con l&apos;Utente coinvolga Concessionari dei
                  prodotti e/o servizi di FacevoiceAI.
                </p>
                <p>
                  Il punto di contatto unico per gli interessati sia nel caso
                  in cui FacevoiceAI operi nella qualità di Titolare, sia nel
                  caso operi nella qualità di Contitolare congiuntamente a uno
                  o più dei suoi Concessionari è FacevoiceAI, con sede in Via
                  Vito Di Stefano 32 - Terrasini (PA), Italia, contattabile al
                  seguente indirizzo:{' '}
                  <a href="mailto:privacy@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                    privacy@facevoice.ai
                  </a>
                  .
                </p>
                <p>
                  FacevoiceAI ed il Concessionario di riferimento hanno
                  sottoscritto un accordo contenente le rispettive
                  responsabilità in merito all&apos;osservanza degli obblighi
                  derivanti dalla normativa vigente, ed in particolare riguardo
                  all&apos;esercizio dei diritti dell&apos;Interessato.
                </p>
                <p>
                  FacevoiceAI ha nominato un Responsabile per la protezione dei
                  dati (RPD) contattabile, per qualsiasi esigenza connessa al
                  trattamento dei dati da parte dei contitolari, al seguente
                  indirizzo:{' '}
                  <a href="mailto:info@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                    info@facevoice.ai
                  </a>{' '}
                  o al numero{' '}
                  <a href="tel:+393514206353" className="text-[var(--accent-blue)] hover:underline">
                    +39 351 420 6353
                  </a>
                  .
                </p>
                <p>
                  Per informazioni circa la nomina di un Responsabile per la
                  protezione dei dati da parte del Concessionario Contitolare,
                  è necessario rivolgersi direttamente al proprio Concessionario
                  di riferimento.
                </p>
                <p>
                  Per quanto riguarda i dati personali trattati tramite le
                  applicazioni fornite all&apos;Utente da parte di FacevoiceAI,
                  la titolarità del trattamento rimane in capo all&apos;azienda
                  cliente medesima, che agisce quale Titolare nei confronti dei
                  propri dipendenti, collaboratori e clienti. In tali casi,
                  FacevoiceAI opera esclusivamente quale Responsabile del
                  trattamento (ove nominata dal Titolare, ovvero
                  Sub-Responsabile ove nominata dal Responsabile del
                  trattamento), limitatamente alle attività tecniche di
                  erogazione, manutenzione ed assistenza della soluzione
                  applicativa. Resta pertanto in capo all&apos;azienda cliente
                  Titolare l&apos;onere di fornire agli interessati idonea
                  informativa ai sensi degli artt. 13 e 14 del Regolamento UE
                  2016/679, nonché quello di adottare adeguate misure tecniche
                  ed organizzative a garanzia della liceità, correttezza e
                  sicurezza dei trattamenti effettuati tramite le soluzioni
                  applicative.
                </p>
              </div>
            </section>

            <section id="finalita">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[1].title}
              </h2>
              <div className="space-y-4">
                <p>
                  Il/I Titolare/Contitolari tratteranno i dati personali
                  forniti dagli Utenti solo nei modi stabiliti nella presente
                  Informativa Privacy e nel rispetto delle disposizioni
                  legislative vigenti. I Dati Personali verranno utilizzati per
                  le seguenti finalità:
                </p>

                <p>
                  <strong className="text-[var(--text-primary)]">
                    a. Trattamenti effettuati per la Fornitura del
                    servizio/adempimento di obblighi contrattuali e
                    precontrattuali
                  </strong>
                  : per finalità riguardanti l&apos;esecuzione delle
                  obbligazioni previste dalle Condizioni Generali di Contratto
                  (
                  <a
                    href="https://www.garanteprivacy.it/regolamentoue/diritti-degli-interessati"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent-blue)] hover:underline"
                  >
                    garanteprivacy.it
                  </a>
                  ) e dai contratti stipulati con i Concessionari relativi ai
                  prodotti e servizi FacevoiceAI quali in particolare:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>
                    Esecuzione delle attività necessarie alla
                    conclusione/esecuzione del contratto per fornire il
                    servizio/prodotto richiesto o acquistato;
                  </li>
                  <li>Gestione delle richieste di preventivi e di elaborazione degli ordini;</li>
                  <li>
                    Gestione dell&apos;account (incluse eventuali verifiche
                    dell&apos;account e recupero delle credenziali) e usare le
                    funzionalità connesse all&apos;account;
                  </li>
                  <li>Gestione dei reclami;</li>
                  <li>Invio comunicazioni di servizio e aggiornamenti di prodotto;</li>
                  <li>
                    Assistenza, supporto a chi usa i prodotti e servizi
                    FacevoiceAI. A tal fine possono essere trattati anche i
                    dati di utilizzo del prodotto e di dati di contesto (quali
                    in particolare dati tecnici sul dispositivo utilizzato, sul
                    sistema operativo, sui plug-in attivi);
                  </li>
                </ul>

                <p>
                  <strong className="text-[var(--text-primary)]">
                    b. Trattamenti effettuati sulla base del Legittimo
                    interesse prevalente
                  </strong>{' '}
                  del/dei Titolare/Contitolari quale in particolare:
                </p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>
                    Svolgere attività di analisi e di ricerca rispetto ai
                    prodotti e ai servizi forniti e all&apos;utilizzo degli
                    stessi da parte degli Utenti, per migliorarli e
                    svilupparli;
                  </li>
                  <li>
                    Operare verifiche e valutazioni sulle risultanze e
                    sull&apos;andamento del rapporto contrattuale, nonché sui
                    rischi ad esso connessi (veridicità dei dati forniti,
                    solvibilità anche in corso di rapporto);
                  </li>
                  <li>
                    Invio di offerte promozionali ai propri Utenti: per
                    trasmettere comunicazioni di marketing ed effettuare
                    chiamate telefoniche riguardanti prodotti e servizi simili
                    a quelli già acquistati. L&apos;Interessato potrà
                    interrompere, in qualunque momento e gratuitamente, la
                    ricezione di queste comunicazioni, scrivendo a{' '}
                    <a href="mailto:privacy@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                      privacy@facevoice.ai
                    </a>
                    , ferma restando la liceità del trattamento;
                  </li>
                  <li>
                    Valutare il grado di soddisfazione degli Utenti in
                    relazione ai prodotti/servizi acquistati, per risolvere
                    eventuali difficoltà e problemi legati al loro uso e
                    migliorare la qualità dei servizi offerti;
                  </li>
                  <li>Far valere e difendere i diritti del/dei Titolare/Contitolari;</li>
                  <li>
                    Eseguire attività di segmentazione della clientela basate
                    su categorie non invasive di appartenenza;
                  </li>
                  <li>
                    Gestire le risorse informatiche del/dei
                    Titolare/Contitolari, incluse infrastrutture, siti web ed
                    apparati tecnologici.
                  </li>
                </ul>

                <p>
                  <strong className="text-[var(--text-primary)]">
                    c. Trattamenti effettuati per adempiere ad Obblighi di
                    legge
                  </strong>{' '}
                  cui sono soggetti il/i Titolare/Contitolari del trattamento
                  quali in particolare la normativa fiscale e antiriciclaggio.
                </p>

                <p>
                  <strong className="text-[var(--text-primary)]">d. Marketing</strong>:
                  inviare comunicazioni di marketing non direttamente correlate
                  ai prodotti e servizi FacevoiceAI in uso, a chiunque abbia
                  preventivamente prestato il proprio consenso.
                </p>

                <p>
                  <strong className="text-[var(--text-primary)]">
                    e. Integrazione con Applicazioni Google
                  </strong>
                  : nell&apos;ambito dell&apos;utilizzo dei nostri prodotti,
                  FacevoiceAI utilizza le API di Google per offrire servizi
                  avanzati agli Utenti dei servizi Google, nel rispetto dei
                  consensi da essi forniti (Autenticazione, Sincronizzazione
                  calendari, Accesso alla posta elettronica).
                </p>

                <p>
                  <strong className="text-[var(--text-primary)]">
                    f. Utilizzo di sistemi di intelligenza artificiale (IA)
                  </strong>
                  : FacevoiceAI utilizza sistemi di intelligenza artificiale
                  nel rispetto della normativa vigente. L&apos;intelligenza
                  artificiale è impiegata esclusivamente come strumento di
                  supporto operativo e tecnico all&apos;erogazione dei prodotti
                  e servizi, con sorveglianza e intervento umano. I dati
                  forniti per addestrare i sistemi vengono preventivamente
                  sottoposti a processi di anonimizzazione. L&apos;elenco dei
                  trattamenti è consultabile al seguente link:{' '}
                  <a
                    href="https://www.garanteprivacy.it/regolamentoue/diritti-degli-interessati"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent-blue)] hover:underline"
                  >
                    garanteprivacy.it
                  </a>
                  . Per ulteriori informazioni, l&apos;Utente può contattare il
                  Responsabile della Protezione dei Dati.
                </p>
              </div>
            </section>

            <section id="base-legale">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[2].title}
              </h2>
              <p className="mb-3">
                Le basi legali utilizzate da FacevoiceAI per trattare i Dati
                Personali sono le seguenti:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  <strong className="text-[var(--text-primary)]">
                    Fornitura del servizio/obblighi contrattuali
                  </strong>
                  : Art. 6 par. 1 lett. b Reg. UE 2016/679. Il conferimento non
                  è obbligatorio, ma in mancanza non sarà possibile fornire
                  alcun Servizio.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">
                    Legittimo interesse prevalente
                  </strong>
                  : Art. 6 par. 1, lett. f Reg. UE 2016/679. L&apos;Interessato
                  può opporsi in qualsiasi momento scrivendo a{' '}
                  <a href="mailto:privacy@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                    privacy@facevoice.ai
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Obblighi di legge</strong>
                  : Art. 6 par. 1, lett. c Reg. UE 2016/679. Il conferimento
                  per questa finalità è obbligatorio.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Marketing</strong>:
                  Art. 6 par. 1, lett. a Reg. UE 2016/679 (Consenso). Il
                  consenso è liberamente revocabile in qualsiasi momento.
                </li>
              </ul>
            </section>

            <section id="fonte-dati">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[3].title}
              </h2>
              <p>
                Il/i Titolare/Contitolari raccolgono i dati personali
                direttamente dall&apos;Utente. Alcuni dati possono provenire
                da banche dati pubbliche. I Dati Personali potranno essere
                condivisi con: consulenti (contabili, legali, ecc.),
                piattaforme per la gestione di servizi IT ed e-mail, soggetti
                delegati alla manutenzione tecnica, personale autorizzato,
                società di factoring, ed Autorità competenti. Laddove tali
                soggetti siano nominati responsabili, un elenco completo può
                essere richiesto scrivendo a{' '}
                <a href="mailto:privacy@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                  privacy@facevoice.ai
                </a>
                .
              </p>
            </section>

            <section id="modalita">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[4].title}
              </h2>
              <div className="space-y-4">
                <p>
                  Il trattamento dei dati personali è realizzato tramite
                  operazioni di raccolta, registrazione, organizzazione, ecc.,
                  mediante l&apos;uso di spazi cloud in Unione Europea. Sono
                  implementate misure di sicurezza conformi alle normative
                  europee.
                </p>
                <p>Tipologie di dati raccolti:</p>
                <ul className="list-disc pl-6 space-y-1.5">
                  <li>Dati identificativi, di contatto e accesso;</li>
                  <li>Dati forniti volontariamente;</li>
                  <li>Dati di prodotto, fatturazione e pagamento;</li>
                  <li>Dati di navigazione, di utilizzo e di contesto;</li>
                  <li>Dati bancari;</li>
                  <li>Dati raccolti tramite applicazioni Google.</li>
                </ul>
              </div>
            </section>

            <section id="trasferimenti">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[5].title}
              </h2>
              <p>
                Alcuni dati possono essere trasferiti al di fuori dello
                Spazio Economico Europeo (SEE), ad esempio in caso di
                utilizzo delle API di Google. FacevoiceAI assicura che il
                trasferimento avvenga tramite adeguate garanzie (Art. 45 e 46
                del GDPR). Maggiori informazioni sono disponibili scrivendo
                all&apos;indirizzo{' '}
                <a href="mailto:info@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                  info@facevoice.ai
                </a>
                .
              </p>
            </section>

            <section id="conservazione">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[6].title}
              </h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  <strong className="text-[var(--text-primary)]">Servizio/Contratti</strong>:
                  durata della fornitura e 10 anni successivi.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Trattativa precontrattuale</strong>:
                  durata della trattativa.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Legittimo interesse</strong>:
                  durata della fornitura (salvo contenziosi).
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Marketing</strong>:
                  fino alla revoca del consenso.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">Obblighi di legge</strong>:
                  per il periodo previsto dalla normativa applicabile.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">API di Google</strong>:
                  per la durata del servizio o fino a revoca del consenso.
                </li>
              </ul>
            </section>

            <section id="diritti">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[7].title}
              </h2>
              <div className="space-y-4">
                <p>
                  L&apos;Interessato ha il diritto di esercitare i propri
                  diritti (Accesso, Rettifica, Cancellazione, Limitazione,
                  Portabilità, Opposizione, Revoca del Consenso) scrivendo a{' '}
                  <a href="mailto:privacy@facevoice.ai" className="text-[var(--accent-blue)] hover:underline">
                    privacy@facevoice.ai
                  </a>
                  . L&apos;Utente dei servizi Google può revocare le
                  autorizzazioni direttamente dal proprio account. Maggiori
                  informazioni sui propri diritti sono disponibili alla
                  pagina{' '}
                  <a
                    href="https://www.garanteprivacy.it/regolamentoue/diritti-degli-interessati"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent-blue)] hover:underline"
                  >
                    garanteprivacy.it
                  </a>
                  .
                </p>
                <p>
                  L&apos;Interessato ha il diritto di proporre reclamo
                  all&apos;Autorità di Controllo competente (Garante Privacy).
                </p>
              </div>
            </section>

            <section id="modifiche">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[8].title}
              </h2>
              <p>
                FacevoiceAI ed i Concessionari si riservano di modificare o
                aggiornare la presente Informativa. Invitiamo a visitare con
                regolarità questa sezione.
              </p>
            </section>

            <section id="definizioni">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                {SECTIONS[9].title}
              </h2>
              <p>
                Le definizioni applicabili al presente documento rispecchiano
                fedelmente quelle previste dal Regolamento UE 2016/679 (GDPR)
                in merito a Dato Personale, Trattamento, Titolare,
                Responsabile, Terzo, Consenso, Violazione dei dati. Ai fini
                del presente documento, &ldquo;Concessionario&rdquo; indica il
                partner autorizzato alla distribuzione dei servizi
                FacevoiceAI, e &ldquo;Sistema di Intelligenza
                Artificiale&rdquo; indica i modelli integrati nei prodotti
                FacevoiceAI come supporto operativo.
              </p>
            </section>
          </div>
        </article>
      </div>
    </main>
  )
}

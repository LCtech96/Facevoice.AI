// Termini e condizioni d'uso della piattaforma (area clienti). Solo dati e funzioni pure:
// si usa dalle pagine pubbliche /termini e /termini/<versione>, dalla registrazione, dal
// blocco "accetta i termini" e dal server che registra l'accettazione.
//
// REGOLA: una versione pubblicata non si modifica MAI, nemmeno per una virgola. Chi l'ha
// accettata ha accettato quel testo esatto (se ne salva l'impronta SHA-256). Per cambiare i
// termini si aggiunge una nuova versione all'archivio (con la data come nome), si sposta
// TERMS_VERSION e si fissa la sua impronta in `hash`: gli utenti dovranno accettarla di nuovo.
// Il server rifiuta di registrare un'accettazione se il testo non corrisponde piu' all'impronta.

export type TermsItems = {
  /** Termini e informativa privacy. */
  a: string
  /** Responsabilita' esclusiva e manleva. */
  b: string
  /** Approvazione specifica delle clausole (artt. 1341 e 1342 c.c.). */
  c: string
}

export type PublishedTerms = {
  /** Nome della versione: la data di pubblicazione (AAAA-MM-GG). */
  version: string
  title: string
  /** Testo completo esatto, cosi' come si mostra e si accetta. */
  text: string
  /** Le tre caselle da spuntare per questa versione. */
  items: TermsItems
  /** SHA-256 (esadecimale) del testo, fissata alla pubblicazione. */
  hash: string
}

export const TERMS_TITLE = "Termini e condizioni d'uso della piattaforma Facevoice AI"
export const PRIVACY_URL = 'https://www.facevoice.ai/privacy'
export const TERMS_PATH = '/termini'
/** Evento del browser: il server ha risposto 403 terms_required (il blocco dell'area clienti ricontrolla). */
export const TERMS_REQUIRED_EVENT = 'fv-terms-required'

// ---------------------------------------------------------------------------
// Versione 2026-11-07 (pubblicata: non modificare)
// ---------------------------------------------------------------------------

const TEXT_2026_11_07 = `Termini e condizioni d'uso della piattaforma Facevoice AI
Versione 2026-11-07 · in vigore dal 7 novembre 2026

Questi termini regolano l'uso della piattaforma Facevoice AI. La piattaforma è riservata a imprese, professionisti ed enti che la usano per la propria attività: registrandoti dichiari di agire per scopi legati alla tua attività imprenditoriale, commerciale, artigianale o professionale, e non come consumatore. Se usi la piattaforma per conto di un'impresa, dichiari di avere il potere di accettare questi termini per suo conto.

1. Chi fornisce il servizio
La piattaforma è fornita da Facevoice AI, Via Vito Di Stefano 32, 90049 Terrasini (PA), Italia, P.IVA 07272010823, email info@facevoice.ai ("Facevoice AI" o "noi").
"Cliente" (o "tu") è l'impresa o il professionista che si registra e usa la piattaforma, insieme alle persone che invita nel proprio spazio di lavoro.

2. Il servizio
La piattaforma offre, secondo il piano scelto, queste funzioni:
- Omnichat: una sola casella per i messaggi ricevuti su Facebook Messenger, Instagram Direct, WhatsApp, email e chat del sito;
- risposte con intelligenza artificiale: l'AI prepara o invia le risposte seguendo le istruzioni che scrivi tu; per ogni canale scegli se tenerla spenta, approvare ogni risposta o lasciarla rispondere da sola;
- automazioni: email e messaggi programmati, campagne e risposte automatiche;
- Trova clienti: ricerca di attività da contattare tra i dati pubblici (per esempio Google Maps e siti web) e preparazione dei primi messaggi;
- post: creazione e programmazione di contenuti per i social;
- documenti e contratti: bozze preparate con l'AI, file PDF e link di condivisione protetti da un PIN scelto da te;
- firma elettronica: il destinatario di un contratto può chiedere modifiche e firmarlo online, come spiegato all'articolo 7.
Alcune funzioni sono in prova (beta) o dipendono da servizi di terzi, come Meta, Google, i fornitori di posta e di intelligenza artificiale. Possiamo migliorare, cambiare o togliere funzioni; se togliamo una funzione essenziale del tuo piano a pagamento ti avvisiamo prima.

3. Account e accesso
Ti registri con email e password o con Google e devi fornire dati veri e aggiornati. Tieni riservate le credenziali: sei responsabile di tutto ciò che avviene con il tuo account e nel tuo spazio di lavoro, anche da parte dei colleghi che inviti. Se sospetti un uso non autorizzato scrivici subito a info@facevoice.ai.
Puoi collegare solo pagine, account, numeri e caselle email che gestisci o che hai il diritto di usare. Il collegamento a Facebook, Instagram e WhatsApp avviene con l'accesso di Meta: scegli tu cosa autorizzare e puoi revocare l'accesso in qualsiasi momento. Usiamo i dati ricevuti da Meta e da Google solo per mostrarti i messaggi, preparare e inviare le risposte che hai autorizzato e far funzionare il servizio: non li vendiamo e non li usiamo per pubblicità.

4. Uso consentito
Non puoi usare la piattaforma per:
- inviare spam, messaggi o email commerciali senza una base giuridica valida, per esempio senza il consenso quando la legge lo richiede;
- violare le regole di Meta, WhatsApp, Google o del tuo fornitore di posta;
- trattare dati di altre persone senza una base giuridica o senza averle informate;
- pubblicare o inviare contenuti illegali, offensivi, ingannevoli o che violano diritti di terzi (marchi, diritto d'autore, immagine, riservatezza);
- spacciarti per un'altra persona o impresa, o far firmare documenti a chi non ne ha il potere;
- preparare o far firmare contratti con scopi illeciti;
- aggirare le misure di sicurezza, copiare o decodificare il software, sovraccaricare il servizio.

5. Responsabilità del Cliente
Il Cliente è l'unico responsabile:
- dei contenuti che carica, scrive o fa generare all'AI;
- dei messaggi e delle risposte inviati dai suoi canali, anche quando l'invio è automatico;
- delle istruzioni date all'AI e delle impostazioni delle automazioni;
- delle campagne, delle email e dei messaggi inviati e dei potenziali clienti contattati con Trova clienti, compresa la verifica della base giuridica e del consenso;
- dei documenti e dei contratti creati, modificati, inviati o firmati tramite la piattaforma: scelta delle parti, contenuto, campi lasciati in bianco, PIN e modo di condividerli;
- del rispetto delle leggi che si applicano alla sua attività, tra cui il Regolamento UE 2016/679 (GDPR) e il Codice privacy (D.Lgs. 196/2003), le norme contro lo spam e sulle comunicazioni commerciali, il Codice del consumo (D.Lgs. 206/2005) nei rapporti con i suoi clienti, le regole delle piattaforme Meta e Google e i diritti dei terzi.
Facevoice AI non controlla in anticipo i contenuti del Cliente e non ha un obbligo generale di sorveglianza. Può però rimuovere contenuti o fermare invii quando riceve segnalazioni fondate o ordini delle autorità.

6. Intelligenza artificiale, documenti e contratti
Le risposte, i testi, i documenti e i contratti preparati dall'AI sono generati in automatico e possono contenere errori, omissioni o informazioni non aggiornate. Non sono consulenza legale, fiscale, contabile o professionale.
Documenti e contratti sono bozze: prima di usarli, inviarli o firmarli il Cliente deve leggerli, verificarli e adattarli al suo caso, se serve con un professionista. I campi lasciati in bianco vanno completati dalle parti.
Facevoice AI non è parte dei contratti tra il Cliente e i suoi clienti o fornitori e non garantisce che siano validi, efficaci, adatti allo scopo o che vengano rispettati.

7. Firma elettronica
La firma offerta dalla piattaforma è una firma elettronica semplice ai sensi del Regolamento UE 910/2014 (eIDAS) e del Codice dell'amministrazione digitale (D.Lgs. 82/2005). È formata da tre accettazioni esplicite del testo, dal segno tracciato sullo schermo quando previsto e dai dati registrati al momento della firma (data e ora, indirizzo IP, dispositivo). Non è una firma elettronica avanzata, qualificata o digitale: il suo valore come prova è valutato dal giudice caso per caso.
Non è adatta agli atti per cui la legge chiede la firma avanzata, qualificata o digitale, o l'atto pubblico (per esempio molti atti sugli immobili). Spetta al Cliente decidere se è adatta al documento che vuole far firmare.
Facevoice AI non verifica l'identità di chi firma. Il Cliente sceglie il PIN e lo comunica solo al destinatario. Dopo la firma di tutte le parti la piattaforma conserva la versione finale firmata e i dati della firma; il Cliente deve scaricarne una copia e conservarla.

8. Manleva
Il Cliente si impegna a tenere indenne e manlevare Facevoice AI, i suoi titolari, collaboratori e fornitori da ogni pretesa, richiesta, sanzione, danno e spesa, comprese le spese legali ragionevoli, avanzati da terzi (per esempio destinatari di messaggi, potenziali clienti contattati, controparti dei contratti, interessati al trattamento dei dati, autorità, Meta o Google) e derivanti da:
- l'uso della piattaforma da parte del Cliente e delle persone del suo spazio di lavoro;
- i contenuti, i messaggi, le automazioni, le campagne, i documenti e i contratti del Cliente;
- la violazione di questi termini o della legge da parte del Cliente.
La manleva non vale per le pretese che derivano da dolo o colpa grave di Facevoice AI o da un suo inadempimento.

9. Limitazione di responsabilità
Il servizio è fornito così com'è e come disponibile. Dipende anche da servizi di terzi (Meta, Google, fornitori di posta, di intelligenza artificiale e di hosting): facciamo il possibile per tenerlo attivo, ma non garantiamo che sia sempre disponibile o privo di errori.
Nei limiti dell'art. 1229 del Codice civile, e quindi salvo dolo o colpa grave, Facevoice AI non risponde di danni indiretti o consequenziali, mancato guadagno, perdita di dati, di clienti o di opportunità, messaggi non inviati, inviati in ritardo o sbagliati, conseguenze dei testi generati dall'AI, dei documenti, dei contratti e delle firme. Salvo dolo o colpa grave, per ogni altro danno la responsabilità complessiva di Facevoice AI non supera quanto pagato dal Cliente nei dodici mesi prima del fatto. Queste limitazioni non si applicano dove la legge non le consente.

10. Piani, prova e pagamenti
Piani, prezzi e limiti d'uso sono indicati sul sito e nell'area clienti; i prezzi sono IVA esclusa salvo diversa indicazione. Se è prevista una prova gratuita, alla fine della prova serve un piano a pagamento per continuare a usare le funzioni incluse.
I pagamenti avvengono con Stripe. L'abbonamento si rinnova in automatico a ogni periodo finché non lo chiudi; la chiusura vale dalla fine del periodo già pagato. Gli importi pagati non sono rimborsabili, salvo i casi previsti dalla legge o da questi termini.
Ogni piano ha un limite di uso dell'AI: raggiunto il limite, l'AI si ferma fino al periodo successivo o al passaggio a un piano superiore. Ti avvisiamo dei cambi di prezzo almeno 30 giorni prima: se non li accetti puoi recedere prima che si applichino.

11. Sospensione e chiusura
Possiamo sospendere o limitare l'account, anche senza preavviso nei casi urgenti, se: violi questi termini o la legge; non paghi quanto dovuto; c'è un rischio per la sicurezza, per la piattaforma o per terzi; lo chiedono le autorità, Meta o Google; riceviamo segnalazioni fondate di spam o di abusi. Quando possibile ti avvisiamo via email e ti diamo modo di rimediare. Nei casi gravi possiamo chiudere l'account.

12. Dati personali e ruoli privacy
Per i dati del tuo account (nome, email, dati di fatturazione, accessi) Facevoice AI è titolare del trattamento, come spiegato nell'Informativa privacy: https://www.facevoice.ai/privacy
Per i dati dei tuoi contatti trattati tramite la piattaforma (clienti, potenziali clienti, destinatari di messaggi, controparti dei contratti) il Cliente è titolare del trattamento e Facevoice AI è responsabile del trattamento ai sensi dell'art. 28 del GDPR, per tutta la durata del servizio.
Sono trattati dati di contatto (nome, email, telefono, profilo social), il contenuto di messaggi, documenti e contratti, i dati delle firme (nome, segno tracciato, data e ora, indirizzo IP, dispositivo) e i dati pubblici delle attività trovate con Trova clienti. Il trattamento consiste nella conservazione dei dati, nella loro elaborazione con l'intelligenza artificiale e nell'invio di messaggi ed email, solo per fornire il servizio.
In questo ruolo Facevoice AI:
- tratta i dati solo per fornire il servizio e secondo le istruzioni documentate del Cliente, che sono questi termini e le impostazioni scelte nella piattaforma, e avvisa il Cliente se ritiene che un'istruzione violi il GDPR;
- impegna alla riservatezza chi tratta i dati e adotta misure di sicurezza adeguate;
- si avvale di sub-responsabili (hosting e database, fornitori di intelligenza artificiale, invio email, Meta, Google, Stripe), che il Cliente autorizza in via generale, e impone loro gli stessi obblighi di protezione dei dati;
- informa il Cliente, via email o nell'area clienti, dei nuovi sub-responsabili prima di usarli, così che possa opporsi scrivendo a info@facevoice.ai;
- trasferisce dati fuori dallo Spazio economico europeo solo con garanzie adeguate, come decisioni di adeguatezza o clausole contrattuali standard;
- aiuta il Cliente a rispondere alle richieste degli interessati e a rispettare gli obblighi degli artt. 32-36 del GDPR (sicurezza, violazioni dei dati, valutazione d'impatto, consultazione preventiva), e lo avvisa senza ingiustificato ritardo in caso di violazione dei dati;
- alla fine del servizio cancella i dati entro 90 giorni, salvo obblighi di legge;
- mette a disposizione le informazioni utili a dimostrare il rispetto di questi obblighi e consente e contribuisce alle verifiche, comprese le ispezioni, del Cliente o di un suo incaricato.
Il Cliente garantisce di avere una base giuridica per i dati che tratta e di aver dato l'informativa agli interessati. Per cancellare i dati segui la pagina https://www.facevoice.ai/privacy/cancellazione-dati

13. Durata e recesso
Il contratto dura a tempo indeterminato dalla registrazione. Puoi recedere quando vuoi chiudendo l'abbonamento dalla pagina Piano e chiedendo la cancellazione dell'account a info@facevoice.ai; il recesso vale dalla fine del periodo già pagato.
Facevoice AI può recedere con almeno 30 giorni di preavviso via email, restituendo la parte già pagata e non goduta; resta salva la chiusura per i motivi dell'articolo 11. Prima della chiusura scarica i documenti e i contratti che vuoi conservare: dopo la chiusura i dati vengono cancellati entro 90 giorni, salvo obblighi di legge.

14. Modifiche ai termini
Possiamo modificare questi termini per motivi legali, tecnici o legati al servizio. Ogni versione ha una data e resta pubblicata, senza modifiche, alla pagina /termini/ seguita dalla data della versione. Quando cambiano i termini te lo diciamo nell'area clienti: per continuare a usare la piattaforma devi accettare la nuova versione. Se non la accetti puoi recedere come indicato all'articolo 13.

15. Disposizioni varie
Se una clausola è nulla o inefficace, le altre restano valide. Il mancato esercizio di un diritto non è una rinuncia. Il Cliente non può cedere il contratto senza il nostro consenso. Le comunicazioni avvengono per email all'indirizzo dell'account o nell'area clienti. Fa fede il testo in italiano.

16. Legge applicabile e foro competente
Questi termini sono regolati dalla legge italiana. Per ogni controversia sulla loro interpretazione, esecuzione o risoluzione è competente in via esclusiva il Foro di Palermo.

17. Approvazione specifica delle clausole
Ai sensi degli artt. 1341 e 1342 del Codice civile il Cliente dichiara di aver letto e di approvare specificamente le seguenti clausole: 2 (modifica e rimozione di funzioni), 3 (account e uso delle credenziali), 5 (responsabilità esclusiva del Cliente), 6 (intelligenza artificiale, documenti e contratti: nessuna consulenza e nessuna garanzia), 7 (firma elettronica semplice: limiti e scelta del Cliente), 8 (manleva), 9 (limitazione di responsabilità), 10 (rinnovo automatico, nessun rimborso e limiti d'uso), 11 (sospensione e chiusura), 13 (recesso di Facevoice AI), 14 (modifiche ai termini), 16 (legge italiana e foro esclusivo di Palermo).`

const TERMS_2026_11_07: PublishedTerms = Object.freeze({
  version: '2026-11-07',
  title: TERMS_TITLE,
  text: TEXT_2026_11_07,
  items: Object.freeze({
    a: "Accetto i Termini e condizioni e ho letto l'Informativa privacy",
    b: "Dichiaro di essere l'unico responsabile dei contenuti, dei messaggi, delle automazioni, dei documenti e dei contratti creati, inviati o firmati tramite la piattaforma, e manlevo Facevoice AI da ogni pretesa di terzi, nei limiti dell'articolo 8 dei Termini",
    c: "Approvo specificamente, ai sensi degli artt. 1341 e 1342 c.c., le clausole: 2 (modifica e rimozione di funzioni), 3 (account e uso delle credenziali), 5 (responsabilità esclusiva del Cliente), 6 (intelligenza artificiale, documenti e contratti), 7 (firma elettronica semplice), 8 (manleva), 9 (limitazione di responsabilità), 10 (rinnovo automatico, rimborsi e limiti d'uso), 11 (sospensione e chiusura), 13 (recesso di Facevoice AI), 14 (modifiche ai termini), 16 (legge italiana e foro esclusivo di Palermo)",
  }),
  hash: 'ffb2d4e83a72b6e435f8fa00cef41421a54197fb2b3d90477e8d21c337db567f',
})

// ---------------------------------------------------------------------------
// Archivio: TUTTE le versioni pubblicate, la piu' recente in fondo.
// ---------------------------------------------------------------------------

const ARCHIVE: readonly PublishedTerms[] = Object.freeze([TERMS_2026_11_07])

/** Versione in vigore: chi non l'ha accettata vede il blocco all'ingresso nell'area clienti. */
export const TERMS_VERSION = '2026-11-07'

/** Tutte le versioni pubblicate, dalla piu' vecchia. */
export const termsVersions = (): string[] => ARCHIVE.map((t) => t.version)

/** Una versione pubblicata (testo esatto), oppure null. */
export function termsFor(version: string): PublishedTerms | null {
  return ARCHIVE.find((t) => t.version === version) ?? null
}

export const CURRENT_TERMS: PublishedTerms = termsFor(TERMS_VERSION) as PublishedTerms

/** Le tre caselle nell'ordine (a, b, c). */
export const termsItemList = (terms: PublishedTerms = CURRENT_TERMS): string[] => [terms.items.a, terms.items.b, terms.items.c]

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/** "2026-11-07" -> "7 novembre 2026" (il nome resta com'e' se non e' una data). */
export function versionDateLabel(version: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(version)
  if (!m) return version
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : version
}

export type TermsBlock =
  | { kind: 'title'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

/**
 * Il testo diviso in blocchi per mostrarlo: prima riga titolo, righe subito sotto
 * "meta", righe "N. Titolo" intestazioni, righe "- " elenchi, il resto paragrafi.
 * Solo presentazione: il testo accettato resta quello intero.
 */
export function termsBlocks(text: string): TermsBlock[] {
  const lines = text.split('\n')
  const blocks: TermsBlock[] = []
  let i = 0
  if (lines[0]?.trim()) blocks.push({ kind: 'title', text: lines[i++].trim() })
  while (i < lines.length && lines[i].trim()) blocks.push({ kind: 'meta', text: lines[i++].trim() })
  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^\d{1,2}\.\s/.test(line)) blocks.push({ kind: 'heading', text: line })
    else if (line.startsWith('- ')) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'list') last.items.push(line.slice(2))
      else blocks.push({ kind: 'list', items: [line.slice(2)] })
    } else blocks.push({ kind: 'paragraph', text: line })
  }
  return blocks
}

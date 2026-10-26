import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callAI, hasAIProvider } from '@/lib/ai'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'
import {
  replyToComment,
  sendMessengerText,
  sendPrivateReply,
  sendWhatsAppText,
  type SendResult,
} from '@/lib/meta/graph'
import { notifyNewMessage } from '@/lib/meta/notify'
import { conversationKeyFor, linkConversations, linkedMembers } from '@/lib/meta/identities'
import { sendThreadReply } from '@/lib/gmail'
import { WHATSAPP_DISPLAY } from '@/lib/leads'
import { replyLanguage } from '@/lib/reply-language'
import { autoReplyAllowed, loadOutreachReplySettings, scheduleAutoSend } from '@/lib/outreach-reply'
import { defineSection, sectionText } from '@/lib/ai-context'
import { bookedSlotsText, cancelAppointmentsFor, createAppointment, parseAppointmentMarkers } from '@/lib/appointments'

const HISTORY_LIMIT = 12

export type SocialPlatform = 'whatsapp' | 'facebook' | 'instagram' | 'email' | 'web'
export type MessageKind = 'message' | 'comment'

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  email: 'Email',
  web: 'Chat sito',
}

const NON_TEXT_REPLY =
  'Grazie per il messaggio! Al momento posso leggere solo messaggi di testo: scrivimi pure qui cosa ti serve e ti rispondo subito.'

// Stile di Luca: prima capire, poi proporre. Niente "si', costa X" alla prima
// risposta: frase empatica breve + domande mirate, e un contatto diretto.
const SALES_APPROACH = defineSection({
  id: 'sales_approach',
  title: 'Metodo di vendita nei messaggi',
  usedFor: 'Messaggi privati (Instagram, Messenger, WhatsApp) ed email ricevute',
  group: 'social',
  defaultText: `## Come gestisci una richiesta (approccio consulenziale)
Prima di tutto capisci CHI scrive e PERCHÉ, e rispondi di conseguenza:
- **Potenziale cliente** (chiede un servizio, un'informazione, un preventivo): è la priorità. Segui il metodo qui sotto.
- **Cliente già attivo** (fa riferimento a un lavoro in corso): rispondi nel merito se hai le informazioni, altrimenti conferma che il team lo ricontatta a breve.
- **Fornitore, agenzia o freelance che PROPONE i suoi servizi a noi** (contenuti, SEO, lead generation, sviluppo in outsourcing, ecc.): non trattarlo come un cliente e non dire che "inoltri al team". Se è un messaggio generico o di massa rispondi solo con: NESSUNA_RISPOSTA. Se è una proposta specifica e pertinente, ringrazia in una frase e chiedi un esempio concreto o un portfolio, senza impegni.
- **Candidatura di lavoro, spam, messaggi automatici**: NESSUNA_RISPOSTA.
Deduci il settore e l'azienda da firma, dominio email, nome del profilo e contenuto, e adatta le domande a quel settore.

### Metodo con un potenziale cliente
1. Apri con UNA frase breve e naturale che mostra che hai capito la richiesta (es. "Ok, chiaro", "Sì, è una cosa fattibile", "Interessante, ne facciamo spesso di simili"). Niente entusiasmo finto, niente "Grazie per averci contattato" di circostanza.
2. NON dare subito prezzi, tempi o un "sì, si fa così": prima serve capire. Anche se nelle informazioni ufficiali c'è un prezzo, dallo solo quando la richiesta è già chiara.
3. Fai 1-3 domande mirate e funzionali, scelte tra: come gestiscono la cosa oggi, qual è l'obiettivo concreto (più clienti, risparmiare tempo, vendere online...), cosa hanno già (sito, social, gestionale), tempi o urgenza, dimensione dell'attività. Non fare l'interrogatorio: poche domande, scritte come le farebbe una persona.
4. {{PASSO_CONTATTO}}
5. Quando hai capito l'esigenza, proponi il passo successivo concreto: una breve chiamata o un incontro.

### Tono
- Scrivi come una persona vera del team, linguaggio naturale e diretto, frasi brevi. Mai frasi da intelligenza artificiale ("Sono qui per aiutarti", "Certamente!", "Ottima domanda"). Nelle chat niente elenchi; nelle email solo le domande numerate come negli esempi.
- Rispondi SEMPRE nella stessa lingua in cui ti hanno scritto (inglese se scrivono in inglese, e così via).
- Dai del tu se l'altra persona dà del tu o scrive in modo informale; altrimenti del lei.`,
})

/** Passo 4 del metodo: su WhatsApp il numero c'e' gia'. */
const contactStep = (platform: SocialPlatform) =>
  platform === 'whatsapp'
    ? 'Su WhatsApp hai già il numero: se utile, proponi una breve chiamata.'
    : 'Chiedi, in modo naturale e una sola volta nella conversazione, un numero di telefono (meglio WhatsApp) per sentirsi più velocemente, e se ha senso il profilo social dell’attività. Se nello storico l’ha già dato, non chiederlo di nuovo.'

/**
 * Immagine aziendale: mai far sembrare Facevoice AI una ditta di una persona sola
 * con il fondatore che fa tutto (dava un'idea di azienda piccola e poco autorevole).
 */
const IMAGE_RULES = defineSection({
  id: 'image_rules',
  title: 'Immagine aziendale',
  usedFor: 'Tutte le risposte: messaggi, commenti ed email',
  group: 'social',
  defaultText: `- Parla sempre come azienda strutturata: "noi", "il nostro team", "un nostro consulente", "il referente del progetto". {{REGOLA_CANALE}}
- Per il passo successivo: "un nostro consulente ti chiama", "ti scrive il nostro team su WhatsApp", mai "Luca ti chiama/ti scrive".
- Se chiedono chi è Luca o chi c'è dietro l'azienda: rispondi in breve e con autorevolezza (es. "Luca Corrao è il fondatore e CEO di Facevoice AI"), senza dire che segue lui ogni cliente o ogni progetto, e riporta subito la conversazione sulla loro esigenza.
- Mai frasi che fanno sembrare l'azienda piccola o improvvisata (es. "siamo in pochi", "faccio tutto io", "ti rispondo appena posso").`,
})

const channelImageRule = (platform: SocialPlatform) =>
  platform === 'email'
    ? 'Firmi come Luca, ma non scrivere mai che segui tutto tu personalmente o che fai tutto da solo.'
    : 'NON nominare Luca né il fondatore come la persona che chiama, risponde, gestisce i progetti o parla "personalmente" con tutti i clienti.'

const CHAT_STYLE = defineSection({
  id: 'chat_style',
  title: 'Stile dei messaggi in chat',
  usedFor: 'Messaggi privati e commenti (Instagram, Messenger, WhatsApp)',
  group: 'social',
  defaultText: `- Messaggi brevi da chat: 1-4 frasi. Niente titoli, niente elenchi, niente markdown.`,
})

/**
 * Risposte approvate, corrette o scritte a mano da Luca: l'AI le usa come
 * riferimento di stile. Prima quelle corrette o scritte a mano, poi le approvate
 * cosi' com'erano. Email e chat restano separate (registro diverso).
 */
export async function loadStyleExamples(platform: SocialPlatform): Promise<string> {
  let query = supabaseAdmin
    .from('social_messages')
    .select('platform, contact_id, body, origin, created_at')
    .eq('direction', 'out')
    .eq('status', 'sent')
    .eq('kind', 'message')
    .in('origin', ['ai_edited', 'manual', 'ai_approved'])
  query = platform === 'email' ? query.eq('platform', 'email') : query.neq('platform', 'email')
  // Senza la colonna origin (migrazione non ancora eseguita) la query fallisce: nessun esempio.
  const { data, error } = await query.order('created_at', { ascending: false }).limit(12)
  if (error || !data?.length) return ''

  const rank: Record<string, number> = { ai_edited: 0, manual: 0, ai_approved: 1 }
  const picked = data.sort((a, b) => rank[a.origin] - rank[b.origin]).slice(0, 5)

  const examples = await Promise.all(
    picked.map(async (reply) => {
      const { data: incoming } = await supabaseAdmin
        .from('social_messages')
        .select('body')
        .eq('platform', reply.platform)
        .eq('contact_id', reply.contact_id)
        .eq('direction', 'in')
        .lt('created_at', reply.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!incoming?.body) return null
      return `Messaggio ricevuto:\n${String(incoming.body).slice(0, 700)}\n\nRisposta inviata da Luca:\n${String(reply.body).slice(0, 1500)}`
    })
  )

  const valid = examples.filter(Boolean)
  if (!valid.length) return ''
  return `\n\n## Risposte reali approvate da Luca (riferimento per stile, tono e domande; non copiarle)\n${valid
    .map((example, i) => `### Esempio ${i + 1}\n${example}`)
    .join('\n\n')}`
}

/** Da dove viene una risposta inviata: serve a scegliere gli esempi di stile. Mai bloccante. */
export async function setOrigin(id: string, origin: 'ai_approved' | 'ai_edited' | 'manual' | 'ai_auto') {
  const { error } = await supabaseAdmin.from('social_messages').update({ origin }).eq('id', id)
  if (error && error.code !== '42703') console.error('origin update:', error.message)
}

const EMAIL_STYLE = defineSection({
  id: 'email_style',
  title: 'Stile delle email (con esempi di Luca)',
  usedFor: 'Risposte alle email ricevute su luca@facevoice.ai',
  group: 'email',
  defaultText: `- Stai rispondendo a un'EMAIL ricevuta su luca@facevoice.ai, come Luca. Segui lo stile degli esempi qui sotto:
  - saluto adatto all'ora ("Buongiorno Nome," / "Buon pomeriggio Nome,");
  - una frase breve che riconosce la richiesta (es. "grazie mille per le informazioni, la tua lista di priorità è chiarissima");
  - le domande come elenco numerato breve, ognuna con un'etichetta di una o due parole seguita da due punti (es. "1. Software attuali: ...");
  - proposta del passo successivo senza pressione (es. "Una volta lette le risposte, se ti va possiamo fare una brevissima call di 10 minuti...");
  - chiusura breve ("Buon lavoro e a presto," / "Fammi sapere e buon proseguimento di giornata!") e firma solo "Luca".
- Testo semplice: niente markdown (niente asterischi o grassetti), niente oggetto (lo aggiunge il sistema).
- Se l'email non richiede una risposta (ricevute, conferme automatiche, pubblicità, newsletter, semplici ringraziamenti finali) rispondi solo con: NESSUNA_RISPOSTA

## Esempi di email scritte da Luca (stile da imitare, non contenuto da copiare)
Esempio 1, a un'azienda che chiede un incontro per automatizzare i processi con l'AI:
"Buongiorno [Nome],

in vista del nostro incontro, vorrei portarmi avanti con il lavoro per arrivare all'appuntamento con delle idee già concrete.

Se riesci a darmi qualche indicazione via email su due aspetti, ci aiuta molto:

1. Software attuali: quali gestionali utilizzate oggi per prenotazioni, clienti e fatturazione?

2. Priorità: qual è tra le varie mansioni quella che oggi vi porta via più tempo o vi crea più colli di bottiglia?

Una volta lette le informazioni, se vi va possiamo anche fare una brevissima call di 10 minuti per definire gli ultimi dettagli prima di vederci di persona.

Fammi sapere e buon proseguimento di giornata!

Luca"

Esempio 2, dopo che il cliente ha risposto con le sue priorità:
"Buon pomeriggio [Nome],

grazie mille per le informazioni, la tua lista di priorità è chiarissima. Ti confermo che l'integrazione è assolutamente fattibile.

Per definire gli ultimi dettagli tecnici, avrei solo due brevi chiarimenti:

1. Pagamenti: per i pagamenti dal vostro sito e per le caparre vi appoggiate a Stripe o a un altro sistema collegato al gestionale?

2. Fatturazione: per fatture e ricevute usate il modulo interno del gestionale o un software esterno?

Una volta lette le risposte, se ti va possiamo fare una brevissima call per allinearci prima di vederci in sede.

Buon lavoro e a presto,

Luca"`,
})

const AGENT_BASE = defineSection({
  id: 'agent_base',
  title: 'Chi scrive e regole di base',
  usedFor: 'Tutte le risposte: messaggi, commenti ed email',
  group: 'social',
  defaultText: `Scrivi le risposte che {{CHI}} invia {{DOVE}}. Facevoice AI è un'azienda siciliana di sviluppo software su misura, integrazione AI, digitalizzazione e social media management per imprese, che lavora in tutta la Sicilia e in Italia.

## Regole
- Usa SOLO le informazioni ufficiali qui sotto per servizi, prezzi, tempi e dettagli. Se un'informazione non c'è, non inventarla.
- Non chiedere mai password, dati di pagamento o documenti.
- Se ti chiedono esplicitamente se stanno parlando con un'intelligenza artificiale, non negarlo: di' che le risposte sono preparate con l'aiuto di un assistente e che il nostro team segue la conversazione.`,
})

/** Istruzioni di base per canale, dai blocchi modificabili dalla pagina Memoria. */
async function agentPrompt(platform: SocialPlatform, publicComment: boolean) {
  const [base, style, image, sales] = await Promise.all([
    sectionText(AGENT_BASE, {
      CHI: platform === 'email' ? 'Luca Corrao, fondatore di Facevoice AI,' : 'il team di Facevoice AI',
      DOVE: platform === 'email' ? 'via email' : `su ${PLATFORM_LABEL[platform]}`,
    }),
    sectionText(platform === 'email' ? EMAIL_STYLE : CHAT_STYLE),
    sectionText(IMAGE_RULES, { REGOLA_CANALE: channelImageRule(platform) }),
    publicComment ? Promise.resolve('') : sectionText(SALES_APPROACH, { PASSO_CONTATTO: contactStep(platform) }),
  ])
  return [
    base,
    style ? `\n\n## Stile\n${style}` : '',
    image ? `\n\n## Immagine aziendale (vale più delle informazioni qui sotto)\n${image}` : '',
    sales ? `\n\n${sales}` : '',
  ].join('')
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET?.trim()
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const received = signatureHeader.slice('sha256='.length)

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(received, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function getChannelSettings(platform: SocialPlatform) {
  const { data } = await supabaseAdmin
    .from('social_channels')
    .select('status, reply_mode')
    .eq('platform', platform)
    .maybeSingle()
  return {
    enabled: data?.status === 'connected',
    // Nel dubbio si chiede approvazione: e' il comportamento piu' prudente.
    autoSend: data?.reply_mode === 'auto',
  }
}

export async function loadKnowledge(): Promise<string> {
  const { data } = await supabaseAdmin
    .from('ai_knowledge')
    .select('title, content, category')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(50)

  return (data || [])
    .map((item) => `- ${item.category ? `[${item.category}] ` : ''}${item.title}: ${item.content}`)
    .join('\n')
}

/**
 * Messaggi privati gia' scambiati con questa persona, anche sugli altri canali
 * a cui e' stata collegata (es. Instagram + Messenger). Esclude bozze non inviate.
 */
async function loadHistory(platform: SocialPlatform, contactId: string) {
  const members = await linkedMembers(platform, contactId)
  const filter = members
    .map((m) => `and(platform.eq.${m.platform},contact_id.eq.${m.contactId})`)
    .join(',')

  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('platform, direction, body, status')
    .or(filter)
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  return (data || [])
    .reverse()
    .filter((m) => m.body && (m.direction === 'in' || m.status === 'sent'))
    .map((m) => ({
      role: m.direction === 'in' ? 'user' : 'assistant',
      // Se la persona ha scritto da un altro canale, l'AI lo sa.
      content:
        m.platform !== platform
          ? `[su ${PLATFORM_LABEL[m.platform as SocialPlatform] ?? m.platform}] ${m.body}`
          : (m.body as string),
    }))
}

type ReplyOptions = {
  // Testo di un commento pubblico: la risposta va sotto il commento.
  publicComment?: string
  // Didascalia del post/reel commentato.
  postCaption?: string | null
  // Primo messaggio privato a chi ha commentato (Private Replies).
  privateFollowUp?: boolean
  // Risposta di un contatto della Ricerca clienti: abbiamo scritto noi per primi.
  outreach?: OutreachContext | null
}

/** Scheda della Ricerca clienti di chi sta rispondendo alla nostra email di primo contatto. */
export type OutreachContext = {
  leadId: string
  name: string
  analysis: string | null
  notes: string | null
  firstEmail: string | null
}

const OUTREACH_REPLY_RULES = defineSection({
  id: 'outreach_reply',
  title: 'Controrisposte a chi abbiamo contattato noi',
  usedFor: 'Email di risposta alle nostre prime email (Motore clienti)',
  group: 'contatti',
  defaultText: `## Questa persona sta RISPONDENDO a una nostra email di primo contatto
Siamo stati noi a scrivere per primi: Luca le ha presentato Facevoice AI. Scrivi la controrisposta come Luca, con strategia: l'obiettivo è una chiamata o un messaggio WhatsApp, non vendere per email.
Metodo:
- Prima rispondi davvero a quello che ha scritto, nel merito e in breve: chi si sente ascoltato continua a parlare. Rispecchia il suo tono e la lunghezza del suo messaggio (se scrive due righe, rispondi con poche righe).
- Un passo alla volta: in ogni email UNA sola idea e UNA sola richiesta finale, facile da accettare (es. "ti va se ti chiamo domani dieci minuti?", "a che numero ti trovo?").
- Fai lavorare la curiosità invece di spiegare tutto: un dettaglio concreto sulla sua attività preso dall'analisi (cosa manca, cosa sta perdendo, cosa fanno i concorrenti) vale più di un elenco di servizi.
- Fai domande che lo fanno parlare dei suoi problemi (prenotazioni, clienti che non trovano il menù, tempo perso coi messaggi): sono le sue risposte a vendere.
- Interesse: conferma in una frase che è proprio il vostro lavoro e porta subito alla chiamata (chiedi numero e orario, oppure WhatsApp ${WHATSAPP_DISPLAY}).
- Obiezioni ("costa", "non ho tempo", "ho già qualcuno", "non mi serve"): dagli ragione su quello che è vero, poi sposta il punto con UN fatto concreto dall'analisi (senza ripetere la prima email) e proponi dieci minuti senza impegno.
- Domande su prezzi: niente cifre, spiega che dipende da cosa serve davvero e che in dieci minuti di chiamata gli dai un'idea precisa.
- Mai bugie: niente clienti, risultati, numeri o promesse inventati; cita lavori o clienti solo se sono nelle Informazioni ufficiali. Scrivi sempre come Luca di Facevoice AI, mai a nome di altri.
- Dai del TU, frasi brevi, niente elenchi puntati, niente P.S.
- Firma: "A presto,\nLuca Corrao\nFacevoice AI · www.facevoice.ai\nWhatsApp ${WHATSAPP_DISPLAY}"
Etichette (sulla PRIMA riga, solo se serve, poi la risposta):
- [NON_CONTATTARE] se chiede di non essere più contattato o dice un no netto: la risposta è un saluto gentile di 1-2 frasi, senza insistere.
- [DA_CONTROLLARE] se serve una decisione di Luca: prezzi o preventivi precisi, reclami o toni ostili, questioni legali o privacy, domande su cui le informazioni non bastano.`,
})

/**
 * Metodo di riferimento, ricavato da una conversazione vera di Luca (resa anonima):
 * cosa ha fatto a ogni passo e perche'. Vale sempre, insieme agli esempi che Luca aggiunge.
 */
const REFERENCE_METHOD = defineSection({
  id: 'reference_method',
  title: 'Il metodo di Luca (conversazione con Dario, anonima)',
  usedFor: 'Controrisposte a chi abbiamo contattato noi',
  group: 'contatti',
  defaultText: `## Il metodo di Luca (da una sua conversazione vera, resa anonima)
Situazione: un'azienda (prodotti alimentari, vende sia alle aziende sia ai privati) aveva mandato a Luca una newsletter scritta con l'AI, rimasta con un pezzo del prompt in cima.
1. Luca apre con qualcosa di UTILE e vero, non con una vendita: "Ciao! Hai lasciato parte del prompt nell'e-mail! 🙃" Una riga, tono leggero.
2. L'altro ringrazia, un po' imbarazzato. Luca rispecchia il tono e lo mette a suo agio ("Tranquillo ahahah 😅"), poi fa UNA domanda curiosa sul suo modo di lavorare: "Mi sto chiedendo cosa usi per inviare email per essere successo? 🤔" Così è l'altro a raccontare il problema.
3. L'altro spiega: usa l'AI per le newsletter, non ha ricontrollato ed è uscito l'errore. Solo ORA Luca parla di sé: prima gli dà ragione senza giudicarlo ("capita, questi strumenti non sono ancora affidabili"), poi aggancia la soluzione esattamente al problema appena raccontato (un sistema che trova i potenziali clienti e scrive ogni email personalizzata, e sbaglia raramente) e lascia il link al sito.
4. L'altro fa una domanda sulla sua situazione. Luca risponde nel merito e onestamente (cosa si fa con i social e cosa via email), aggiunge un'altra cosa che si può fare, la collega al tipo di clienti dell'altro ("nel vostro caso potete contattare anche i clienti finali, non solo le aziende") e propone il contatto diretto su WhatsApp con il numero.
5. L'altro ringrazia e saluta: la conversazione si chiude in positivo, con il numero in mano.
Cosa prendere: aprire con valore, rispecchiare tono ed emoji, una domanda alla volta che fa parlare l'altro del suo problema, la soluzione solo dopo e cucita su quel problema, risposte brevi, chiusura su WhatsApp. Cosa NON prendere: in quella conversazione Luca scriveva a nome di un suo cliente e parlava di Facevoice AI come di "loro"; qui scrivi sempre in prima persona come Luca di Facevoice AI ("noi"), senza fingere di essere qualcun altro.`,
})

/**
 * Percorso verso la chiamata: ogni risposta in una conversazione fa fare un passo
 * avanti, fino a un appuntamento con giorno e ora precisi.
 */
const FUNNEL_RULES = defineSection({
  id: 'funnel',
  title: 'Percorso verso la chiamata (funnel)',
  usedFor: 'Messaggi privati, email ricevute e controrisposte ai contatti',
  group: 'contatti',
  defaultText: `## Percorso verso la chiamata
Ogni risposta deve far fare UN passo avanti verso una chiamata conoscitiva con un nostro consulente, senza saltare passi e senza fermarsi:
1. Aggancio: rispondi a quello che ha scritto e mostra che hai capito.
2. Esigenza: con 1-2 domande capisci attività, problema e obiettivo.
3. Valore: collega UN beneficio concreto al suo problema (senza inventare risultati o clienti).
4. Proposta: proponi una chiamata di 15 minuti offrendo DUE orari precisi tra quelli disponibili (es. "domani alle 11:00 o giovedì alle 16:30?").
5. Contatto: chiedi il numero, meglio WhatsApp, se non l'hai già.
6. Conferma: quando accetta un orario preciso, riepiloga giorno, ora e numero in una frase e ringrazia; da lì non vendere più.
Capisci da che punto riparte la conversazione leggendo lo storico. Se si raffredda o rimanda, non insistere: lascia la porta aperta con una domanda leggera.`,
})

/** Istruzioni tecniche (non modificabili): orari possibili e riga che segna l'appuntamento. */
function appointmentRules(booked: string) {
  return `\n\n## Appuntamenti (istruzioni tecniche, obbligatorie)
Orari in cui il team fa le chiamate: dal lunedì al venerdì, 9:30-13:00 e 15:00-18:30 (ora italiana), da almeno 3 ore da adesso fino ai prossimi 10 giorni. Proponi SOLO orari dentro queste fasce e non già occupati. Già occupati: ${booked || 'nessuno'}.
Quando la persona CONFERMA un giorno E un'ora precisi (non "magari", non "la prossima settimana"), aggiungi in fondo alla risposta, su una riga a parte:
[[APPUNTAMENTO: AAAA-MM-GG HH:MM | chiamata o incontro | telefono se l'ha dato, altrimenti - | una riga su cosa le serve]]
Data vera calcolata da "Data e ora" qui sotto, ora italiana. Scrivila una volta sola, nel messaggio in cui l'appuntamento viene confermato. Se sposta o annulla un appuntamento già fissato, aggiungi [[APPUNTAMENTO_ANNULLATO]] (e la nuova riga se ne fissa un altro). Queste righe non vengono mostrate alla persona.`
}

/** Esempi di conversazione scelti da Luca: se ne prende il metodo, non le parole. */
async function strategyExamples(strategy: string) {
  const method = await sectionText(REFERENCE_METHOD)
  const base = method ? `\n\n${method}` : ''
  if (!strategy.trim()) return base
  return `${base}\n\n## Altri esempi di strategia scelti da Luca
Conversazioni vere in cui Luca ha portato la discussione dove voleva. Prendine il METODO (come risponde, come sposta il discorso, come fa domande, come porta alla chiamata), non le frasi né le persone: in quegli esempi poteva parlare per conto di qualcun altro, qui scrivi sempre come Luca di Facevoice AI.
${strategy.slice(0, 12000)}`
}

/** Etichette della controrisposta: da rivedere a mano, o persona da non ricontattare. */
export function parseOutreachReply(text: string): { text: string; review: boolean; stop: boolean } {
  const review = /\[DA_CONTROLLARE\]/.test(text)
  const stop = /\[NON_CONTATTARE\]/.test(text)
  return { text: text.replace(/\[(DA_CONTROLLARE|NON_CONTATTARE)\]\s*/g, '').trim(), review, stop }
}

function outreachFacts(outreach: OutreachContext): string {
  return [
    `\n\n## Scheda dell'attività (Ricerca clienti)\nNome: ${outreach.name}`,
    outreach.analysis ? `Analisi (punti deboli da usare come leva):\n${outreach.analysis}` : '',
    outreach.notes ? `Note di Luca: ${outreach.notes}` : '',
    outreach.firstEmail ? `Prima email che Luca ha inviato:\n${outreach.firstEmail}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const PUBLIC_COMMENT_RULES = defineSection({
  id: 'public_comment',
  title: 'Risposte pubbliche ai commenti',
  usedFor: 'Commenti sotto post e reel di Instagram e Facebook',
  group: 'social',
  defaultText: `## Stai rispondendo a un COMMENTO PUBBLICO sotto un tuo post o reel
- Massimo 1-2 frasi, tono cordiale e umano, un'emoji va bene se il commento ne ha.
- Se il commento è un complimento o una reazione positiva, ringrazia in modo caloroso e breve.
- Se fa una domanda, rispondi in breve usando il contenuto del post; per prezzi, preventivi o dettagli personali di' che gli scrivi in privato.
- Non chiedere né citare dati personali o dettagli riservati in pubblico.
- Se il commento è offensivo, spam o un semplice tag di amici, rispondi solo con: NESSUNA_RISPOSTA`,
})

const PRIVATE_FOLLOW_UP_RULES = defineSection({
  id: 'private_followup',
  title: 'Primo messaggio privato dopo un commento',
  usedFor: 'Messaggio privato a chi commenta mostrando interesse',
  group: 'social',
  defaultText: `## Stai scrivendo il PRIMO MESSAGGIO PRIVATO a chi ha commentato un tuo post o reel
- Scrivilo SOLO se il commento mostra un interesse concreto verso i servizi (chiede info, prezzi, come funziona, se lo fate anche per la sua attività, scrive "info", ecc.).
- Per complimenti, emoji, tag di amici, battute o commenti negativi rispondi solo con: NESSUNA_RISPOSTA
- Apri facendo riferimento al suo commento e al post (es. "Ciao! Ho visto il tuo commento sul reel del sito per il ristorante…").
- Poi segui il metodo consulenziale: 1-2 domande mirate e la richiesta naturale di un numero WhatsApp.
- 2-4 frasi, tono da chat, niente elenchi.`,
})

/**
 * Lingua della risposta, in fondo alle istruzioni (dove pesa di piu'): le regole e gli
 * esempi sono in italiano e senza questa riga l'AI tendeva a rispondere in italiano
 * anche a chi scrive in russo o in inglese.
 */
function languageRule(lastText: string | undefined) {
  const detected = replyLanguage(lastText)
  return `\n\n## LINGUA DELLA RISPOSTA (regola più importante)
${detected ? `Il messaggio a cui rispondi è in ${detected}: scrivi TUTTA la risposta ${detected.includes('(') ? 'in quella stessa lingua' : `in ${detected}`}.` : 'Scrivi TUTTA la risposta nella stessa lingua del messaggio a cui rispondi (commento in russo → risposta in russo, in inglese → in inglese, e così via). Se il messaggio è troppo corto per capirlo (emoji, una parola), usa la lingua dei messaggi precedenti o, in mancanza, l’italiano.'}
Vale anche per il primo messaggio privato dopo un commento. Le istruzioni e gli esempi qui sopra sono in italiano solo per comodità: traducine il senso, non copiarli. Nomi, numeri di telefono, link e firma restano uguali.`
}

async function generateReply(
  platform: SocialPlatform,
  contactId: string,
  contactName: string | null,
  options: ReplyOptions = {}
): Promise<string> {
  if (!hasAIProvider()) {
    console.error(`${platform} agent: nessuna chiave AI (Gemini o Claude), nessuna risposta generata`)
    return ''
  }
  const { publicComment, postCaption, privateFollowUp, outreach } = options
  const fromComment = Boolean(publicComment)

  // Dai commenti si parte solo dal testo del commento: lo storico privato non va mai citato in pubblico.
  const [knowledge, history, styleExamples, outreachSettings, base, commentRules, outreachRules, funnel, booked] = await Promise.all([
    loadKnowledge(),
    fromComment ? Promise.resolve([{ role: 'user', content: publicComment! }]) : loadHistory(platform, contactId),
    fromComment && !privateFollowUp ? Promise.resolve('') : loadStyleExamples(platform),
    outreach ? loadOutreachReplySettings().catch(() => null) : Promise.resolve(null),
    agentPrompt(platform, fromComment && !privateFollowUp),
    fromComment ? sectionText(privateFollowUp ? PRIVATE_FOLLOW_UP_RULES : PUBLIC_COMMENT_RULES) : Promise.resolve(''),
    outreach ? sectionText(OUTREACH_REPLY_RULES) : Promise.resolve(''),
    // Il percorso verso la chiamata vale nelle conversazioni, non nei commenti pubblici.
    fromComment ? Promise.resolve('') : sectionText(FUNNEL_RULES),
    fromComment ? Promise.resolve('') : bookedSlotsText().catch(() => ''),
  ])
  const strategy = outreach ? await strategyExamples(outreachSettings?.strategy || '') : ''

  const system = [
    base,
    commentRules ? `\n\n${commentRules}` : '',
    postCaption ? `\n\n## Post commentato\n${postCaption}` : '',
    outreach ? (outreachRules ? `\n\n${outreachRules}` : '') + outreachFacts(outreach) + strategy : '',
    funnel ? `\n\n${funnel}` : '',
    fromComment ? '' : appointmentRules(booked),
    knowledge ? `\n\n## Informazioni ufficiali\n${knowledge}` : '',
    styleExamples,
    contactName ? `\n\n## Cliente\nNome sul profilo: ${contactName}` : '',
    `\n\n## Data e ora\n${buildRealtimeDateTimeInstructionsItalian()}`,
    languageRule(fromComment ? publicComment! : [...history].reverse().find((m) => m.role === 'user')?.content),
  ].join('')

  try {
    const result = await callAI(history, system, {
      feature: outreach ? 'controrisposte_clienti' : platform === 'email' ? 'risposte_email' : 'risposte_social',
      temperature: 0.5,
      maxOutputTokens: platform === 'email' ? 2048 : 1024,
    })
    const reply = (result.message || '').trim()
    if (reply.includes('NESSUNA_RISPOSTA')) return ''
    return reply.slice(0, platform === 'email' ? 6000 : 1900)
  } catch (error) {
    console.error(`${platform} agent: generazione risposta fallita`, error)
    return ''
  }
}

export type OutgoingTarget = {
  platform: SocialPlatform
  kind: MessageKind
  contact_id: string
  channel_account_id: string | null
  reply_to: string | null
}

/** Invia davvero una risposta al canale giusto. Usato sia in automatico sia all'approvazione. */
export async function deliver(target: OutgoingTarget, text: string): Promise<SendResult> {
  if (target.kind === 'comment') {
    if (target.platform === 'whatsapp' || target.platform === 'email' || target.platform === 'web' || !target.reply_to) {
      return { error: 'Commento di origine mancante' }
    }
    return replyToComment(target.platform, target.reply_to, text)
  }
  if (target.platform === 'web') {
    // Chat del sito: il messaggio salvato lo legge il widget del visitatore.
    // Chi risponde a mano prende in carico la conversazione: l'AI si ferma.
    await supabaseAdmin.from('app_settings').upsert({
      key: `web_handoff:${target.contact_id}`,
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return { id: `web:${randomUUID()}` }
  }
  if (target.platform === 'email') {
    if (!target.channel_account_id) return { error: 'Conversazione email di origine mancante' }
    return sendThreadReply(target.channel_account_id, target.contact_id, text)
  }
  if (target.platform === 'whatsapp') {
    if (!target.channel_account_id) return { error: 'Numero WhatsApp di origine mancante' }
    return sendWhatsAppText(target.channel_account_id, target.contact_id, text)
  }
  if (target.reply_to) {
    // Messaggio privato nato da un commento: si invia tramite l'id del commento.
    const sent = await sendPrivateReply(target.reply_to, text)
    if (sent.recipientId && sent.recipientId !== target.contact_id) {
      // Chi commenta e chi riceve il Direct hanno id diversi: sono la stessa persona.
      const [a, b] = await Promise.all([
        conversationKeyFor(target.platform, target.contact_id),
        conversationKeyFor(target.platform, sent.recipientId),
      ])
      if (a !== b) await linkConversations(a, b)
    }
    return sent
  }
  return sendMessengerText(target.contact_id, text)
}

/** Invia subito (modalita' automatica) o salva come bozza da approvare. Restituisce l'id della bozza creata, o false. */
async function queueReply(
  target: OutgoingTarget,
  contactName: string | null,
  text: string,
  autoSend: boolean
): Promise<string | false> {
  if (autoSend) {
    const sent = await deliver(target, text)
    const { data: row } = await supabaseAdmin
      .from('social_messages')
      .insert({
        ...target,
        contact_name: contactName,
        direction: 'out',
        external_id: sent.id ?? null,
        body: text,
        status: sent.error ? 'failed' : 'sent',
        error_message: sent.error ?? null,
      })
      .select('id')
      .single()
    if (row) await setOrigin(row.id, 'ai_auto')
    // Esito nei log Vercel (senza contenuti): serve a capire se le risposte partono davvero.
    if (sent.error) console.error(`${target.platform} ${target.kind}: invio fallito:`, sent.error)
    else console.log(`${target.platform} ${target.kind}${target.reply_to && target.kind === 'message' ? ' (privato dal commento)' : ''}: risposta inviata`)
    return false
  }
  const { data: draft } = await supabaseAdmin
    .from('social_messages')
    .insert({
      ...target,
      contact_name: contactName,
      direction: 'out',
      body: text,
      status: 'pending',
    })
    .select('id')
    .single()
  return draft?.id ?? false
}

/**
 * Controrisposta a richiesta (assistente della Ricerca clienti): la prepara come
 * bozza nella casella Messaggi, al posto di eventuali bozze vecchie dello stesso contatto.
 */
export async function prepareOutreachReply(
  contactEmail: string,
  outreach: OutreachContext
): Promise<{ ok: boolean; reason?: string; text?: string }> {
  const { data: last } = await supabaseAdmin
    .from('social_messages')
    .select('channel_account_id, contact_name')
    .eq('platform', 'email')
    .eq('contact_id', contactEmail)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last) return { ok: false, reason: 'nessuna risposta ricevuta da questo indirizzo' }

  const text = parseOutreachReply(await generateReply('email', contactEmail, last.contact_name, { outreach })).text
  if (!text) return { ok: false, reason: 'generazione non riuscita, riprova' }

  await supabaseAdmin
    .from('social_messages')
    .delete()
    .eq('platform', 'email')
    .eq('contact_id', contactEmail)
    .eq('direction', 'out')
    .eq('status', 'pending')
  const target: OutgoingTarget = {
    platform: 'email',
    kind: 'message',
    contact_id: contactEmail,
    channel_account_id: last.channel_account_id,
    reply_to: null,
  }
  await queueReply(target, last.contact_name, text, false)
  return { ok: true, text }
}

/**
 * Punto d'ingresso per ogni messaggio o commento in arrivo: lo salva, avvisa
 * gli admin e, se il canale e' connesso, prepara la risposta AI (bozza da
 * approvare o invio diretto a seconda della modalita' del canale).
 */
export async function handleIncoming(input: {
  platform: SocialPlatform
  kind: MessageKind
  contactId: string
  contactName: string | null
  externalId: string
  channelAccountId: string | null
  text: string | null
  fallbackLabel: string
  postCaption?: string | null
  /** Risponde a una nostra email della Ricerca clienti: controrisposta con il suo interruttore (vedi lib/outreach-reply). */
  outreach?: OutreachContext | null
}) {
  const body = input.text ? input.text.slice(0, input.platform === 'email' ? 12000 : 4000) : input.fallbackLabel

  // Meta ritenta i webhook: il vincolo UNIQUE su external_id evita doppie risposte.
  const { data: inserted, error } = await supabaseAdmin
    .from('social_messages')
    .insert({
      platform: input.platform,
      kind: input.kind,
      contact_id: input.contactId,
      contact_name: input.contactName,
      direction: 'in',
      external_id: input.externalId,
      channel_account_id: input.channelAccountId,
      body,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    if (error?.code !== '23505') console.error(`${input.platform} insert error:`, error)
    else console.log(`${input.platform} ${input.kind}: già ricevuto (doppione di Meta), ignorato`)
    return
  }

  const settings = await getChannelSettings(input.platform)
  const outreach = input.kind === 'message' ? input.outreach ?? null : null

  let reply = ''
  // Controrisposta ai contatti cercati da noi: si prepara sempre; parte da sola (dopo qualche
  // minuto) solo con l'interruttore "risposte automatiche ai contatti" acceso.
  let outreachAuto = false
  let outreachStop = false
  if (outreach) {
    const raw = input.text ? await generateReply(input.platform, input.contactId, input.contactName, { outreach }) : ''
    const parsed = parseOutreachReply(raw)
    reply = parsed.text
    outreachStop = parsed.stop
    if (reply && !parsed.review && !parsed.stop) {
      const outreachSettings = await loadOutreachReplySettings().catch(() => null)
      outreachAuto = Boolean(outreachSettings?.auto) && (await autoReplyAllowed(input.platform, input.contactId))
    }
    if (outreachStop) {
      // Ha chiesto di non essere ricontattato: la scheda esce da ogni invio futuro.
      await supabaseAdmin.from('leads').update({ status: 'do_not_contact' }).eq('id', outreach.leadId)
    }
  } else if (settings.enabled) {
    if (input.kind === 'comment') {
      reply = input.text
        ? await generateReply(input.platform, input.contactId, input.contactName, {
            publicComment: input.text,
            postCaption: input.postCaption,
          })
        : ''
    } else {
      reply = input.text ? await generateReply(input.platform, input.contactId, input.contactName) : NON_TEXT_REPLY
    }
  }

  // Appuntamento confermato nella conversazione: in calendario e notifica subito.
  if (reply && input.kind === 'message') {
    const parsed = parseAppointmentMarkers(reply)
    reply = parsed.text
    try {
      if (parsed.cancel) await cancelAppointmentsFor(input.platform, input.contactId)
      for (const a of parsed.appointments) {
        await createAppointment({
          when: a.when.toISOString(),
          kind: a.kind,
          phone: a.phone,
          note: a.note,
          contactName: outreach?.name || input.contactName,
          platform: input.platform,
          contactId: input.contactId,
          leadId: outreach?.leadId ?? null,
        })
        console.log(`${input.platform} message: appuntamento fissato`)
      }
    } catch (error) {
      console.error('appuntamento non salvato:', error)
    }
  }

  const target: OutgoingTarget = {
    platform: input.platform,
    kind: input.kind,
    contact_id: input.contactId,
    channel_account_id: input.channelAccountId,
    reply_to: input.kind === 'comment' ? input.externalId : null,
  }

  let pendingDraft = false
  let scheduledAt: string | null = null
  if (reply && outreach) {
    // Ha scritto di nuovo: la controrisposta ancora in attesa e' superata da quella nuova.
    await supabaseAdmin
      .from('social_messages')
      .delete()
      .eq('platform', input.platform)
      .eq('contact_id', input.contactId)
      .eq('direction', 'out')
      .eq('status', 'pending')
  }
  if (reply && outreach) {
    const draftId = await queueReply(target, input.contactName, reply, false)
    pendingDraft = Boolean(draftId)
    if (draftId && outreachAuto) scheduledAt = await scheduleAutoSend(draftId)
  } else if (reply) pendingDraft = Boolean(await queueReply(target, input.contactName, reply, settings.autoSend))

  if (!reply) {
    const why = outreach ? 'testo mancante o generazione non riuscita' : !settings.enabled ? 'canale non collegato in Canali e AI' : "l'AI ha deciso che non serve (NESSUNA_RISPOSTA) o la generazione non è riuscita"
    console.log(`${input.platform} ${input.kind}: nessuna risposta (${why})`)
  } else if (pendingDraft) {
    console.log(`${input.platform} ${input.kind}: ${scheduledAt ? 'controrisposta programmata' : 'risposta in bozza da approvare in Messaggi'}`)
  }

  // Commento con un interesse concreto: oltre alla risposta pubblica, un messaggio privato.
  if (settings.enabled && input.kind === 'comment' && input.text && input.platform !== 'whatsapp') {
    const privateText = await generateReply(input.platform, input.contactId, input.contactName, {
      publicComment: input.text,
      postCaption: input.postCaption,
      privateFollowUp: true,
    })
    if (privateText) {
      const privateTarget: OutgoingTarget = { ...target, kind: 'message', reply_to: input.externalId }
      pendingDraft = Boolean(await queueReply(privateTarget, input.contactName, privateText, settings.autoSend)) || pendingDraft
    }
  }

  await notifyNewMessage({
    platform: input.platform,
    kind: input.kind,
    contactId: input.contactId,
    contactName: input.contactName,
    body,
    messageId: inserted.id,
    hasPendingDraft: pendingDraft,
    outreachName: outreach?.name ?? null,
    scheduledAt,
  })
}

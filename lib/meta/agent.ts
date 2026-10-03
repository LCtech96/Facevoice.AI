import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'
import { replyToComment, sendMessengerText, sendWhatsAppText, type SendResult } from '@/lib/meta/graph'
import { notifyNewMessage } from '@/lib/meta/notify'
import { linkedMembers } from '@/lib/meta/identities'
import { sendThreadReply } from '@/lib/gmail'

const HISTORY_LIMIT = 12

export type SocialPlatform = 'whatsapp' | 'facebook' | 'instagram' | 'email'
export type MessageKind = 'message' | 'comment'

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  email: 'Email',
}

const NON_TEXT_REPLY =
  'Grazie per il messaggio! Al momento posso leggere solo messaggi di testo: scrivimi pure qui cosa ti serve e ti rispondo subito.'

// Stile di Luca: prima capire, poi proporre. Niente "si', costa X" alla prima
// risposta: frase empatica breve + domande mirate, e un contatto diretto.
const SALES_APPROACH = (platform: SocialPlatform) => `## Come gestisci una richiesta (approccio consulenziale)
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
4. ${platform === 'whatsapp'
  ? 'Su WhatsApp hai già il numero: se utile, proponi una breve chiamata.'
  : 'Chiedi, in modo naturale e una sola volta nella conversazione, un numero di telefono (meglio WhatsApp) per sentirsi più velocemente, e se ha senso il profilo social dell’attività. Se nello storico l’ha già dato, non chiederlo di nuovo.'}
5. Quando hai capito l'esigenza, proponi il passo successivo concreto: una breve chiamata o un incontro.

### Tono
- Scrivi come una persona vera del team, linguaggio naturale e diretto, frasi brevi. Mai frasi da intelligenza artificiale ("Sono qui per aiutarti", "Certamente!", "Ottima domanda", elenchi puntati).
- Rispondi SEMPRE nella stessa lingua in cui ti hanno scritto (inglese se scrivono in inglese, e così via).
- Dai del tu se l'altra persona dà del tu o scrive in modo informale; altrimenti del lei.`

const CHAT_STYLE = `- Messaggi brevi da chat: 1-4 frasi. Niente titoli, niente elenchi, niente markdown.`

const EMAIL_STYLE = `- Stai rispondendo a un'EMAIL ricevuta su luca@facevoice.ai. Email breve e personale: saluto con il nome se lo conosci, 2-6 frasi, chiusura con firma "Luca Corrao\nFacevoice AI" (preceduta da un saluto adatto alla lingua, es. "Un saluto," o "Best regards,").
- Testo semplice: niente markdown, niente oggetto (lo aggiunge il sistema).
- Se l'email non richiede una risposta (ricevute, conferme automatiche, pubblicità, newsletter, semplici ringraziamenti finali) rispondi solo con: NESSUNA_RISPOSTA`

function agentPrompt(platform: SocialPlatform, publicComment: boolean) {
  const where = platform === 'email' ? 'via email' : `su ${PLATFORM_LABEL[platform]}`
  const who = platform === 'email' ? 'Luca Corrao, fondatore di Facevoice AI,' : 'il team di Facevoice AI'
  return `Scrivi le risposte che ${who} invia ${where}. Facevoice AI è un'azienda siciliana di sviluppo software su misura, integrazione AI, digitalizzazione e social media management per imprese, che lavora in tutta la Sicilia e in Italia.

## Regole
${platform === 'email' ? EMAIL_STYLE : CHAT_STYLE}
- Usa SOLO le informazioni ufficiali qui sotto per servizi, prezzi, tempi e dettagli. Se un'informazione non c'è, non inventarla.
- Non chiedere mai password, dati di pagamento o documenti.
- Se ti chiedono esplicitamente se stanno parlando con un'intelligenza artificiale, non negarlo: di' che le risposte sono preparate con l'aiuto di un assistente e che Luca segue personalmente la conversazione.

${publicComment ? '' : SALES_APPROACH(platform)}`
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

async function loadKnowledge(): Promise<string> {
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

async function generateReply(
  platform: SocialPlatform,
  contactId: string,
  contactName: string | null,
  publicComment?: string
): Promise<string> {
  if (!getGeminiApiKey()) {
    console.error(`${platform} agent: GEMINI_API_KEY mancante, nessuna risposta generata`)
    return ''
  }

  // Un commento pubblico si risponde da solo: lo storico privato non va mai citato in pubblico.
  const [knowledge, history] = await Promise.all([
    loadKnowledge(),
    publicComment
      ? Promise.resolve([{ role: 'user', content: publicComment }])
      : loadHistory(platform, contactId),
  ])

  const system = [
    agentPrompt(platform, Boolean(publicComment)),
    publicComment
      ? `\n\n## Stai rispondendo a un COMMENTO PUBBLICO sotto un post\n- Massimo 1-2 frasi, tono cordiale.\n- Non chiedere né citare dati personali, prezzi o dettagli riservati: per quelli invita a scrivere in privato (messaggio diretto).\n- Se il commento è offensivo, spam o non richiede risposta, rispondi solo con: NESSUNA_RISPOSTA`
      : '',
    knowledge ? `\n\n## Informazioni ufficiali\n${knowledge}` : '',
    contactName ? `\n\n## Cliente\nNome sul profilo: ${contactName}` : '',
    `\n\n## Data e ora\n${buildRealtimeDateTimeInstructionsItalian()}`,
  ].join('')

  try {
    const result = await callGeminiWithFallback(history, GEMINI_DEFAULT_MODEL, system, {
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
    if (target.platform === 'whatsapp' || target.platform === 'email' || !target.reply_to) {
      return { error: 'Commento di origine mancante' }
    }
    return replyToComment(target.platform, target.reply_to, text)
  }
  if (target.platform === 'email') {
    if (!target.channel_account_id) return { error: 'Conversazione email di origine mancante' }
    return sendThreadReply(target.channel_account_id, target.contact_id, text)
  }
  if (target.platform === 'whatsapp') {
    if (!target.channel_account_id) return { error: 'Numero WhatsApp di origine mancante' }
    return sendWhatsAppText(target.channel_account_id, target.contact_id, text)
  }
  return sendMessengerText(target.contact_id, text)
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
    return
  }

  const settings = await getChannelSettings(input.platform)

  let reply = ''
  if (settings.enabled) {
    if (input.kind === 'comment') {
      reply = input.text ? await generateReply(input.platform, input.contactId, input.contactName, input.text) : ''
    } else {
      reply = input.text ? await generateReply(input.platform, input.contactId, input.contactName) : NON_TEXT_REPLY
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
  if (reply) {
    if (settings.autoSend) {
      const sent = await deliver(target, reply)
      await supabaseAdmin.from('social_messages').insert({
        ...target,
        contact_name: input.contactName,
        direction: 'out',
        external_id: sent.id ?? null,
        body: reply,
        status: sent.error ? 'failed' : 'sent',
        error_message: sent.error ?? null,
      })
      if (sent.error) console.error(`${input.platform} send error:`, sent.error)
    } else {
      await supabaseAdmin.from('social_messages').insert({
        ...target,
        contact_name: input.contactName,
        direction: 'out',
        body: reply,
        status: 'pending',
      })
      pendingDraft = true
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
  })
}

import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'
import { replyToComment, sendMessengerText, sendWhatsAppText, type SendResult } from '@/lib/meta/graph'
import { notifyNewMessage } from '@/lib/meta/notify'

const HISTORY_LIMIT = 12

export type SocialPlatform = 'whatsapp' | 'facebook' | 'instagram'
export type MessageKind = 'message' | 'comment'

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
}

const NON_TEXT_REPLY =
  'Grazie per il messaggio! Al momento posso leggere solo messaggi di testo: scrivimi pure qui cosa ti serve e ti rispondo subito.'

function agentPrompt(platform: SocialPlatform) {
  return `Sei l'assistente di Facevoice AI su ${PLATFORM_LABEL[platform]}. Facevoice AI è un'azienda siciliana di sviluppo software su misura, integrazione AI, digitalizzazione e social media management per imprese, che lavora in tutta la Sicilia e in Italia.

## Come rispondi
- Scrivi in italiano (o nella lingua del cliente), tono cordiale e professionale, come una persona del team.
- Messaggi brevi da chat: 1-4 frasi. Niente titoli, niente elenchi lunghi, niente markdown.
- Usa SOLO le informazioni ufficiali qui sotto per servizi, prezzi, tempi e dettagli. Se un'informazione non c'è, non inventarla: di' che un collega del team ricontatterà il cliente.
- Se il cliente chiede un preventivo, un appuntamento o di parlare con una persona, raccogli in breve cosa gli serve e conferma che il team lo ricontatterà a breve.
- Non chiedere mai password, dati di pagamento o documenti.`
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

/** Solo messaggi privati gia' scambiati (non bozze scartate o in attesa). */
async function loadHistory(platform: SocialPlatform, contactId: string) {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('direction, body, status')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  return (data || [])
    .reverse()
    .filter((m) => m.body && (m.direction === 'in' || m.status === 'sent'))
    .map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body as string }))
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
    agentPrompt(platform),
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
      maxOutputTokens: 1024,
    })
    const reply = (result.message || '').trim()
    if (reply.includes('NESSUNA_RISPOSTA')) return ''
    return reply.slice(0, 1900)
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
    if (target.platform === 'whatsapp' || !target.reply_to) return { error: 'Commento di origine mancante' }
    return replyToComment(target.platform, target.reply_to, text)
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
  const body = input.text ? input.text.slice(0, 4000) : input.fallbackLabel

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

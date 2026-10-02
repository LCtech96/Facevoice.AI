import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'

const GRAPH_VERSION = 'v25.0'
const HISTORY_LIMIT = 12

const AGENT_PROMPT = `Sei l'assistente di Facevoice AI su WhatsApp. Facevoice AI è un'azienda siciliana di sviluppo software su misura, integrazione AI e digitalizzazione per imprese, che lavora in tutta la Sicilia e in Italia.

## Come rispondi
- Scrivi in italiano (o nella lingua del cliente), tono cordiale e professionale, come una persona del team.
- Messaggi brevi da chat: 1-4 frasi. Niente titoli, niente elenchi lunghi, niente markdown.
- Usa SOLO le informazioni ufficiali qui sotto per servizi, prezzi, tempi e dettagli. Se un'informazione non c'è, non inventarla: di' che un collega del team ricontatterà il cliente.
- Se il cliente chiede un preventivo, un appuntamento o di parlare con una persona, raccogli in breve cosa gli serve e conferma che il team lo ricontatterà a breve.
- Non chiedere mai password, dati di pagamento o documenti.`

const NON_TEXT_REPLY =
  'Grazie per il messaggio! Al momento posso leggere solo messaggi di testo: scrivimi pure qui cosa ti serve e ti rispondo subito.'

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET?.trim()
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const received = signatureHeader.slice('sha256='.length)

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(received, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

type WhatsAppMessage = {
  from: string
  id: string
  type: string
  text?: { body?: string }
}

type WhatsAppChangeValue = {
  metadata?: { phone_number_id?: string }
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
  messages?: WhatsAppMessage[]
}

type WebhookPayload = {
  object?: string
  entry?: Array<{ changes?: Array<{ field?: string; value?: WhatsAppChangeValue }> }>
}

async function isAutoReplyEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('social_channels')
    .select('status')
    .eq('platform', 'whatsapp')
    .maybeSingle()
  return data?.status === 'connected'
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

async function loadHistory(contactId: string) {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('direction, body')
    .eq('platform', 'whatsapp')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  return (data || [])
    .reverse()
    .filter((m) => m.body)
    .map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body as string }))
}

async function generateReply(contactId: string, contactName: string | null): Promise<string> {
  const knowledge = await loadKnowledge()
  const history = await loadHistory(contactId)

  const system = [
    AGENT_PROMPT,
    knowledge ? `\n\n## Informazioni ufficiali\n${knowledge}` : '',
    contactName ? `\n\n## Cliente\nNome sul profilo WhatsApp: ${contactName}` : '',
    `\n\n## Data e ora\n${buildRealtimeDateTimeInstructionsItalian()}`,
  ].join('')

  const result = await callGeminiWithFallback(history, GEMINI_DEFAULT_MODEL, system, {
    temperature: 0.5,
    maxOutputTokens: 1024,
  })

  return (result.message || '').trim().slice(0, 4000)
}

async function sendText(phoneNumberId: string, to: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) return { error: 'WHATSAPP_ACCESS_TOKEN non configurato' }

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    return { error: data?.error?.message || `HTTP ${response.status}` }
  }
  return { id: data?.messages?.[0]?.id as string | undefined }
}

async function handleMessage(value: WhatsAppChangeValue, message: WhatsAppMessage) {
  const phoneNumberId = value.metadata?.phone_number_id
  const contactName =
    value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null
  const isText = message.type === 'text' && !!message.text?.body
  const body = isText ? message.text!.body!.slice(0, 4000) : `[${message.type}]`

  // L'insert fallisce sul vincolo UNIQUE se Meta ci rimanda lo stesso messaggio:
  // in quel caso abbiamo gia' risposto e ci fermiamo.
  const { error: insertError } = await supabaseAdmin.from('social_messages').insert({
    platform: 'whatsapp',
    contact_id: message.from,
    contact_name: contactName,
    direction: 'in',
    external_id: message.id,
    body,
  })
  if (insertError) {
    if (insertError.code !== '23505') console.error('WhatsApp insert error:', insertError)
    return
  }

  if (!phoneNumberId || !(await isAutoReplyEnabled())) return

  let reply = NON_TEXT_REPLY
  if (isText) {
    if (!getGeminiApiKey()) {
      console.error('WhatsApp agent: GEMINI_API_KEY mancante, nessuna risposta inviata')
      return
    }
    try {
      reply = await generateReply(message.from, contactName)
    } catch (error) {
      console.error('WhatsApp agent: generazione risposta fallita', error)
      return
    }
    if (!reply) return
  }

  const sent = await sendText(phoneNumberId, message.from, reply)
  await supabaseAdmin.from('social_messages').insert({
    platform: 'whatsapp',
    contact_id: message.from,
    contact_name: contactName,
    direction: 'out',
    external_id: sent.id ?? null,
    body: reply,
    status: sent.error ? 'failed' : 'sent',
    error_message: sent.error ?? null,
  })
  if (sent.error) console.error('WhatsApp send error:', sent.error)
}

export async function handleWhatsAppWebhook(payload: WebhookPayload) {
  if (payload.object !== 'whatsapp_business_account') return

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages' || !change.value?.messages) continue
      for (const message of change.value.messages) {
        try {
          await handleMessage(change.value, message)
        } catch (error) {
          console.error('WhatsApp webhook: errore sul messaggio', message.id, error)
        }
      }
    }
  }
}

import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'

export const GRAPH_VERSION = 'v25.0'
const HISTORY_LIMIT = 12

export type SocialPlatform = 'whatsapp' | 'facebook' | 'instagram'

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
}

export const NON_TEXT_REPLY =
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

/** Un solo token di sistema per tutti i canali Meta (nome storico: WHATSAPP_ACCESS_TOKEN). */
export function getSystemToken(): string | undefined {
  return (process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN)?.trim() || undefined
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

export async function isAutoReplyEnabled(platform: SocialPlatform): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('social_channels')
    .select('status')
    .eq('platform', platform)
    .maybeSingle()
  return data?.status === 'connected'
}

/**
 * Salva il messaggio in arrivo. Ritorna false se era gia' stato registrato:
 * Meta ritenta i webhook e il vincolo UNIQUE su external_id evita doppie risposte.
 */
export async function recordIncoming(input: {
  platform: SocialPlatform
  contactId: string
  contactName: string | null
  externalId: string
  body: string
}): Promise<boolean> {
  const { error } = await supabaseAdmin.from('social_messages').insert({
    platform: input.platform,
    contact_id: input.contactId,
    contact_name: input.contactName,
    direction: 'in',
    external_id: input.externalId,
    body: input.body,
  })
  if (error) {
    if (error.code !== '23505') console.error(`${input.platform} insert error:`, error)
    return false
  }
  return true
}

export async function recordOutgoing(input: {
  platform: SocialPlatform
  contactId: string
  contactName: string | null
  body: string
  externalId?: string
  error?: string
}) {
  await supabaseAdmin.from('social_messages').insert({
    platform: input.platform,
    contact_id: input.contactId,
    contact_name: input.contactName,
    direction: 'out',
    external_id: input.externalId ?? null,
    body: input.body,
    status: input.error ? 'failed' : 'sent',
    error_message: input.error ?? null,
  })
  if (input.error) console.error(`${input.platform} send error:`, input.error)
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

async function loadHistory(platform: SocialPlatform, contactId: string) {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('direction, body')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  return (data || [])
    .reverse()
    .filter((m) => m.body)
    .map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body as string }))
}

/** Risposta dell'agente per l'ultimo messaggio del contatto; stringa vuota se non si deve rispondere. */
export async function generateReply(
  platform: SocialPlatform,
  contactId: string,
  contactName: string | null
): Promise<string> {
  if (!getGeminiApiKey()) {
    console.error(`${platform} agent: GEMINI_API_KEY mancante, nessuna risposta inviata`)
    return ''
  }

  const [knowledge, history] = await Promise.all([loadKnowledge(), loadHistory(platform, contactId)])

  const system = [
    agentPrompt(platform),
    knowledge ? `\n\n## Informazioni ufficiali\n${knowledge}` : '',
    contactName ? `\n\n## Cliente\nNome sul profilo: ${contactName}` : '',
    `\n\n## Data e ora\n${buildRealtimeDateTimeInstructionsItalian()}`,
  ].join('')

  try {
    const result = await callGeminiWithFallback(history, GEMINI_DEFAULT_MODEL, system, {
      temperature: 0.5,
      maxOutputTokens: 1024,
    })
    return (result.message || '').trim().slice(0, 1900)
  } catch (error) {
    console.error(`${platform} agent: generazione risposta fallita`, error)
    return ''
  }
}

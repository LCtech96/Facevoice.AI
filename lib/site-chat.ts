import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callAI, hasAIProvider } from '@/lib/ai'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'
import { loadKnowledge } from '@/lib/meta/agent'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'

// Chat del sito pubblico come canale della casella Messaggi (platform 'web').
// L'AI raccoglie a piccoli passi esigenza e contatto, poi passa la
// conversazione a un operatore umano: da quel momento risponde solo Luca
// dalla casella, e il widget mostra le sue risposte in tempo (quasi) reale.

export const WEB_PLATFORM = 'web'
const HANDOFF_TAG = '[[HANDOFF]]'
const NAME_TAG = /\[\[NOME:\s*([^\]]{1,60})\]\]/i
const HISTORY_LIMIT = 30

export type SiteMessage = { id: string; direction: 'in' | 'out'; body: string; created_at: string }

const handoffKey = (sessionId: string) => `web_handoff:${sessionId}`

export function isValidSession(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(id)
}

export async function isHandedOff(sessionId: string) {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', handoffKey(sessionId)).maybeSingle()
  return Boolean(data?.value)
}

export async function markHandedOff(sessionId: string) {
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: handoffKey(sessionId), value: new Date().toISOString(), updated_at: new Date().toISOString() })
}

export async function loadSession(sessionId: string, after?: string): Promise<SiteMessage[]> {
  // Messaggi del visitatore e risposte gia' inviate (mai bozze o invii falliti).
  let query = supabaseAdmin
    .from('social_messages')
    .select('id, direction, body, created_at')
    .eq('platform', WEB_PLATFORM)
    .eq('contact_id', sessionId)
    .or('direction.eq.in,status.eq.sent')
  if (after) query = query.gt('created_at', after)
  const { data } = await query.order('created_at', { ascending: true }).limit(300)
  return (data || []) as SiteMessage[]
}

const SITE_PROMPT = `Sei l'assistente della chat sul sito di Facevoice AI, una software house siciliana (Palermo) che si prende cura di tutto il lato digitale delle aziende: contenuti e gestione social, siti web, e-commerce, software e gestionali su misura, integrazione dell'intelligenza artificiale.

## Il tuo obiettivo
Capire con calma cosa serve al visitatore e raccogliere un suo contatto, poi passarlo a un operatore umano del team.

## Come scrivi
- Messaggi BREVI da chat: 1-3 frasi al massimo. Mai muri di testo.
- Procedi A FASI: una cosa per volta, UNA sola domanda per messaggio.
- Testo semplice: MAI asterischi, grassetti, elenchi puntati, titoli o markdown. Niente link.
- Tono amichevole e umano, dai del tu se l'utente è informale, altrimenti del lei. Rispondi nella lingua dell'utente.
- NON dare mai numeri di telefono, WhatsApp, email o indirizzi di Facevoice AI, e non invitare a contattarci altrove: la conversazione continua qui e sarà un operatore a ricontattare.
- Non dare prezzi o tempi precisi: se li chiedono, di' che li valuterà il team in base alle esigenze.
- Usa SOLO le informazioni ufficiali qui sotto; non inventare.

## Le fasi
1. Capisci di cosa ha bisogno (che tipo di attività ha, cosa vorrebbe fare, qual è l'obiettivo). Fai domande brevi e mirate, una alla volta, mostrando che hai capito con una mini frase empatica.
2. Quando l'esigenza è abbastanza chiara (di solito dopo 2-4 scambi), chiedi come si chiama.
3. Poi chiedi un contatto: un'email oppure un numero di telefono, a sua scelta.
4. Appena hai sia l'esigenza sia un contatto valido, chiudi con un messaggio tipo: "Perfetto, grazie! Ti metto subito in contatto con un operatore del team: attendi qualche istante e non chiudere la chat." e aggiungi in fondo, su una riga a parte, esattamente: ${HANDOFF_TAG}
5. Quando l'utente ti dice il suo nome, aggiungi in fondo al messaggio, su una riga a parte: [[NOME: nome dell'utente]]

I marcatori tra doppie parentesi quadre non vengono mostrati all'utente.`

function cleanReply(text: string) {
  return text
    .replace(NAME_TAG, '')
    .replace(HANDOFF_TAG, '')
    .replace(/\*\*?|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/
const PHONE_RE = /(?:\+?\d[\s.-]?){8,14}\d/

type HandleResult = { reply?: SiteMessage; handoff: boolean; stored: boolean }

/** Nuovo messaggio dal widget: lo salva e, se non e' gia' con un operatore, risponde con l'AI. */
export async function handleSiteMessage(
  sessionId: string,
  text: string,
  clientHistory: { role: string; content: string }[]
): Promise<HandleResult> {
  const { data: last } = await supabaseAdmin
    .from('social_messages')
    .select('contact_name')
    .eq('platform', WEB_PLATFORM)
    .eq('contact_id', sessionId)
    .not('contact_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let contactName: string | null = last?.contact_name ?? null

  const { error: insertError } = await supabaseAdmin.from('social_messages').insert({
    platform: WEB_PLATFORM,
    kind: 'message',
    contact_id: sessionId,
    contact_name: contactName,
    direction: 'in',
    external_id: `web:${randomUUID()}`,
    body: text,
  })
  const stored = !insertError
  if (insertError) console.error('site chat insert:', insertError.message)

  // Gia' passato a un operatore: l'AI tace, avvisiamo Luca del nuovo messaggio.
  if (stored && (await isHandedOff(sessionId))) {
    await sendPushToAdmins({
      title: `${contactName || 'Visitatore'} · Chat sito`,
      body: text.slice(0, 140),
      url: `/admin/inbox?c=${encodeURIComponent(`${WEB_PLATFORM}:${sessionId}`)}`,
      tag: `web:${sessionId}`,
    }).catch(() => null)
    return { handoff: true, stored }
  }

  // Appena il visitatore lascia email o cellulare: passaggio all'operatore
  // garantito (non dipende dall'AI) e avviso immediato a Luca, email + push.
  if (EMAIL_RE.test(text) || PHONE_RE.test(text)) {
    const body = `Perfetto${contactName ? `, ${contactName}` : ''}, grazie! Ti metto subito in contatto con un operatore del team: attendi qualche istante e non chiudere la chat.`
    const { data: row } = stored
      ? await supabaseAdmin
          .from('social_messages')
          .insert({
            platform: WEB_PLATFORM,
            kind: 'message',
            contact_id: sessionId,
            contact_name: contactName,
            direction: 'out',
            external_id: `web:${randomUUID()}`,
            body,
            status: 'sent',
          })
          .select('id, direction, body, created_at')
          .single()
      : { data: null }
    if (stored) await markHandedOff(sessionId)
    const transcript: SiteMessage[] = stored
      ? await loadSession(sessionId)
      : [
          ...clientHistory.map((m, i) => ({
            id: `c${i}`,
            direction: (m.role === 'user' ? 'in' : 'out') as 'in' | 'out',
            body: m.content,
            created_at: '',
          })),
          { id: 'last', direction: 'in', body: text, created_at: '' },
        ]
    await notifyHandoff(sessionId, contactName, transcript)
    return {
      reply: (row as SiteMessage | null) ?? { id: `local-${Date.now()}`, direction: 'out', body, created_at: new Date().toISOString() },
      handoff: true,
      stored,
    }
  }

  if (!hasAIProvider()) return { handoff: false, stored }

  const history = stored
    ? (await loadSession(sessionId)).slice(-HISTORY_LIMIT).map((m) => ({
        role: m.direction === 'in' ? 'user' : 'assistant',
        content: m.body,
      }))
    : [...clientHistory.slice(-HISTORY_LIMIT), { role: 'user', content: text }]

  const knowledge = await loadKnowledge().catch(() => '')
  const system = [
    SITE_PROMPT,
    knowledge ? `\n\n## Informazioni ufficiali\n${knowledge}` : '',
    contactName ? `\n\n## Utente\nSi chiama ${contactName}.` : '',
    `\n\n## Data e ora\n${buildRealtimeDateTimeInstructionsItalian()}`,
  ].join('')

  let raw = ''
  try {
    const result = await callAI(history, system, {
      feature: 'chat_sito',
      temperature: 0.5,
      maxOutputTokens: 512,
    })
    raw = (result.message || '').trim()
  } catch (error) {
    console.error('site chat AI:', error)
    raw = 'Scusami, ho avuto un piccolo problema tecnico. Puoi ripetere?'
  }

  const nameMatch = raw.match(NAME_TAG)
  if (nameMatch) contactName = nameMatch[1].trim()
  const wantsHandoff = raw.includes(HANDOFF_TAG)
  const body = cleanReply(raw).slice(0, 1200) || 'Dimmi pure, ti ascolto.'

  const { data: row } = stored
    ? await supabaseAdmin
        .from('social_messages')
        .insert({
          platform: WEB_PLATFORM,
          kind: 'message',
          contact_id: sessionId,
          contact_name: contactName,
          direction: 'out',
          external_id: `web:${randomUUID()}`,
          body,
          status: 'sent',
        })
        .select('id, direction, body, created_at')
        .single()
    : { data: null }

  if (stored && contactName && nameMatch) {
    // Il nome compare anche sui messaggi gia' salvati, cosi' la casella lo mostra.
    await supabaseAdmin
      .from('social_messages')
      .update({ contact_name: contactName })
      .eq('platform', WEB_PLATFORM)
      .eq('contact_id', sessionId)
  }

  if (stored && wantsHandoff) {
    await markHandedOff(sessionId)
    await notifyHandoff(sessionId, contactName)
  }

  return {
    reply: row
      ? (row as SiteMessage)
      : { id: `local-${Date.now()}`, direction: 'out', body, created_at: new Date().toISOString() },
    handoff: wantsHandoff,
    stored,
  }
}

/** Email all'admin con tutta la conversazione e il link per rispondere dalla casella. */
async function notifyHandoff(sessionId: string, contactName: string | null, transcript?: SiteMessage[]) {
  const messages = transcript ?? (await loadSession(sessionId))
  const userText = messages.filter((m) => m.direction === 'in').map((m) => m.body).join('\n')
  const email = userText.match(EMAIL_RE)?.[0] || null
  const phone = userText.match(PHONE_RE)?.[0]?.trim() || null
  const who = contactName || 'Visitatore del sito'
  const link = `${SITE_URL}/admin/inbox?c=${encodeURIComponent(`${WEB_PLATFORM}:${sessionId}`)}`

  const transcriptText = messages
    .map((m) => `${m.direction === 'in' ? who : 'Assistente'}: ${m.body}`)
    .join('\n\n')
  const transcriptHtml = messages
    .map(
      (m) =>
        `<p style="margin: 0 0 10px;"><strong style="color: ${m.direction === 'in' ? '#c2410c' : '#555'};">${escapeHtml(
          m.direction === 'in' ? who : 'Assistente'
        )}:</strong> ${escapeHtml(m.body).replace(/\n/g, '<br />')}</p>`
    )
    .join('')

  const [emailResult, pushResult] = await Promise.allSettled([
    sendEmail({
      to: [...ADMIN_EMAILS],
      replyTo: email || undefined,
      subject: `Chat sito: ${who} aspetta un operatore`,
      text: `${who} ha chiesto di parlare con il team dalla chat del sito.\n\nEmail: ${email || '-'}\nTelefono: ${phone || '-'}\n\nConversazione:\n${transcriptText}\n\nRispondi in tempo reale: ${link}`,
      html: emailLayout(`
<p><strong>${escapeHtml(who)}</strong> ha chiesto di parlare con il team dalla chat del sito ed è in attesa.</p>
<p>Email: ${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '-'}<br />
Telefono: ${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : '-'}</p>
<p><a href="${link}" style="display: inline-block; background: #ff3d00; color: #ffffff; padding: 12px 20px; border-radius: 999px; text-decoration: none; font-weight: 600;">Apri la chat e rispondi ora</a></p>
<p style="margin-top: 20px;"><strong>Conversazione:</strong></p>
<div style="background: #f7f7f7; padding: 14px 16px; border-radius: 8px;">${transcriptHtml}</div>`),
    }),
    sendPushToAdmins({
      title: `${who} aspetta un operatore · Chat sito`,
      body: 'Apri la chat per rispondere in tempo reale.',
      url: `/admin/inbox?c=${encodeURIComponent(`${WEB_PLATFORM}:${sessionId}`)}`,
      tag: `web:${sessionId}`,
    }),
  ])
  console.log('chat sito, passaggio all\'operatore:', {
    email: emailResult.status === 'fulfilled' ? emailResult.value : 'errore',
    push: pushResult.status === 'fulfilled' ? pushResult.value : 'errore',
  })
}

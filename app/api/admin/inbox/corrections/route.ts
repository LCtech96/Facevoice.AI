import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { regenerateDraft } from '@/lib/meta/agent'
import {
  MAX_CORRECTED_CHARS,
  MAX_FEEDBACK_CHARS,
  answeredMessage,
  isStrongRule,
  readRules,
  saveManualCorrection,
  sameExceptSpaces,
  type ReplyRule,
  type SavedHow,
} from '@/lib/corrections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SELECT = 'id, platform, contact_id, kind, direction, body, status, error_message, contact_name, reply_to, created_at, origin'

// "Correggi" nella casella Messaggi, su una bozza dell'AI o su una risposta gia' inviata
// dall'AI (automatica o approvata cosi' com'era). body: { messageId, feedback, corrected? }:
// cosa non va / come dovrebbe rispondere (testo libero) e, se c'e', la risposta giusta.
// Si salva come correzione (regola + esempio, lib/corrections.ts): pesa 1 se corregge
// l'admin, 0,5 se un dipendente. Su una bozza, intanto, la bozza si rifa' subito
// applicando la correzione (resta da controllare e inviare). Possono correggere l'admin e
// i dipendenti che possono rispondere nella casella.

export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
  const feedback = typeof body?.feedback === 'string' ? body.feedback.trim() : ''
  const corrected = typeof body?.corrected === 'string' ? body.corrected.trim() : ''
  if (!feedback && !corrected) return NextResponse.json({ error: 'Scrivi cosa non va o come dovrebbe rispondere.' }, { status: 400 })
  if (feedback.length > MAX_FEEDBACK_CHARS) return NextResponse.json({ error: 'Indicazione troppo lunga (massimo 1.000 caratteri).' }, { status: 400 })
  if (corrected.length > MAX_CORRECTED_CHARS) return NextResponse.json({ error: 'Risposta troppo lunga (massimo 2.000 caratteri).' }, { status: 400 })

  const read = (columns: string) => supabaseAdmin.from('social_messages').select(columns).eq('id', messageId).maybeSingle()
  let { data, error } = await read(SELECT)
  // Senza la colonna origin (migrazione non eseguita) si correggono solo le bozze.
  if (error) ({ data, error } = await read(SELECT.replace(', origin', '')))
  const reply = data as unknown as {
    id: string
    platform: string
    contact_id: string
    kind: string
    direction: string
    body: string | null
    status: string | null
    reply_to: string | null
    created_at: string
    origin?: string | null
  } | null
  const isDraft = reply?.status === 'pending'
  const isAiSent = reply?.status === 'sent' && (reply.origin === 'ai_auto' || reply.origin === 'ai_approved')
  if (!reply || reply.direction !== 'out' || (!isDraft && !isAiSent)) {
    return NextResponse.json({ error: 'Risposta dell’AI non trovata (si correggono le bozze e le risposte scritte dall’AI).' }, { status: 404 })
  }
  if (corrected && sameExceptSpaces(corrected, String(reply.body || ''))) {
    if (!feedback) return NextResponse.json({ error: 'La risposta giusta è uguale a quella dell’AI: cambiala per correggerla.' }, { status: 400 })
  }

  const incoming = await answeredMessage(reply).catch(() => '')
  // Bozza gia' corretta prima: conta il testo scritto davvero dall'AI.
  const earlier = isDraft
    ? (await readRules().catch(() => [] as ReplyRule[])).find((r) => r.messageId === reply.id || (r.messageIds || []).includes(reply.id))
    : undefined
  const wrong = earlier?.example.wrong?.trim() ? earlier.example.wrong : String(reply.body || '')

  // Correzione salvata e bozza rifatta insieme: la bozza ha gia' l'indicazione nel prompt.
  const [saved, regenerated] = await Promise.all([
    saveManualCorrection({
      platform: reply.platform,
      incoming,
      wrong,
      corrected,
      feedback,
      messageId: reply.id,
      byAdmin: access.isAdmin,
      by: access.email,
    }).catch((e) => {
      console.error('correzione non salvata:', e instanceof Error ? e.message : e)
      return null
    }),
    isDraft ? regenerateDraft(reply.id, { feedback: feedback || 'usa la risposta giusta indicata', corrected }) : Promise.resolve(null),
  ])
  if (!saved) return NextResponse.json({ error: 'Correzione non salvata, riprova.' }, { status: 500 })

  const { data: message } = isDraft ? await supabaseAdmin.from('social_messages').select(SELECT).eq('id', reply.id).maybeSingle() : { data: null }
  const how: SavedHow = saved.how
  return NextResponse.json({
    ok: true,
    rule: saved.rule,
    learned: saved.learned,
    how,
    strong: isStrongRule(saved.rule),
    regenerated: Boolean(regenerated?.ok),
    ...(regenerated && !regenerated.ok ? { regenerateError: regenerated.reason } : {}),
    message,
  })
}

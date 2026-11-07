import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { deliverDraft, saveTeamMessage } from '@/lib/saas/responder'
import { MAX_TEXT, chatSendWindow, type SendPlatform } from '@/lib/saas/assistant-send'
import { campaignOfReply } from '@/lib/saas/campaign'
import {
  MAX_CORRECTED_CHARS,
  addChatCorrection,
  answeredMessage,
  readChatCorrections,
  sameExceptSpaces,
  saveGeneralCorrection,
  isStrongRule,
  type SavedHow,
  type ReplyRule,
} from '@/lib/saas/corrections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Omnichat, "Correggi" sotto una risposta dell'AI (inviata o in bozza): come avrebbe
// dovuto rispondere. scope 'chat' = solo in questa conversazione, 'always' = regola
// per i messaggi simili (una chiamata AI). sendNow: manda anche ora il testo corretto
// in questa chat, come messaggio del team (origin 'manual'): una bozza parte al posto
// del testo dell'AI, dopo una risposta gia' inviata parte un messaggio nuovo. Senza
// sendNow una bozza prende il testo corretto (resta da controllare e inviare).
// Possono correggere tutti quelli che possono rispondere nell'Omnichat. Le regole
// "Sempre" restano sotto le Istruzioni finche' correzioni simili non arrivano al peso
// STRONG_WEIGHT (corrections.ts: titolare/amministratori pesano 1, membri del team 0,5). Correzione "solo in questa chat" di una risposta scritta con la
// Campagna: si segna (campaign) e vale solo mentre vale quella campagna.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  const corrected = typeof body.corrected === 'string' ? body.corrected.trim() : ''
  const scope = body.scope === 'chat' || body.scope === 'always' ? (body.scope as 'chat' | 'always') : null
  const sendNow = body.sendNow === true
  if (!scope) return NextResponse.json({ error: 'Scegli se vale solo in questa chat o sempre.' }, { status: 400 })
  if (!corrected) return NextResponse.json({ error: 'Scrivi come avrebbe dovuto rispondere.' }, { status: 400 })
  if (corrected.length > MAX_CORRECTED_CHARS) return NextResponse.json({ error: 'Testo troppo lungo (massimo 2.000 caratteri).' }, { status: 400 })

  const { data: reply } = await access.db
    .from('social_messages')
    .select('id, platform, kind, direction, contact_id, body, status, origin, reply_to, created_at')
    .eq('id', messageId)
    .maybeSingle()
  if (!reply || reply.direction !== 'out' || reply.kind !== 'message' || !String(reply.origin || '').startsWith('ai')) {
    return NextResponse.json({ error: 'Risposta dell’AI non trovata.' }, { status: 404 })
  }
  if (!['sent', 'pending', 'failed'].includes(String(reply.status))) return NextResponse.json({ error: 'Questa risposta si sta inviando: riprova tra poco.' }, { status: 409 })
  // Solo gli spazi non contano: togliere emoji o punti esclamativi e' gia' una correzione.
  if (sameExceptSpaces(corrected, String(reply.body))) {
    return NextResponse.json({ error: 'Il testo è uguale alla risposta dell’AI: cambialo per correggerla.' }, { status: 400 })
  }
  const platform = String(reply.platform)
  const contactId = String(reply.contact_id)
  const isDraft = reply.status === 'pending' || reply.status === 'failed'

  // Prima di salvare: se va mandata ora, si deve poter scrivere in questa chat.
  if (sendNow) {
    const { data: lastIn } = await access.db
      .from('social_messages')
      .select('created_at')
      .eq('platform', platform)
      .eq('contact_id', contactId)
      .eq('kind', 'message')
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const window = chatSendWindow(platform, lastIn?.created_at as string | undefined)
    if (!window.ok) return NextResponse.json({ error: `Non si può mandare ora: ${window.reason}` }, { status: 400 })
    const max = MAX_TEXT[platform as SendPlatform]
    if (max && corrected.length > max) return NextResponse.json({ error: `Testo troppo lungo da mandare qui (massimo ${max} caratteri).` }, { status: 400 })
  }

  const incoming = await answeredMessage(access.db, {
    platform,
    kind: 'message',
    contact_id: contactId,
    reply_to: reply.reply_to as string | null,
    created_at: String(reply.created_at),
  }).catch(() => '')
  // Bozza gia' corretta prima (il testo dentro e' quello del team): conta quello scritto dall'AI.
  const earlier = isDraft
    ? (await readChatCorrections(access.workspace.id, platform, contactId).catch(() => [])).find((c) => c.messageId === reply.id)
    : undefined
  const wrong = earlier?.wrong.trim() ? earlier.wrong : String(reply.body)
  let rule: ReplyRule | null = null
  let learned = false
  let how: SavedHow | null = null
  try {
    if (scope === 'chat') {
      // Segni non letti = errore (meglio riprovare che salvare una correzione della campagna come se fosse per sempre).
      const written = await campaignOfReply(access.workspace.id, reply.id as string, reply.created_at as string)
      await addChatCorrection(access.workspace.id, platform, contactId, {
        at: new Date().toISOString(),
        incoming,
        wrong,
        corrected,
        by: access.userId,
        messageId: reply.id as string,
        ...(written && written !== 'unknown' ? { campaign: written.since } : {}),
      })
    } else {
      const saved = await saveGeneralCorrection(access.workspace.id, {
        platform,
        incoming,
        wrong,
        corrected,
        messageId: reply.id as string,
        byAdmin: access.workspace.role !== 'member',
      })
      rule = saved.rule
      learned = saved.learned
      how = saved.how
    }
  } catch (error) {
    console.error('saas correzione non salvata:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Correzione non salvata, riprova.' }, { status: 500 })
  }

  let sent = false
  let sendError: string | undefined
  let draftUpdated = false
  if (!sendNow && isDraft) {
    // La bozza tiene il testo corretto per tutti (ricarica, altre schede, colleghi). Origin
    // resta ai_*: inviata cosi' com'e' e' 'ai_approved' e non si impara una seconda volta.
    const { data: updated } = await access.db
      .from('social_messages')
      .update({ body: corrected })
      .eq('id', reply.id as string)
      .in('status', ['pending', 'failed'])
      .select('id')
    draftUpdated = Boolean(updated?.length)
  }
  if (sendNow) {
    let draftId: string | null = null
    if (isDraft) draftId = reply.id as string
    else {
      const saved = await saveTeamMessage(access.db, platform, contactId, corrected)
      if ('error' in saved) sendError = saved.error === 'not_found' ? 'conversazione non trovata' : 'messaggio non salvato'
      else draftId = saved.id
    }
    if (draftId) {
      const result = await deliverDraft(access.db, draftId, corrected, 'manual')
      sent = result.ok
      sendError = result.error
    }
  }
  return NextResponse.json({
    ok: true,
    scope,
    rule,
    learned,
    how,
    strong: rule ? isStrongRule(rule) : false,
    sent,
    draftUpdated,
    ...(sendError ? { sendError } : {}),
  })
}

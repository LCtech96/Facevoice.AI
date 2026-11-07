import { NextRequest, NextResponse } from 'next/server'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import { ACTION_ID_RE, acceptAction, cardFor, discardAction, loadAction, type ConfirmCard } from '@/lib/assistant-confirm'
import { updateState } from '@/lib/assistant-state'

export const dynamic = 'force-dynamic'
// Email in serie e pubblicazioni possono durare: serve il tempo massimo.
export const maxDuration = 300

// Schede di conferma della super chat (e della chat della pagina Clienti).
// POST { id, decision: 'accept' | 'discard', text? }: solo l'amministratore. Esegue
// l'azione salvata una volta sola (lib/assistant-confirm), poi aggiorna la scheda
// nella conversazione, cosi' l'esito resta visibile anche all'assistente.
// GET ?ids=a,b: stato attuale delle schede (per rimettere in pari la pagina).

/** Stato della scheda nella conversazione: tutte le copie della stessa azione. */
async function syncCard(scope: 'leads' | 'super', card: ConfirmCard, sentLeadIds?: string[]) {
  await updateState(scope, (s) => {
    let changed = false
    for (const turn of s.turns) {
      turn.actions?.forEach((a, i) => {
        if (a.kind !== 'confirm' || a.id !== card.id) return
        turn.actions![i] = {
          ...a,
          state: card.state,
          outcome: card.outcome,
          error: card.error,
          retryable: card.retryable,
          ...(a.editable && card.text !== undefined ? { text: card.text } : {}),
        }
        changed = true
      })
    }
    // Email partite: le bozze non restano da inviare.
    if (sentLeadIds?.length) {
      s.drafts = s.drafts.filter((d) => !sentLeadIds.includes(d.leadId))
      changed = true
    }
    return changed ? undefined : false
  }).catch((error) => console.error('conferma: scheda non aggiornata', error instanceof Error ? error.message : error))
}

export async function POST(req: NextRequest) {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  if (!access.isAdmin) {
    return NextResponse.json({ error: 'Solo l’amministratore può confermare o scartare queste azioni.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  const decision = body?.decision
  if (!ACTION_ID_RE.test(id) || (decision !== 'accept' && decision !== 'discard')) {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }
  const result =
    decision === 'accept'
      ? await acceptAction(id, access.email, { text: typeof body?.text === 'string' ? body.text : undefined })
      : await discardAction(id, access.email)
  if (!result.action || !result.card) return NextResponse.json({ error: result.message || 'Azione non trovata' }, { status: 404 })
  await syncCard(result.action.scope, result.card, result.sentLeadIds)
  return NextResponse.json({ ok: result.ok, card: result.card, ...(result.message ? { message: result.message } : {}) })
}

export async function GET(req: NextRequest) {
  const access = await getStaffAccess(req)
  if (!access || !(canAccess(access, 'assistant', 'view') || canAccess(access, 'leads', 'assistant'))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').filter((id) => ACTION_ID_RE.test(id)).slice(0, 20)
  const actions = await Promise.all(ids.map((id) => loadAction(id)))
  return NextResponse.json({ cards: actions.filter((a): a is NonNullable<typeof a> => Boolean(a)).map((a) => cardFor(a)) })
}

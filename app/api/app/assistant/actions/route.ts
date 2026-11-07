import { NextRequest, NextResponse } from 'next/server'
import { requireAssistant } from '@/lib/assistant-access'
import { loadChat, refreshPostActions, saveChat, type ChatTurn } from '@/lib/saas/assistant'
import { discardPending, executePending, loadPendingActions, refreshAssistantCards } from '@/lib/saas/assistant-actions'

export const dynamic = 'force-dynamic'
// Come la pubblicazione dei post (app/api/app/posts): Instagram puo' metterci piu' di due minuti.
export const maxDuration = 300

// Schede di conferma dell'Assistente (doppia autorizzazione, lib/saas/assistant-actions.ts):
// POST { id, op: "confirm" | "discard", text?, pin? } dal clic su «Accetta e invia» / «Conferma»
// oppure «Scarta». Solo chi ha preparato l'azione, con l'assistente attivo e il ruolo di
// amministratore (come la chat). L'azione si esegue UNA volta, con i controlli rifatti adesso
// (24 ore di Meta, limiti, accessi); scaduta o gia' gestita: messaggio chiaro, niente rifatto.
// L'esito entra nella chat come risposta dell'Assistente (anche per le richieste dopo); dopo
// «Scarta» l'Assistente chiede cosa serve invece.

const BUSY_MS = 4 * 60_000

export async function POST(req: NextRequest) {
  const access = await requireAssistant(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  const op = body?.op === 'confirm' ? 'confirm' : body?.op === 'discard' ? 'discard' : null
  if (!id || !op) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 })
  const ws = access.workspace.id
  const stored = (await loadPendingActions(ws)).find((a) => a.id === id)
  if (!stored || stored.createdBy !== access.userId) return NextResponse.json({ error: 'Azione non trovata.' }, { status: 404 })
  const chatId = stored.chatId
  const history = await loadChat(ws, access.userId, chatId)
  // Una richiesta alla chat ancora in corso salverebbe sopra l'esito: prima si aspetta la risposta.
  const last = history[history.length - 1]
  if (last?.role === 'user' && Date.now() - new Date(last.at).getTime() < BUSY_MS) {
    return NextResponse.json({ error: 'Sto ancora lavorando alla richiesta precedente: aspetta la risposta, poi conferma.' }, { status: 409 })
  }
  // pin: solo per la condivisione di un contratto (mai salvato ne' scritto nei log: al server ne resta l'hash).
  const outcome =
    op === 'confirm'
      ? await executePending(access.db, access.userId, id, { text: body.text, pin: typeof body.pin === 'string' ? body.pin : undefined, origin: req.nextUrl.origin })
      : await discardPending(access.db, access.userId, id)
  if (outcome.code !== 'done' && outcome.code !== 'failed' && outcome.code !== 'discarded') {
    const status = outcome.code === 'expired' ? 410 : outcome.code === 'invalid' ? 400 : outcome.code === 'not_found' ? 404 : outcome.code === 'forbidden' ? 403 : 409
    const turns = await refreshAssistantCards(ws, history)
    return NextResponse.json({ error: outcome.message, code: outcome.code, turns, chatId }, { status })
  }
  // Esito nella chat (rilette ora: nel frattempo potrebbe essere cambiata).
  const reply: ChatTurn = { role: 'assistant', text: outcome.message, ...(outcome.cards.length ? { actions: outcome.cards } : {}), at: new Date().toISOString() }
  const turns = [...(await loadChat(ws, access.userId, chatId)), reply]
  await saveChat(ws, access.userId, turns, chatId)
  return NextResponse.json({
    ok: outcome.ok,
    code: outcome.code,
    message: outcome.message,
    turns: await refreshPostActions(access.db, await refreshAssistantCards(ws, turns)),
    chatId,
  })
}

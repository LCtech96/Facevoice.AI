import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { asModelChoice, runWithStatus } from '@/lib/ai'
import { loadChat, refreshPostActions, runClientAssistant, saveChat, type ChatTurn } from '@/lib/saas/assistant'
import { describePhotos } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Assistente AI dell'area clienti: conversazione (GET), nuova richiesta con le
// foto gia' caricate (POST), nuova conversazione (DELETE).

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const turns = await refreshPostActions(access.db, await loadChat(access.workspace.id, access.userId))
  return NextResponse.json({ turns })
}

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const message = String(body.message || '').trim().slice(0, 3000)
  // Modello scelto dal cliente nella chat: vale per tutta la richiesta.
  const model = asModelChoice(body.model)
  const images = (Array.isArray(body.images) ? body.images : []).filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('https://')).slice(0, 10)
  if (!message && !images.length) return NextResponse.json({ error: 'Scrivi cosa vuoi fare' }, { status: 400 })
  // Slide toccata nell'anteprima: la richiesta riguarda solo quella.
  const slide = Number(body.target?.slide)
  const target =
    typeof body.target?.postId === 'string' && /^[0-9a-f-]{36}$/i.test(body.target.postId) && Number.isInteger(slide) && slide >= 1 && slide <= 10
      ? { postId: body.target.postId as string, slide, thumb: typeof body.target.thumb === 'string' && body.target.thumb.startsWith('https://') ? body.target.thumb : undefined }
      : null

  const history = await loadChat(access.workspace.id, access.userId)
  const last = history[history.length - 1]
  if (last?.role === 'user' && Date.now() - new Date(last.at).getTime() < 4 * 60_000) {
    return NextResponse.json({ error: 'Sto ancora lavorando alla richiesta precedente: aspetta un momento.' }, { status: 409 })
  }
  const userTurn: ChatTurn = { role: 'user', text: message, ...(images.length ? { images } : {}), ...(target ? { target } : {}), at: new Date().toISOString() }
  // La richiesta si salva subito: se la pagina si chiude, la risposta arriva lo stesso.
  await saveChat(access.workspace.id, access.userId, [...history, userTurn])
  let reply: ChatTurn
  try {
    // Ogni foto si legge una per una (nell'ordine di caricamento): l'assistente sa cosa mostra ciascuna.
    const result = await runWithStatus({ status: () => {}, model }, async () => {
      if (images.length) {
        userTurn.imageNotes = await describePhotos(images, access.workspace.id)
        await saveChat(access.workspace.id, access.userId, [...history, userTurn])
      }
      return runClientAssistant(access.db, access.userId, message, images, history, userTurn.imageNotes || [], target)
    })
    reply = { role: 'assistant', text: result.reply, ...(result.actions.length ? { actions: result.actions } : {}), at: new Date().toISOString() }
  } catch (error) {
    console.error('saas assistente:', error instanceof Error ? error.message : error)
    reply = { role: 'assistant', text: 'Qualcosa non è andato: riprova tra poco.', at: new Date().toISOString() }
  }
  const turns = [...history, userTurn, reply]
  await saveChat(access.workspace.id, access.userId, turns)
  return NextResponse.json({ turns: await refreshPostActions(access.db, turns) })
}

export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  await saveChat(access.workspace.id, access.userId, [])
  return NextResponse.json({ turns: [] })
}

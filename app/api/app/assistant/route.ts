import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { asModelChoice, runWithStatus } from '@/lib/ai'
import { aiBlockedMessage, isAIBlockedError, workspaceAIBlocked } from '@/lib/usage-limits'
import { chatForPost, loadChat, loadChatIndex, openChat, postView, refreshPostActions, runClientAssistant, saveChat, startChat, type ChatTurn } from '@/lib/saas/assistant'
import { describePhotos, getPost, postVersions } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Assistente AI dell'area clienti: conversazione (GET, anche ?chat=<id> o ?post=<id> per
// riaprire la chat in cui si e' lavorato a un post), nuova richiesta con le foto gia'
// caricate (POST), nuova conversazione (DELETE: le altre restano salvate).

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const ws = access.workspace.id
  const params = req.nextUrl.searchParams
  let chatId: string
  const postId = params.get('post')
  if (postId && /^[0-9a-f-]{36}$/i.test(postId)) {
    // Dai contenuti programmati: la chat in cui si e' lavorato a quel post; se non c'e'
    // piu', una chat nuova che parte dal post.
    const found = await chatForPost(ws, access.userId, postId)
    if (found) chatId = await openChat(ws, access.userId, found)
    else {
      const post = await getPost(access.db, postId)
      chatId = await startChat(ws, access.userId)
      if (post) {
        // La chat di prima non c'e' piu' (es. cancellata prima che le chat restassero salvate):
        // si riparte dal post con tutte le sue versioni salvate, da guardare o riprendere.
        const view = postView(post)
        const versions = (await postVersions(post.id)).filter((v) => v.media.join('|') !== post.media.join('|') || v.caption !== post.caption)
        const seed: ChatTurn[] = versions.map((v) => ({ role: 'assistant', text: 'Versione salvata di questo post.', actions: [{ kind: 'post', post: { ...view, media: v.media, caption: v.caption } }], at: v.at }))
        seed.push({
          role: 'assistant',
          text:
            post.status === 'published'
              ? `Ecco il post pubblicato${versions.length ? ' e, sopra, le sue versioni salvate: con «Riprendi questa versione» ne fai una nuova bozza' : ''}.`
              : 'Ecco il post da modificare: tocca le slide per correggerle, poi programmalo di nuovo.',
          actions: [{ kind: 'post', post: view }],
          at: new Date().toISOString(),
        })
        await saveChat(ws, access.userId, seed, chatId)
      }
    }
  } else if (params.get('chat')) {
    chatId = await openChat(ws, access.userId, String(params.get('chat')))
  } else {
    chatId = (await loadChatIndex(ws, access.userId)).current
  }
  const turns = await refreshPostActions(access.db, await loadChat(ws, access.userId, chatId))
  return NextResponse.json({ turns, chatId })
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
  // AI del piano finita: la richiesta non parte (e non resta in chat).
  if (await workspaceAIBlocked(access.workspace.id)) return NextResponse.json({ error: await aiBlockedMessage(access.workspace.id), blocked: true }, { status: 402 })
  // Slide toccata nell'anteprima: la richiesta riguarda solo quella.
  const slide = Number(body.target?.slide)
  const target =
    typeof body.target?.postId === 'string' && /^[0-9a-f-]{36}$/i.test(body.target.postId) && Number.isInteger(slide) && slide >= 1 && slide <= 10
      ? { postId: body.target.postId as string, slide, thumb: typeof body.target.thumb === 'string' && body.target.thumb.startsWith('https://') ? body.target.thumb : undefined }
      : null

  // Chat aperta nella pagina: le risposte vanno li' anche se intanto se n'e' aperta un'altra.
  const chatId = typeof body.chatId === 'string' ? body.chatId : (await loadChatIndex(access.workspace.id, access.userId)).current
  const history = await loadChat(access.workspace.id, access.userId, chatId)
  const last = history[history.length - 1]
  if (last?.role === 'user' && Date.now() - new Date(last.at).getTime() < 4 * 60_000) {
    return NextResponse.json({ error: 'Sto ancora lavorando alla richiesta precedente: aspetta un momento.' }, { status: 409 })
  }
  const userTurn: ChatTurn = { role: 'user', text: message, ...(images.length ? { images } : {}), ...(target ? { target } : {}), at: new Date().toISOString() }
  // La richiesta si salva subito: se la pagina si chiude, la risposta arriva lo stesso.
  await saveChat(access.workspace.id, access.userId, [...history, userTurn], chatId)
  let reply: ChatTurn
  let blocked = false
  try {
    // Ogni foto si legge una per una (nell'ordine di caricamento): l'assistente sa cosa mostra ciascuna.
    // Tutte le chiamate all'AI di questa richiesta contano per lo spazio (e per il limite del piano).
    const result = await runWithStatus({ status: () => {}, model, workspaceId: access.workspace.id }, async () => {
      if (images.length) {
        userTurn.imageNotes = await describePhotos(images, access.workspace.id)
        await saveChat(access.workspace.id, access.userId, [...history, userTurn], chatId)
      }
      return runClientAssistant(access.db, access.userId, message, images, history, userTurn.imageNotes || [], target)
    })
    reply = { role: 'assistant', text: result.reply, ...(result.actions.length ? { actions: result.actions } : {}), at: new Date().toISOString() }
  } catch (error) {
    // Limite raggiunto durante il lavoro: si dice chiaramente, non "qualcosa non è andato".
    blocked = isAIBlockedError(error)
    if (!blocked) console.error('saas assistente:', error instanceof Error ? error.message : error)
    // Il testo dell'errore dice se e' finita l'AI del piano o se manca il piano.
    reply = { role: 'assistant', text: blocked ? (error as Error).message : 'Qualcosa non è andato: riprova tra poco.', at: new Date().toISOString() }
  }
  const turns = [...history, userTurn, reply]
  await saveChat(access.workspace.id, access.userId, turns, chatId)
  return NextResponse.json({ turns: await refreshPostActions(access.db, turns), chatId, ...(blocked ? { blocked: true } : {}) })
}

export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  // Nuova chat: quella di prima resta salvata (si riapre dai contenuti programmati).
  const chatId = await startChat(access.workspace.id, access.userId)
  return NextResponse.json({ turns: [], chatId })
}

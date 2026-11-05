import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { asModelChoice, emptyTally, runWithStatus } from '@/lib/ai'
import { usageSummary } from '@/lib/eur'
import { loadChat, logPostChange, postView, withArrange, type ChatTurn } from '@/lib/saas/assistant'
import { arrangeSlides, cancelPost, deletePost, editCaption, editSlides, extractPhotos, setDesign, getPost, restoreVersion, restyleSlides, listPosts, publishPost, schedulePost, updatePost, type PostPlatform, type PostRow } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Post dello spazio: elenco o un post (GET ?id=), e dai pulsanti dell'anteprima
// modifica, sposta o togli slide, programma, annulla, pubblica ora, elimina (PATCH).

const view = async (post: PostRow) => (await withArrange([postView(post)]))[0]

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const post = await getPost(access.db, id)
    return post ? NextResponse.json({ post: await view(post) }) : NextResponse.json({ error: 'Post non trovato' }, { status: 404 })
  }
  const posts = (await listPosts(access.db, { limit: 40 })).filter((p) => p.status !== 'cancelled')
  return NextResponse.json({ posts: await withArrange(posts.map(postView)) })
}

// Azioni che devono riguardare esattamente la versione che il cliente vede.
const NEEDS_BASE = new Set(['arrange', 'edit_slides', 'extract', 'restyle', 'design', 'schedule', 'publish'])

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  const action = String(body.action || '')
  // Chat aperta nella pagina: le modifiche dall'anteprima entrano in quella.
  const chatId = typeof body.chatId === 'string' ? body.chatId : null
  // Modello scelto nella chat: vale anche per le correzioni e i ripristini dall'anteprima.
  // Contatore dei token: il costo della correzione si mostra in chat sotto la risposta.
  const tally = emptyTally()
  const withModel = <T,>(fn: () => Promise<T>) => runWithStatus({ status: () => {}, model: asModelChoice(body.model), usage: tally }, fn)
  const platforms = Array.isArray(body.platforms) ? (body.platforms.filter((p: unknown) => p === 'instagram' || p === 'facebook') as PostPlatform[]) : undefined
  try {
    // base: le slide che vedeva la pagina. Se nel frattempo sono cambiate (es. salvataggio
    // finito dopo una connessione caduta) non si tocca niente: si rimanda l'ultima versione,
    // cosi' non si pubblica o modifica mai un post diverso da quello mostrato.
    if (NEEDS_BASE.has(action) && Array.isArray(body.base)) {
      const current = await getPost(access.db, id)
      if (current && body.base.join('|') !== current.media.join('|')) {
        return NextResponse.json(
          { error: 'Il post era già cambiato: questa è l’ultima versione. Controllala e riprova.', post: await view(current) },
          { status: 409 }
        )
      }
    }
    // Didascalia e social si salvano solo per le azioni sul post stesso (non per eliminare,
    // annullare la programmazione o riprendere una versione, che crea una nuova bozza).
    if (!['delete', 'unschedule', 'restore'].includes(action) && (typeof body.caption === 'string' || typeof body.facebook === 'string' || platforms)) {
      await updatePost(access.db, id, { caption: body.caption, facebook: body.facebook, platforms })
    }
    let post
    let done: string[] | undefined
    // Modifiche dall'anteprima: si aggiungono alla chat, cosi' ogni versione resta in cronologia.
    let turns: ChatTurn[] | undefined
    const numbers = Array.isArray(body.slides) ? (body.slides as unknown[]).map(Number).filter(Number.isFinite).slice(0, 10) : []
    const before = NEEDS_BASE.has(action) ? await getPost(access.db, id) : null
    switch (action) {
      case 'arrange':
        // slides: numeri delle slide attuali nel nuovo ordine (quelle che mancano si tolgono).
        post = await arrangeSlides(access.db, id, numbers)
        if (before && post.media.join('|') !== before.media.join('|')) {
          turns = await logPostChange(access.db, access.userId, { text: `Nuovo ordine delle slide: ${numbers.join(', ')}` }, `Ho salvato il nuovo ordine: ${post.media.length} slide, con i numeri aggiornati.`, post, undefined, chatId)
        }
        break
      case 'edit_slides': {
        // Correzione delle sole slide scelte (numeri da 1): le altre restano identiche.
        const instruction = String(body.instruction || '')
        const result = await withModel(() => editSlides(access.db, id, numbers, instruction))
        post = result.post
        done = result.done
        if (done.length) {
          const first = Math.max(1, Math.min(numbers[0] || 1, post.media.length))
          turns = await logPostChange(
            access.db,
            access.userId,
            { text: instruction.trim().slice(0, 1500), target: { postId: id, slide: first, slides: numbers, thumb: before?.media[first - 1] } },
            `Fatto: ${done.join(' · ')}.${done.some((d) => d.includes('tutte le slide')) ? '' : done.some((d) => d.includes('estratte')) ? ' Le altre slide sono rimaste uguali, cambia solo il numero.' : ' Le altre slide non sono cambiate.'}`,
            post,
            await usageSummary(tally),
            chatId
          )
        }
        break
      }
      case 'edit_caption': {
        // Solo la didascalia, con una chiamata breve all'AI (es. "traduci in inglese").
        const instruction = String(body.instruction || '')
        const result = await withModel(() => editCaption(access.db, id, instruction))
        post = result.post
        done = result.done
        turns = await logPostChange(access.db, access.userId, { text: `Didascalia: ${instruction.trim().slice(0, 600)}` }, `Fatto: ${done.join(' · ')}. Le slide non sono cambiate.`, post, await usageSummary(tally), chatId)
        break
      }
      case 'design': {
        // Stile e/o colori delle slide: si rifanno tutte, stessi testi e foto, nessuna AI.
        const result = await setDesign(access.db, id, { layout: body.layout, mix: body.mix, textLayout: body.textLayout })
        post = result.post
        done = result.done
        if (done.length) {
          turns = await logPostChange(access.db, access.userId, { text: 'Cambia lo stile delle slide' }, `Fatto: ${done.join(' · ')}. Vale anche per i prossimi caroselli.`, post, undefined, chatId)
        }
        break
      }
      case 'restyle': {
        // Slide rifatte con la grafica attuale (stessi testi e foto, nessuna AI).
        const result = await restyleSlides(access.db, id)
        post = result.post
        done = result.done
        if (done.length) {
          turns = await logPostChange(access.db, access.userId, { text: 'Aggiorna la grafica delle slide' }, `Fatto: ${done.join(' · ')}.`, post, undefined, chatId)
        }
        break
      }
      case 'extract': {
        // La slide e' uno screenshot con piu' foto: ogni foto diventa una slide.
        const result = await withModel(() => extractPhotos(access.db, id, numbers.slice(0, 1)))
        post = result.post
        done = result.done
        const n = numbers[0] || 1
        turns = await logPostChange(
          access.db,
          access.userId,
          { text: 'Estrai le foto da questo screenshot: una slide per ogni foto', target: { postId: id, slide: n, thumb: before?.media[n - 1] } },
          `Fatto: ${done.join(' · ')}. Le altre slide sono rimaste uguali, cambia solo il numero.`,
          post,
          await usageSummary(tally),
          chatId
        )
        break
      }
      case 'restore': {
        // Versione precedente (dalla chat) ripresa come nuova bozza.
        const media = Array.isArray(body.media) ? (body.media as unknown[]).filter((u): u is string => typeof u === 'string') : []
        const chatPhotos = (await loadChat(access.workspace.id, access.userId, chatId)).flatMap((t) => (t.role === 'user' ? t.images || [] : []))
        const result = await withModel(() => restoreVersion(access.db, id, media, typeof body.caption === 'string' ? body.caption : undefined, access.userId, chatPhotos))
        post = result.post
        const at = typeof body.at === 'string' ? new Date(body.at) : null
        const label = at && !Number.isNaN(at.getTime()) ? at.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
        turns = await logPostChange(
          access.db,
          access.userId,
          { text: `Riprendi la versione${label ? ` del ${label}` : ' precedente'}` },
          result.rebuilt
            ? 'Ecco una nuova bozza identica a quella versione. Ho riletto i testi delle slide e ritrovato le foto di partenza: puoi correggere le slide una per una, spostarle, toglierle, programmare o pubblicare. Il post di prima resta com’è.'
            : result.editable
            ? 'Ecco una nuova bozza uguale a quella versione: puoi correggerla, programmarla o pubblicarla. Il post di prima resta com’è.'
            : 'Ecco una nuova bozza uguale a quella versione: puoi programmarla o pubblicarla. È di prima che salvassi le versioni, quindi i testi delle slide non si possono correggere uno per uno: per cambiarli ricrea il carosello dalle foto.',
          post,
          await usageSummary(tally),
          chatId
        )
        break
      }
      case 'schedule':
        post = await schedulePost(access.db, id, new Date(String(body.publishAt || '')), platforms)
        break
      case 'unschedule':
        post = await cancelPost(access.db, id)
        break
      case 'publish':
        post = await publishPost(access.db, id)
        if (post.status !== 'published') return NextResponse.json({ error: post.error_message || 'Pubblicazione non riuscita', post: await view(post) }, { status: 502 })
        break
      case 'delete':
        await deletePost(access.db, id)
        return NextResponse.json({ ok: true })
      default:
        post = await getPost(access.db, id)
    }
    if (!post) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })
    return NextResponse.json({ post: await view(post), ...(done ? { done } : {}), ...(turns ? { turns } : {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Operazione non riuscita'
    console.error(`saas post ${id.slice(0, 8)} (${action || 'modifica'}): ${message}`)
    // Con l'errore si manda lo stato attuale del post: la pagina si rimette in pari.
    const current = await getPost(access.db, id).catch(() => null)
    return NextResponse.json({ error: message || 'Operazione non riuscita', ...(current ? { post: await view(current) } : {}) }, { status: 400 })
  }
}

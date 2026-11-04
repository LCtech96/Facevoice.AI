import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { postView, withArrange } from '@/lib/saas/assistant'
import { arrangeSlides, cancelPost, deletePost, editSlides, getPost, listPosts, publishPost, schedulePost, updatePost, type PostPlatform, type PostRow } from '@/lib/saas/posts'

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
const NEEDS_BASE = new Set(['arrange', 'edit_slides', 'schedule', 'publish'])

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  const action = String(body.action || '')
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
    if (action !== 'delete' && action !== 'unschedule' && (typeof body.caption === 'string' || typeof body.facebook === 'string' || platforms)) {
      await updatePost(access.db, id, { caption: body.caption, facebook: body.facebook, platforms })
    }
    let post
    let done: string[] | undefined
    switch (action) {
      case 'arrange':
        // slides: numeri delle slide attuali nel nuovo ordine (quelle che mancano si tolgono).
        post = await arrangeSlides(access.db, id, Array.isArray(body.slides) ? body.slides.map(Number).filter(Number.isFinite).slice(0, 10) : [])
        break
      case 'edit_slides': {
        // Correzione delle sole slide scelte (numeri da 1): le altre restano identiche.
        const result = await editSlides(access.db, id, Array.isArray(body.slides) ? body.slides.map(Number).filter(Number.isFinite).slice(0, 10) : [], String(body.instruction || ''))
        post = result.post
        done = result.done
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
    return NextResponse.json({ post: await view(post), ...(done ? { done } : {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Operazione non riuscita'
    console.error(`saas post ${id.slice(0, 8)} (${action || 'modifica'}): ${message}`)
    // Con l'errore si manda lo stato attuale del post: la pagina si rimette in pari.
    const current = await getPost(access.db, id).catch(() => null)
    return NextResponse.json({ error: message || 'Operazione non riuscita', ...(current ? { post: await view(current) } : {}) }, { status: 400 })
  }
}

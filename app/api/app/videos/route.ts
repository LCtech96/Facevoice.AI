import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { asModelChoice, runWithStatus } from '@/lib/ai'
import { assertAIAllowed, isAIBlockedError } from '@/lib/usage-limits'
import { listConnections } from '@/lib/saas/connections'
import { canPublish } from '@/lib/saas/publish'
import { postView } from '@/lib/saas/assistant-actions'
import { cancelPost, createVideoPost, deletePost, getPost, publishPost, schedulePost, updatePost, writeVideoCaption, type PostPlatform, type PostRow } from '@/lib/saas/posts'
import { createVideoUpload, isVideoPost, VIDEO_MAX_MB } from '@/lib/saas/video'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Post video (pagina Contenuti programmati, "Carica video"):
// GET  -> social dove si puo' pubblicare e limite del file
// POST action=upload_url -> indirizzo firmato: il browser carica il video direttamente nell'archivio
// POST action=caption    -> didascalia scritta o cambiata con l'AI
// POST action=create     -> crea il post dal video caricato e lo pubblica subito, lo programma o lo lascia in bozza
// PATCH                  -> sui soli post video: salva didascalia e social, programma, togli programmazione, pubblica, elimina

const asPlatforms = (value: unknown): PostPlatform[] | undefined =>
  Array.isArray(value) ? (value.filter((p) => p === 'instagram' || p === 'facebook') as PostPlatform[]) : undefined

const fail = (error: unknown, fallback: string) => {
  const blocked = isAIBlockedError(error)
  const message = error instanceof Error && error.message ? error.message : fallback
  return NextResponse.json({ error: message.charAt(0).toUpperCase() + message.slice(1), ...(blocked ? { blocked: true } : {}) }, { status: blocked ? 402 : 400 })
}

/** Esito di "Pubblica ora" per il cliente (il video puo' essere ancora in elaborazione su Instagram). */
function published(post: PostRow) {
  if (post.status === 'published') return NextResponse.json({ post: postView(post), notice: 'Video pubblicato.' })
  if (post.status === 'scheduled' && post.results?.video?.container) {
    return NextResponse.json({ post: postView(post), notice: 'Instagram sta ancora elaborando il video: esce da solo entro pochi minuti.' })
  }
  return NextResponse.json({ error: post.error_message || 'Pubblicazione non riuscita', post: postView(post) }, { status: 502 })
}

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const connections = (await listConnections(access.db).catch(() => [])).filter((c) => c.status === 'connected')
  const channels = (['instagram', 'facebook'] as const).flatMap((platform) => {
    const list = connections.filter((c) => c.platform === platform)
    if (!list.length) return []
    const ready = list.find((c) => canPublish(c)) || list[0]
    return [{ platform, name: ready.display_name || ready.external_id, canPublish: canPublish(ready) }]
  })
  return NextResponse.json({ channels, maxMb: VIDEO_MAX_MB })
}

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  try {
    if (action === 'upload_url') return NextResponse.json(await createVideoUpload(access.workspace.id, body))
    if (action === 'caption') {
      await assertAIAllowed(access.workspace.id)
      const caption = await runWithStatus({ status: () => {}, model: asModelChoice(body.model), workspaceId: access.workspace.id }, () =>
        writeVideoCaption(access.workspace.id, { caption: typeof body.caption === 'string' ? body.caption : '', instruction: typeof body.instruction === 'string' ? body.instruction : '' })
      )
      return NextResponse.json({ caption })
    }
    if (action === 'create') {
      const mode = String(body.mode || 'draft')
      const publishAt = mode === 'schedule' ? new Date(String(body.publishAt || '')) : null
      if (publishAt && Number.isNaN(publishAt.getTime())) throw new Error('data o ora non valida')
      const post = await createVideoPost(access.db, {
        url: String(body.url || ''),
        caption: typeof body.caption === 'string' ? body.caption : '',
        title: typeof body.title === 'string' ? body.title : '',
        platforms: asPlatforms(body.platforms),
        userId: access.userId,
      })
      if (mode === 'now') return published(await publishPost(access.db, post.id, { waitSeconds: 45 }))
      if (publishAt) {
        try {
          return NextResponse.json({ post: postView(await schedulePost(access.db, post.id, publishAt)) })
        } catch (error) {
          // Data non valida o social non collegato: la bozza appena creata non resta in giro (il video si'),
          // cosi' si corregge e si riprova con lo stesso file.
          await access.db.from('workspace_posts').update({ status: 'cancelled' }).eq('id', post.id)
          throw error
        }
      }
      return NextResponse.json({ post: postView(post) })
    }
    return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isAIBlockedError(error)) console.error(`saas video (${action || 'azione'}): ${message}`)
    return fail(error, 'Operazione non riuscita')
  }
}

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  const action = String(body.action || '')
  const current = id ? await getPost(access.db, id) : null
  // Solo i post video: gli altri si gestiscono dall'Assistente (con le sue regole).
  if (!current || current.status === 'cancelled' || !isVideoPost(current)) return NextResponse.json({ error: 'Video non trovato' }, { status: 404 })
  // Reel gia' creato su Instagram e in elaborazione: si puo' solo togliere la programmazione o eliminare.
  if (current.status === 'scheduled' && current.results?.video?.container && action !== 'unschedule' && action !== 'delete') {
    return NextResponse.json({ error: 'Instagram sta elaborando il video: aspetta che esca, oppure togli la programmazione.', post: postView(current) }, { status: 409 })
  }
  try {
    const platforms = asPlatforms(body.platforms)
    if (action !== 'delete' && action !== 'unschedule' && (typeof body.caption === 'string' || platforms)) {
      await updatePost(access.db, id, { caption: body.caption, platforms })
    }
    let post: PostRow | null
    switch (action) {
      case 'save':
        post = await getPost(access.db, id)
        break
      case 'schedule':
        post = await schedulePost(access.db, id, new Date(String(body.publishAt || '')), platforms)
        break
      case 'unschedule':
        post = await cancelPost(access.db, id)
        break
      case 'publish':
        return published(await publishPost(access.db, id, { waitSeconds: 45 }))
      case 'delete':
        await deletePost(access.db, id)
        return NextResponse.json({ ok: true })
      default:
        return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
    }
    if (!post) return NextResponse.json({ error: 'Video non trovato' }, { status: 404 })
    return NextResponse.json({ post: postView(post) })
  } catch (error) {
    console.error(`saas video ${id.slice(0, 8)} (${action}): ${error instanceof Error ? error.message : error}`)
    const latest = await getPost(access.db, id).catch(() => null)
    const res = fail(error, 'Operazione non riuscita')
    if (!latest) return res
    const data = await res.json()
    return NextResponse.json({ ...data, post: postView(latest) }, { status: res.status })
  }
}

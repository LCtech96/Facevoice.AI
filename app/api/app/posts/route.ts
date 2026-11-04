import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { postView } from '@/lib/saas/assistant'
import { cancelPost, deletePost, getPost, listPosts, publishPost, schedulePost, updatePost, type PostPlatform } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Post dello spazio: elenco o un post (GET ?id=), e dai pulsanti dell'anteprima
// modifica, programma, annulla, pubblica ora, elimina (PATCH).

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const post = await getPost(access.db, id)
    return post ? NextResponse.json({ post: postView(post) }) : NextResponse.json({ error: 'Post non trovato' }, { status: 404 })
  }
  const posts = (await listPosts(access.db, { limit: 40 })).filter((p) => p.status !== 'cancelled')
  return NextResponse.json({ posts: posts.map(postView) })
}

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  const platforms = Array.isArray(body.platforms) ? (body.platforms.filter((p: unknown) => p === 'instagram' || p === 'facebook') as PostPlatform[]) : undefined
  try {
    if (typeof body.caption === 'string' || typeof body.facebook === 'string' || platforms) {
      await updatePost(access.db, id, { caption: body.caption, facebook: body.facebook, platforms })
    }
    let post
    switch (body.action) {
      case 'schedule':
        post = await schedulePost(access.db, id, new Date(String(body.publishAt || '')), platforms)
        break
      case 'unschedule':
        post = await cancelPost(access.db, id)
        break
      case 'publish':
        post = await publishPost(access.db, id)
        if (post.status !== 'published') return NextResponse.json({ error: post.error_message || 'Pubblicazione non riuscita', post: postView(post) }, { status: 502 })
        break
      case 'delete':
        await deletePost(access.db, id)
        return NextResponse.json({ ok: true })
      default:
        post = await getPost(access.db, id)
    }
    if (!post) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })
    return NextResponse.json({ post: postView(post) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Operazione non riuscita' }, { status: 400 })
  }
}

import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { forgetTikTokAccount, tiktokClientKey, verifyTikTokSignature } from '@/lib/tiktok'
import { advanceVideoPost, findVideoByTikTokPublish, noteTikTokPublic } from '@/lib/video-posts'
import { sendPushToAdmins } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Eventi di TikTok (firmati con TikTok-Signature): autorizzazione tolta, esito delle
// pubblicazioni. Si risponde subito 200 (TikTok riprova per 72 ore se non arriva) e il
// lavoro si fa dopo. Un evento senza firma valida si ignora (niente viene toccato).

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyTikTokSignature(req.headers.get('tiktok-signature'), raw)) {
    console.warn('webhook tiktok: firma assente o non valida, ignorato')
    return NextResponse.json({ received: true })
  }
  let event: { client_key?: string; event?: string; user_openid?: string; content?: string } | null = null
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ received: true })
  }
  if (!event?.event || (event.client_key && event.client_key !== tiktokClientKey())) return NextResponse.json({ received: true })
  let content: Record<string, unknown> = {}
  try {
    content = typeof event.content === 'string' ? JSON.parse(event.content) : {}
  } catch {}
  const kind = event.event
  const openId = String(event.user_openid || '')
  console.log(`webhook tiktok: ${kind}`)

  after(async () => {
    try {
      if (kind === 'authorization.removed') {
        if (openId && (await forgetTikTokAccount(openId))) {
          await supabaseAdmin.from('social_channels').update({ status: 'not_connected' }).eq('platform', 'tiktok')
          await sendPushToAdmins({ title: 'TikTok scollegato', body: 'L’account TikTok ha tolto l’autorizzazione: ricollegalo da Canali per pubblicare.', url: '/admin/overview', tag: 'tiktok-auth' }).catch(() => undefined)
        }
        return
      }
      if (kind.startsWith('post.publish.')) {
        const publishId = String(content.publish_id || '')
        const post = await findVideoByTikTokPublish(publishId)
        if (!post) return
        if (kind === 'post.publish.publicly_available' && content.post_id) await noteTikTokPublic(post.id, publishId, String(content.post_id))
        else if (post.status === 'publishing') await advanceVideoPost(post.id)
      }
    } catch (error) {
      console.error('webhook tiktok:', error instanceof Error ? error.message : error)
    }
  })
  return NextResponse.json({ received: true })
}

/** Controllo dell'indirizzo (pulsante «Test URL» del portale di TikTok). */
export async function GET() {
  return NextResponse.json({ ok: true })
}

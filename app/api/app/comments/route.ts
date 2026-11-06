import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { listConnections } from '@/lib/saas/connections'
import { commentModes, setCommentMode, type CommentMode, type CommentPlatform } from '@/lib/saas/comments'
import { campaignMarks } from '@/lib/saas/campaign'

export const dynamic = 'force-dynamic'

// Pagina Commenti: commenti ricevuti sotto i post (Instagram e Facebook) con le
// risposte pubblicate o in bozza, e la modalita' delle risposte per ogni canale.

type Row = {
  id: string
  platform: string
  direction: 'in' | 'out'
  contact_id: string
  contact_name: string | null
  body: string
  subject: string | null
  reply_to: string | null
  external_id: string | null
  status: string | null
  origin: string | null
  error_message: string | null
  read_at: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const [{ data, error }, modes, connections] = await Promise.all([
    access.db
      .from('social_messages')
      .select('id, platform, direction, contact_id, contact_name, body, subject, reply_to, external_id, status, origin, error_message, read_at, created_at')
      .eq('kind', 'comment')
      .order('created_at', { ascending: false })
      .limit(400),
    commentModes(access.workspace.id),
    listConnections(access.db).catch(() => []),
  ])
  if (error) return NextResponse.json({ error: 'Commenti non disponibili, riprova.' }, { status: 500 })

  const rows = (data || []) as Row[]
  // Risposte scritte con la Campagna (chip "Campagna").
  const marks = await campaignMarks(
    access.workspace.id,
    rows.filter((row) => row.direction === 'out' && String(row.origin || '').startsWith('ai')).map((row) => row.id)
  )
  const replies = new Map<string, Row[]>()
  for (const row of rows) {
    if (row.direction !== 'out' || !row.reply_to || row.status === 'rejected') continue
    replies.set(row.reply_to, [...(replies.get(row.reply_to) || []), row])
  }
  const comments = rows
    .filter((row) => row.direction === 'in')
    .slice(0, 150)
    .map((row) => ({
      id: row.id,
      platform: row.platform,
      author: row.contact_name,
      text: row.body,
      post: row.subject,
      postId: row.reply_to,
      skipped: row.status === 'skipped',
      unread: !row.read_at,
      at: row.created_at,
      replies: (replies.get(row.external_id || '') || [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((r) => ({ id: r.id, text: r.body, status: r.status, origin: r.origin, note: r.error_message, at: r.created_at, campaign: marks.get(r.id) ?? null })),
    }))

  // Aprendo la pagina i commenti diventano letti.
  if (comments.some((c) => c.unread)) {
    await access.db.from('social_messages').update({ read_at: new Date().toISOString() }).eq('kind', 'comment').eq('direction', 'in').is('read_at', null)
  }

  const active = connections.filter((c) => (c.platform === 'instagram' || c.platform === 'facebook') && c.status !== 'disconnected')
  const channels = (['instagram', 'facebook'] as CommentPlatform[])
    .filter((platform) => active.some((c) => c.platform === platform))
    .map((platform) => {
      const accounts = active.filter((c) => c.platform === platform)
      // Instagram collegato prima che chiedessimo il permesso dei commenti: va ricollegato.
      const needsReconnect = accounts.some((c) => {
        const meta = c.meta as { via?: string; permissions?: string[] }
        return meta.via === 'instagram_login' && !(meta.permissions || []).includes('instagram_business_manage_comments')
      })
      return { platform, mode: modes[platform], handle: accounts.map((c) => c.display_name || c.external_id).join(', '), needsReconnect }
    })
  return NextResponse.json({ channels, comments })
}

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const platform = String(body.platform || '') as CommentPlatform
  const mode = String(body.mode || '') as CommentMode
  if (!['instagram', 'facebook'].includes(platform) || !['off', 'approval', 'auto'].includes(mode)) {
    return NextResponse.json({ error: 'Valori non validi' }, { status: 400 })
  }
  try {
    await setCommentMode(access.workspace.id, platform, mode)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Modalità non salvata, riprova.' }, { status: 500 })
  }
}

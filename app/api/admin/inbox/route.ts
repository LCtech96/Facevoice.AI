import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['whatsapp', 'facebook', 'instagram']
const SCAN_LIMIT = 2000

type Row = {
  id: string
  platform: string
  kind: string
  contact_id: string
  contact_name: string | null
  direction: 'in' | 'out'
  body: string
  status: string | null
  read_at: string | null
  created_at: string
}

/** Elenco conversazioni (una per contatto e canale), dalla piu' recente. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const platform = params.get('platform')
  const query = params.get('q')?.trim().toLowerCase() || ''
  const onlyPending = params.get('filter') === 'pending'
  const onlyUnread = params.get('filter') === 'unread'

  const request = supabaseAdmin
    .from('social_messages')
    .select('id, platform, kind, contact_id, contact_name, direction, body, status, read_at, created_at')
    .in('platform', platform && PLATFORMS.includes(platform) ? [platform] : PLATFORMS)
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT)

  const { data, error } = await request
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const conversations = new Map<
    string,
    {
      platform: string
      contactId: string
      contactName: string | null
      lastMessage: string
      lastDirection: string
      lastStatus: string | null
      lastAt: string
      unread: number
      pending: number
      hasComments: boolean
      haystack: string
    }
  >()

  for (const row of (data || []) as Row[]) {
    const key = `${row.platform}:${row.contact_id}`
    let conv = conversations.get(key)
    if (!conv) {
      conv = {
        platform: row.platform,
        contactId: row.contact_id,
        contactName: row.contact_name,
        lastMessage: row.body,
        lastDirection: row.direction,
        lastStatus: row.status,
        lastAt: row.created_at,
        unread: 0,
        pending: 0,
        hasComments: false,
        haystack: '',
      }
      conversations.set(key, conv)
    }
    if (!conv.contactName && row.contact_name) conv.contactName = row.contact_name
    if (row.direction === 'in' && !row.read_at) conv.unread++
    if (row.status === 'pending') conv.pending++
    if (row.kind === 'comment') conv.hasComments = true
    if (query) conv.haystack += ` ${row.body.toLowerCase()}`
  }

  const list = Array.from(conversations.values())
    .filter((c) => !onlyPending || c.pending > 0)
    .filter((c) => !onlyUnread || c.unread > 0)
    .filter(
      (c) =>
        !query ||
        (c.contactName || '').toLowerCase().includes(query) ||
        c.contactId.includes(query) ||
        c.haystack.includes(query)
    )
    .map(({ haystack: _haystack, ...rest }) => rest)

  return NextResponse.json({
    conversations: list,
    totals: {
      pending: list.reduce((s, c) => s + c.pending, 0),
      unread: list.reduce((s, c) => s + c.unread, 0),
    },
  })
}

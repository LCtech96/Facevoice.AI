import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { loadIdentityMap } from '@/lib/meta/identities'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['whatsapp', 'facebook', 'instagram']
const SCAN_LIMIT = 3000

type Row = {
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

type Conversation = {
  key: string
  members: { platform: string; contactId: string; contactName: string | null }[]
  platforms: string[]
  contactName: string | null
  lastMessage: string
  lastDirection: string
  lastStatus: string | null
  lastPlatform: string
  lastAt: string
  unread: number
  pending: number
  hasComments: boolean
  linked: boolean
  suggestion?: { key: string; name: string; platforms: string[] }
}

const normalizeName = (name: string | null) =>
  (name || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9àèéìòù]+/g, ' ').trim()

/**
 * Elenco conversazioni dalla piu' recente. Gli account collegati alla stessa
 * persona (es. Instagram + Messenger) diventano un'unica conversazione.
 */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const platform = params.get('platform')
  const query = params.get('q')?.trim().toLowerCase() || ''
  const filter = params.get('filter')

  const [{ data, error }, identities] = await Promise.all([
    supabaseAdmin
      .from('social_messages')
      .select('platform, kind, contact_id, contact_name, direction, body, status, read_at, created_at')
      .in('platform', PLATFORMS)
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT),
    loadIdentityMap(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const conversations = new Map<string, Conversation & { haystack: string }>()

  for (const row of (data || []) as Row[]) {
    const person = identities.get(`${row.platform}:${row.contact_id}`)
    const key = person ? `person:${person}` : `${row.platform}:${row.contact_id}`

    let conv = conversations.get(key)
    if (!conv) {
      conv = {
        key,
        members: [],
        platforms: [],
        contactName: row.contact_name,
        lastMessage: row.body,
        lastDirection: row.direction,
        lastStatus: row.status,
        lastPlatform: row.platform,
        lastAt: row.created_at,
        unread: 0,
        pending: 0,
        hasComments: false,
        linked: Boolean(person),
        haystack: '',
      }
      conversations.set(key, conv)
    }

    const member = conv.members.find((m) => m.platform === row.platform && m.contactId === row.contact_id)
    if (!member) {
      conv.members.push({ platform: row.platform, contactId: row.contact_id, contactName: row.contact_name })
    } else if (!member.contactName && row.contact_name) {
      member.contactName = row.contact_name
    }
    if (!conv.platforms.includes(row.platform)) conv.platforms.push(row.platform)
    if (!conv.contactName && row.contact_name) conv.contactName = row.contact_name
    if (row.direction === 'in' && !row.read_at) conv.unread++
    if (row.status === 'pending') conv.pending++
    if (row.kind === 'comment') conv.hasComments = true
    if (query) conv.haystack += ` ${row.body.toLowerCase()}`
  }

  const all = Array.from(conversations.values())

  // Suggerimento: stesso nome su un altro canale, non ancora collegati.
  for (const conv of all) {
    const name = normalizeName(conv.contactName)
    if (name.length < 3) continue
    const match = all.find(
      (other) =>
        other.key !== conv.key &&
        normalizeName(other.contactName) === name &&
        !other.platforms.some((p) => conv.platforms.includes(p))
    )
    if (match) {
      conv.suggestion = { key: match.key, name: match.contactName || '', platforms: match.platforms }
    }
  }

  const list = all
    .filter((c) => !platform || !PLATFORMS.includes(platform) || c.platforms.includes(platform))
    .filter((c) => filter !== 'pending' || c.pending > 0)
    .filter((c) => filter !== 'unread' || c.unread > 0)
    .filter(
      (c) =>
        !query ||
        (c.contactName || '').toLowerCase().includes(query) ||
        c.members.some((m) => m.contactId.includes(query) || (m.contactName || '').toLowerCase().includes(query)) ||
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

import { mediaPreviewText } from '@/lib/wa-media-shared'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { loadIdentityMap, memberKey, type Member } from '@/lib/meta/identities'
import { loadAutoLinkInfo, loadSeparations, parseMemberKey, separatedBetween, type AutoLinkInfo } from '@/lib/meta/auto-link'
import { isHidden, loadHidden } from '@/lib/inbox-hidden'
import { loadVerificationSummaries, pickSummary, type VerificationSummary } from '@/lib/identity-verify'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['whatsapp', 'facebook', 'instagram', 'email', 'web']
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
  /** Possibile stessa persona: per nome o, con reason, per un dato certo non sufficiente a collegare da solo. */
  suggestion?: { key: string; name: string; platforms: string[]; reason?: string }
  /** Perche' alcuni account sono stati collegati in automatico (per Luca, con "Separa" per annullare). */
  autoLinks?: string[]
  /** Verifica dell'identita' (dice di conoscerci): in corso, riuscita o non riuscita. */
  verification?: VerificationSummary
}

const normalizeName = (name: string | null) =>
  (name || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9àèéìòù]+/g, ' ').trim()

/**
 * Elenco conversazioni dalla piu' recente. Gli account collegati alla stessa
 * persona (es. Instagram + Messenger) diventano un'unica conversazione.
 */
export async function GET(req: NextRequest) {
  const access = await guard(req, 'inbox', 'view')
  if (access instanceof NextResponse) return access

  const params = req.nextUrl.searchParams
  const platform = params.get('platform')
  // Conversazioni che hanno SOLO questo canale da togliere (es. le chat WhatsApp, che hanno la loro pagina).
  const exclude = params.get('exclude')
  const query = params.get('q')?.trim().toLowerCase() || ''
  const filter = params.get('filter')

  const [{ data, error }, identities, hidden] = await Promise.all([
    supabaseAdmin
      .from('social_messages')
      .select('platform, kind, contact_id, contact_name, direction, body, status, read_at, created_at')
      .in('platform', PLATFORMS)
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT),
    loadIdentityMap(),
    loadHidden(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const conversations = new Map<string, Conversation & { haystack: string }>()

  for (const row of (data || []) as Row[]) {
    // Conversazione eliminata dalla casella: contano solo i messaggi arrivati dopo.
    if (isHidden(hidden, row.platform, row.contact_id, row.created_at)) continue
    const person = identities.get(`${row.platform}:${row.contact_id}`)
    const key = person ? `person:${person}` : `${row.platform}:${row.contact_id}`

    let conv = conversations.get(key)
    if (!conv) {
      conv = {
        key,
        members: [],
        platforms: [],
        contactName: row.contact_name,
        lastMessage: mediaPreviewText(row.body),
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

  // Account collegati senza messaggi (es. l'email dell'archivio di una verifica): si vedono lo stesso, cosi' si possono separare.
  const byPerson = new Map<string, Member[]>()
  for (const [key, person] of identities) {
    const m = parseMemberKey(key)
    if (m) byPerson.set(person, [...(byPerson.get(person) || []), m])
  }
  for (const conv of conversations.values()) {
    if (!conv.key.startsWith('person:')) continue
    for (const m of byPerson.get(conv.key.slice('person:'.length)) || []) {
      if (!conv.members.some((x) => x.platform === m.platform && x.contactId === m.contactId)) conv.members.push({ ...m, contactName: null })
    }
  }

  const all = Array.from(conversations.values())
  const memberKeys = all.flatMap((c) => c.members.map((m) => memberKey(m)))
  // Solo le verifiche degli account in elenco (mai un sottoinsieme a caso di tutte quelle salvate).
  const [verifications, autoInfo, separations] = await Promise.all([
    loadVerificationSummaries(memberKeys).catch(() => new Map<string, VerificationSummary>()),
    loadAutoLinkInfo(memberKeys).catch(() => new Map<string, AutoLinkInfo>()),
    loadSeparations().catch(() => new Set<string>()),
  ])
  for (const conv of all) {
    const summary = pickSummary(conv.members.map((m) => verifications.get(`${m.platform}:${m.contactId}`)))
    if (summary) conv.verification = summary
  }

  const conversationOf = (key: string) => {
    const person = identities.get(key)
    return conversations.get(person ? `person:${person}` : key)
  }

  for (const conv of all) {
    const own = new Set(conv.members.map((m) => memberKey(m)))
    const infos = conv.members.map((m) => autoInfo.get(memberKey(m))).filter((i): i is AutoLinkInfo => Boolean(i))

    // Collegamenti automatici ancora in piedi (l'altro account e' ancora nella stessa conversazione).
    const details = [...new Set(infos.flatMap((i) => i.links.filter((n) => own.has(n.with)).map((n) => n.detail)))]
    if (details.length) conv.autoLinks = details

    // Suggerimento con un dato certo (non bastava a collegare da solo): prima di quello per nome.
    for (const hint of infos.flatMap((i) => i.hints)) {
      if (own.has(hint.with)) continue
      const other = conversationOf(hint.with)
      if (!other || other.key === conv.key) continue
      if (!hint.separated && separatedBetween(separations, conv.members, other.members)) continue
      conv.suggestion = { key: other.key, name: other.contactName || other.members[0]?.contactId || '', platforms: other.platforms, reason: hint.detail }
      break
    }
  }

  // Suggerimento: stesso nome su un altro canale, non ancora collegati (mai se Luca li aveva separati).
  for (const conv of all) {
    if (conv.suggestion) continue
    const name = normalizeName(conv.contactName)
    if (name.length < 3) continue
    const match = all.find(
      (other) =>
        other.key !== conv.key &&
        normalizeName(other.contactName) === name &&
        !other.platforms.some((p) => conv.platforms.includes(p)) &&
        !separatedBetween(separations, conv.members, other.members)
    )
    if (match) {
      conv.suggestion = { key: match.key, name: match.contactName || '', platforms: match.platforms }
    }
  }

  const list = all
    .filter((c) => !platform || !PLATFORMS.includes(platform) || c.platforms.includes(platform))
    .filter((c) => !exclude || !PLATFORMS.includes(exclude) || c.platforms.some((p) => p !== exclude))
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

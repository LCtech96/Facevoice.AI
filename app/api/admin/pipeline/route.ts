import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { loadCalls } from '@/lib/lead-calls'
import { isRunning, loadState } from '@/lib/assistant-state'
import { formatRome, listAppointments } from '@/lib/appointments'

export const dynamic = 'force-dynamic'

// Motore clienti: la pipeline vera, fase per fase. Ogni scheda sta nella fase
// piu' avanzata che ha raggiunto:
//   trovati (ricerca) → analizzati (sito letto) → contattati (email o telefonata)
//   → risposte (ha risposto) → clienti.
// Le intestazioni contano quante schede hanno raggiunto almeno quella fase.

const STAGES = ['found', 'research', 'outreach', 'replies', 'clients'] as const
type Stage = (typeof STAGES)[number]
const CARDS_PER_STAGE = 6
const PERIODS: Record<string, number | null> = { '7': 7, '30': 30, all: null }

type Row = {
  id: string
  name: string
  address: string | null
  search_query: string | null
  email: string | null
  phone: string | null
  status: string
  analyzed_at: string | null
  contacted_at: string | null
  created_at: string
}

/** Comune dall'indirizzo di Google ("Via Roma 1, 90044 Carini PA, Italia" → "Carini"). */
function townOf(address: string | null) {
  if (!address) return null
  const part = address.split(',').map((p) => p.trim()).find((p) => /^\d{5}\s/.test(p))
  return part ? part.replace(/^\d{5}\s+/, '').replace(/\s+[A-Z]{2}$/, '') : null
}

async function loadLeads(): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, name, address, search_query, email, phone, status, analyzed_at, contacted_at, created_at')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data || []) as Row[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

type FeedEvent = { id: string; at: string; kind: string; text: string; leadId?: string; platform?: string }

const PLATFORM_NAME: Record<string, string> = { instagram: 'Instagram', facebook: 'Messenger', whatsapp: 'WhatsApp', email: 'email', web: 'chat del sito' }
/** Finestra degli eventi mostrati nel flusso in tempo reale. */
const FEED_MS = 3 * 86_400_000
const FEED_MAX = 25

/** Messaggi (ricevuti e inviati) degli ultimi giorni: solo chi e quando, mai il testo. */
async function recentMessages() {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('id, platform, kind, direction, status, contact_id, contact_name, created_at')
    .gte('created_at', new Date(Date.now() - FEED_MS).toISOString())
    .in('status', ['sent', 'received'])
    .order('created_at', { ascending: false })
    .limit(60)
  const { data: incoming } = await supabaseAdmin
    .from('social_messages')
    .select('id, platform, kind, direction, status, contact_id, contact_name, created_at')
    .gte('created_at', new Date(Date.now() - FEED_MS).toISOString())
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(60)
  const all = new Map<string, any>()
  for (const m of [...(data || []), ...(incoming || [])]) all.set(m.id, m)
  return [...all.values()]
}

/** Prima risposta email ricevuta da ogni indirizzo. */
async function firstReplies(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('contact_id, created_at')
    .eq('platform', 'email')
    .eq('direction', 'in')
    .order('created_at', { ascending: true })
    .limit(10_000)
  const map = new Map<string, string>()
  for (const m of data || []) {
    const key = String(m.contact_id || '').toLowerCase()
    if (key && !map.has(key)) map.set(key, m.created_at)
  }
  return map
}

export async function GET(req: NextRequest) {
  const access = await guard(req, 'leads', 'view')
  if (access instanceof NextResponse) return access

  const days = PERIODS[req.nextUrl.searchParams.get('period') || '7'] ?? null
  const since = days ? Date.now() - days * 86_400_000 : 0
  const inPeriod = (date: string | null | undefined) => Boolean(date) && new Date(date!).getTime() >= since

  try {
    const [leads, calls, replies, superState, leadsState, messages, appointments] = await Promise.all([
      loadLeads(),
      loadCalls().catch(() => ({}) as Record<string, string>),
      firstReplies().catch(() => new Map<string, string>()),
      loadState('super').catch(() => null),
      loadState('leads').catch(() => null),
      recentMessages().catch(() => [] as any[]),
      listAppointments().catch(() => []),
    ])

    const reached = { found: 0, research: 0, outreach: 0, replies: 0, clients: 0 } as Record<Stage, number>
    const recent = { found: 0, research: 0, outreach: 0, replies: 0, clients: 0 } as Record<Stage, number>
    const cards: Record<Stage, { id: string; name: string; place: string | null; at: string; via?: 'email' | 'phone'; email: boolean }[]> = {
      found: [],
      research: [],
      outreach: [],
      replies: [],
      clients: [],
    }
    let discarded = 0

    for (const lead of leads) {
      const calledAt = calls[lead.id] || null
      const repliedAt = (lead.email && replies.get(lead.email.toLowerCase())) || null
      const contactedAt = [lead.contacted_at, calledAt].filter(Boolean).sort()[0] || null
      const rank =
        lead.status === 'client'
          ? 4
          : lead.status === 'replied' || repliedAt
          ? 3
          : contactedAt || lead.status === 'contacted' || lead.status === 'no_answer'
          ? 2
          : lead.analyzed_at
          ? 1
          : 0
      STAGES.forEach((stage, i) => {
        if (rank >= i) reached[stage]++
      })
      if (inPeriod(lead.created_at)) recent.found++
      if (inPeriod(lead.analyzed_at)) recent.research++
      if (inPeriod(contactedAt)) recent.outreach++
      if (inPeriod(repliedAt)) recent.replies++

      // Le schede scartate contano nei numeri ma non occupano le colonne.
      if (lead.status === 'discarded' || lead.status === 'do_not_contact') {
        discarded++
        continue
      }
      const stage = STAGES[rank]
      // Data in cui la scheda e' entrata nella fase (le piu' recenti in alto).
      const at = (rank >= 3 ? repliedAt || contactedAt : rank === 2 ? contactedAt : rank === 1 ? lead.analyzed_at : null) || lead.created_at
      cards[stage].push({
        id: lead.id,
        name: lead.name,
        place: townOf(lead.address) || lead.search_query,
        at,
        via: stage === 'outreach' ? (lead.contacted_at ? 'email' : calledAt ? 'phone' : undefined) : undefined,
        email: Boolean(lead.email),
      })
    }

    for (const stage of STAGES) {
      cards[stage].sort((a, b) => b.at.localeCompare(a.at))
      cards[stage] = cards[stage].slice(0, CARDS_PER_STAGE)
    }

    // Flusso in tempo reale: cosa e' successo negli ultimi giorni, dal piu' recente.
    const feedSince = Date.now() - FEED_MS
    const recentAt = (date: string | null | undefined) => Boolean(date) && new Date(date!).getTime() >= feedSince
    const byEmail = new Map(leads.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]))
    const events: FeedEvent[] = []
    for (const lead of leads) {
      if (recentAt(lead.created_at)) events.push({ id: `f${lead.id}`, at: lead.created_at, kind: 'found', text: `Trovata: ${lead.name}`, leadId: lead.id })
      if (recentAt(lead.analyzed_at))
        events.push({ id: `a${lead.id}`, at: lead.analyzed_at!, kind: 'research', text: `Sito letto: ${lead.name}${lead.email ? ' · email trovata' : ''}`, leadId: lead.id })
      if (recentAt(lead.contacted_at)) events.push({ id: `c${lead.id}`, at: lead.contacted_at!, kind: 'outreach', text: `Email inviata a ${lead.name}`, leadId: lead.id })
      if (recentAt(calls[lead.id])) events.push({ id: `p${lead.id}`, at: calls[lead.id], kind: 'outreach', text: `Chiamata segnata: ${lead.name}`, leadId: lead.id })
    }
    for (const m of messages) {
      const lead = m.platform === 'email' ? byEmail.get(String(m.contact_id).toLowerCase()) : undefined
      const who = lead?.name || m.contact_name || 'un contatto'
      const where = PLATFORM_NAME[m.platform] || m.platform
      const text =
        m.direction === 'in'
          ? lead
            ? `${who} ha risposto alla tua email`
            : m.kind === 'comment'
            ? `Nuovo commento di ${who} su ${where}`
            : `Nuovo messaggio di ${who} su ${where}`
          : m.kind === 'comment'
          ? `Risposta pubblica a ${who} su ${where}`
          : `Risposta inviata a ${who} su ${where}`
      events.push({ id: `m${m.id}`, at: m.created_at, kind: m.direction === 'in' ? 'replies' : 'answer', text, leadId: lead?.id, platform: m.platform })
    }
    for (const a of appointments) {
      if (a.status === 'confirmed' && recentAt(a.createdAt))
        events.push({ id: `t${a.id}`, at: a.createdAt, kind: 'meeting', text: `Appuntamento con ${a.contactName || 'un contatto'}: ${formatRome(a.when)}`, leadId: a.leadId || undefined })
    }
    events.sort((a, b) => b.at.localeCompare(a.at))

    const running = [superState, leadsState].map((s) => s?.job).find((job) => isRunning(job ?? null))
    return NextResponse.json({
      period: days ? String(days) : 'all',
      stages: STAGES.map((id) => ({ id, reached: reached[id], recent: days ? recent[id] : null })),
      cards,
      hero: {
        replies: days ? recent.replies : reached.replies,
        contacted: days ? recent.outreach : reached.outreach,
        clients: reached.clients,
        replyRate: reached.outreach ? Math.round((reached.replies / reached.outreach) * 100) : 0,
      },
      discarded,
      events: events.slice(0, FEED_MAX),
      running: running ? { text: running.statusText || 'Al lavoro…' } : null,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Errore' }, { status: 500 })
  }
}

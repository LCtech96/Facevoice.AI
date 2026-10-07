import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { LEAD_STATUSES, MAX_RESULTS, SYSTEM_EMAIL, placesKey, searchPlaces } from '@/lib/leads'
import { syncLeadStatuses } from '@/lib/lead-status'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Elenco lead: ?status=new|...|all, ?q=testo. Prima i punteggi piu' alti. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const params = req.nextUrl.searchParams
  const status = params.get('status') || 'all'
  const q = params.get('q')?.trim()

  // Stati allineati alla conversazione vera prima di rispondere.
  await syncLeadStatuses().catch((error) => console.error('lead status sync:', error))

  let query = supabaseAdmin.from('leads').select('*')
  if (status !== 'all' && (LEAD_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status)
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ')
    query = query.or(`name.ilike.%${safe}%,search_query.ilike.%${safe}%,address.ilike.%${safe}%`)
  }
  const { data, error } = await query
    .order('score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Email del servizio che ospita il sito (abuse@, altervista…) salvate in passato: si tolgono.
  const wrong = (data || []).filter((l) => l.email && SYSTEM_EMAIL.test(l.email))
  if (wrong.length) {
    await supabaseAdmin.from('leads').update({ email: null }).in('id', wrong.map((l) => l.id))
    for (const l of wrong) l.email = null
  }

  return NextResponse.json({ leads: data || [], configured: Boolean(placesKey()) })
}

/** Nuova ricerca su Google Maps. body: { query, max } */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const query = String(body?.query || '').trim().slice(0, 200)
  if (query.length < 3) return NextResponse.json({ error: 'Scrivi cosa cercare, es. "ristoranti Catania"' }, { status: 400 })
  const max = Math.max(1, Math.min(MAX_RESULTS, Number(body?.max) || 20))
  try {
    return NextResponse.json(await searchPlaces(query, max))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ricerca non riuscita' }, { status: 502 })
  }
}

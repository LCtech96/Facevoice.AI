import { NextRequest, NextResponse, after } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { asModelChoice } from '@/lib/ai'
import { asScope, isRunning, loadState, newId, runJob, updateState, type Scope, type Turn } from '@/lib/assistant-state'

export const dynamic = 'force-dynamic'
// Il lavoro continua dopo la risposta (after): serve il tempo massimo.
export const maxDuration = 300

const internalKey = () => (process.env.CRON_SECRET || '').trim()

async function authorized(req: NextRequest) {
  const key = internalKey()
  if (key && req.headers.get('x-internal-key') === key) return true
  return Boolean(await getAdminEmail(req))
}

/** Avvia un lavoro e lo esegue dopo aver risposto: prosegue anche se la pagina si chiude. */
function startJob(req: NextRequest, scope: Scope, message: string, original: string, round: number) {
  const origin = req.nextUrl.origin
  const continueJob = async (orig: string, nextRound: number) => {
    const key = internalKey()
    if (!key) throw new Error('CRON_SECRET mancante: niente continuazione automatica')
    const res = await fetch(`${origin}/api/admin/leads/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({ scope, continueOriginal: orig, round: nextRound }),
    })
    if (!res.ok) throw new Error(`continuazione rifiutata: ${res.status}`)
  }
  return { run: (jobId: string) => runJob(scope, jobId, message, continueJob), original, round }
}

/** Stato della conversazione: ?scope=leads|super */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const state = await loadState(asScope(req.nextUrl.searchParams.get('scope')))
  return NextResponse.json({ ...state, running: isRunning(state.job) })
}

/**
 * Nuova richiesta. body: { scope, message }
 * Continuazione interna: { scope, continueOriginal, round } con x-internal-key.
 */
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const scope = asScope(body?.scope)
  const continuing = typeof body?.continueOriginal === 'string' && req.headers.get('x-internal-key') === internalKey()

  const original = String(continuing ? body.continueOriginal : body?.message || '').trim().slice(0, 2000)
  if (!original) return NextResponse.json({ error: 'Scrivi cosa vuoi fare' }, { status: 400 })
  const round = continuing ? Math.max(1, Number(body.round) || 1) : 0
  const message = continuing ? `Continua il lavoro richiesto prima (“${original}”) con quello che resta.` : original

  const current = await loadState(scope)
  if (!continuing && isRunning(current.job)) {
    return NextResponse.json({ error: 'Sto ancora lavorando alla richiesta precedente: aspetta che finisca.' }, { status: 409 })
  }

  const jobId = newId()
  const now = new Date().toISOString()
  const state = await updateState(scope, (s) => {
    if (!continuing) s.turns.push({ id: newId(), role: 'user', text: original })
    const previous = s.job
    s.job = {
      id: jobId,
      status: 'running',
      statusText: continuing ? 'Continuo con il resto…' : 'Ci penso…',
      startedAt: continuing && previous ? previous.startedAt : now,
      updatedAt: now,
      original,
      round,
      // La continuazione tiene modello e conteggio della richiesta originale.
      model: continuing ? previous?.model : asModelChoice(body?.model),
      usage: continuing ? previous?.usage : undefined,
    }
  })

  const job = startJob(req, scope, message, original, round)
  after(() => job.run(jobId))
  return NextResponse.json({ ...state, running: true })
}

/**
 * Modifiche dalla pagina. body: { scope, drafts?, appendTurns?, updateTurn?: { id, actions }, handled?: jobId, clearTurns? }
 */
export async function PUT(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const scope = asScope(body?.scope)
  const state = await updateState(scope, (s) => {
    if (Array.isArray(body?.drafts)) s.drafts = body.drafts.filter((d: { leadId?: unknown }) => typeof d?.leadId === 'string').slice(0, 80)
    if (Array.isArray(body?.appendTurns)) {
      for (const t of body.appendTurns as Turn[]) {
        if ((t?.role === 'user' || t?.role === 'assistant') && typeof t?.text === 'string') s.turns.push({ id: newId(), role: t.role, text: t.text.slice(0, 4000) })
      }
    }
    if (body?.updateTurn?.id) {
      const turn = s.turns.find((t) => t.id === body.updateTurn.id)
      if (turn && Array.isArray(body.updateTurn.actions)) turn.actions = body.updateTurn.actions
    }
    if (body?.handled && s.job && s.job.id === body.handled) s.job.handled = true
    if (body?.clearTurns && !isRunning(s.job)) {
      s.turns = []
      s.job = null
    }
  })
  return NextResponse.json({ ...state, running: isRunning(state.job) })
}

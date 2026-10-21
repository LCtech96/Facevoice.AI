import { supabaseAdmin } from '@/lib/supabase-admin'
import { emptyTally, runWithStatus, type AIModelChoice, type UsageTally } from '@/lib/ai'
import { runAssistant, type Draft, type SocialAction } from '@/lib/lead-assistant'
import { overBudget, type Budget } from '@/lib/assistant-budget'

// Conversazioni dell'assistente salvate sul server (una per pagina: "leads" e
// "super"). Ogni richiesta diventa un lavoro che prosegue anche se la pagina
// viene chiusa: lo stato (avanzamento, risposta, bozze) si legge da qui.

export const SCOPES = ['leads', 'super'] as const
export type Scope = (typeof SCOPES)[number]

/** job: lavoro che ha scritto la risposta (per non contare due volte i token di un lavoro in corso). */
export type Turn = { id: string; role: 'user' | 'assistant'; text: string; actions?: SocialAction[]; usage?: UsageTally; job?: string }

export type Job = {
  id: string
  status: 'running' | 'done' | 'error'
  statusText: string
  startedAt: string
  updatedAt: string
  /** Richiesta originale di Luca (per le continuazioni automatiche). */
  original: string
  round: number
  result?: { refresh?: boolean; confirmSend?: boolean; focus?: { label: string; ids: string[] } }
  /** La pagina ha gia' gestito conferma invio / filtro di questo lavoro. */
  handled?: boolean
  /** Modello scelto per questa richiesta. */
  model?: AIModelChoice
  /** Token e costi usati finora da questa richiesta (si aggiorna mentre lavora). */
  usage?: UsageTally
  /** Limite di spesa scritto da Luca nella richiesta. */
  budget?: Budget | null
}

export type AssistantState = { turns: Turn[]; drafts: Draft[]; job: Job | null }

const MAX_TURNS = 80
/** Oltre questo tempo senza aggiornamenti un lavoro "in corso" e' considerato interrotto. */
export const STALE_MS = 6 * 60_000
const WORK_BUDGET_MS = 210_000
/** Oltre questo tempo si risponde comunque, prima che Vercel chiuda la funzione (maxDuration 300 s). */
const HARD_STOP_MS = 270_000
const MAX_ROUNDS = 5

const keyOf = (scope: Scope) => `assistant_state:${scope}`
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clean = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\s+/gm, '- ')

export function asScope(value: unknown): Scope {
  return (SCOPES as readonly string[]).includes(String(value)) ? (value as Scope) : 'leads'
}

export async function loadState(scope: Scope): Promise<AssistantState> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', keyOf(scope)).maybeSingle()
  try {
    const parsed = data?.value ? JSON.parse(data.value) : null
    return { turns: parsed?.turns || [], drafts: parsed?.drafts || [], job: parsed?.job || null }
  } catch {
    return { turns: [], drafts: [], job: null }
  }
}

export async function saveState(scope: Scope, state: AssistantState) {
  const value = JSON.stringify({ ...state, turns: state.turns.slice(-MAX_TURNS) })
  await supabaseAdmin.from('app_settings').upsert({ key: keyOf(scope), value, updated_at: new Date().toISOString() })
}

/** Legge, modifica e salva (le scritture sono brevi: il rischio di sovrapposizione e' minimo). */
export async function updateState(scope: Scope, fn: (state: AssistantState) => void): Promise<AssistantState> {
  const state = await loadState(scope)
  fn(state)
  await saveState(scope, state)
  return state
}

export const isRunning = (job: Job | null) =>
  Boolean(job && job.status === 'running' && Date.now() - new Date(job.updatedAt).getTime() < STALE_MS)

const sumUsage = (turns: Turn[]) => turns.reduce((sum, t) => (t.usage ? addTally(sum, t.usage) : sum), emptyTally())

function minusTally(a: UsageTally, b: UsageTally): UsageTally {
  return {
    calls: Math.max(0, a.calls - b.calls),
    input: Math.max(0, a.input - b.input),
    output: Math.max(0, a.output - b.output),
    cost: Math.max(0, a.cost - b.cost),
    models: { ...a.models },
  }
}

/**
 * Lavoro rimasto "in corso" ma fermo da troppo (il server l'ha interrotto):
 * lo chiude con un messaggio e conserva i token spesi, invece di farlo sparire.
 */
export async function recoverStaleJob(scope: Scope, state: AssistantState): Promise<AssistantState> {
  const job = state.job
  if (!job || job.status !== 'running' || isRunning(job)) return state
  return updateState(scope, (s) => {
    if (!s.job || s.job.id !== job.id || s.job.status !== 'running' || isRunning(s.job)) return
    const lost = minusTally(s.job.usage || emptyTally(), sumUsage(s.turns.filter((t) => t.job === job.id)))
    s.turns.push({
      id: newId(),
      role: 'assistant',
      job: job.id,
      text: 'Mi sono interrotto prima di finire: il lavoro ha richiesto troppo tempo. Scrivimi "continua" e riprendo da dove sono rimasto, oppure chiedimi una cosa più piccola.',
      usage: lost.calls ? lost : undefined,
    })
    s.job.status = 'error'
    s.job.updatedAt = new Date().toISOString()
  })
}

/**
 * Esegue il lavoro (chiamato dentro after(): prosegue anche a pagina chiusa).
 * Se il tempo finisce prima del termine, chiama `continueJob` per un nuovo giro.
 */
function addTally(a: UsageTally, b: UsageTally): UsageTally {
  const models = { ...a.models }
  for (const [m, n] of Object.entries(b.models)) models[m] = (models[m] || 0) + n
  return { calls: a.calls + b.calls, input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost, models }
}

export async function runJob(scope: Scope, jobId: string, message: string, continueJob: (original: string, round: number) => Promise<void>) {
  let lastWrite = 0
  let pendingText = ''
  const writeStatus = async (text: string) => {
    pendingText = text
    if (Date.now() - lastWrite < 1500) return
    lastWrite = Date.now()
    await updateState(scope, (s) => {
      if (s.job?.id !== jobId) return
      s.job.statusText = pendingText
      s.job.usage = total()
      s.job.updatedAt = new Date().toISOString()
    }).catch(() => undefined)
  }

  const start = await loadState(scope)
  const history = start.turns.slice(-9, -1).map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }))
  const job = start.job
  // Token di questo giro; il totale della richiesta somma anche i giri precedenti.
  const tally: UsageTally = emptyTally()
  const base: UsageTally = job?.usage && (job.round ?? 0) > 0 ? job.usage : emptyTally()
  const total = () => addTally(base, tally)

  const budget = job?.budget ?? null
  let seen = total()
  let lastStep: UsageTally | undefined
  let timedOut = false
  try {
    const work = runWithStatus(
      {
        status: (text) => void writeStatus(text),
        deadline: Date.now() + WORK_BUDGET_MS,
        model: job?.model,
        usage: tally,
        onUsage: () => {
          // Costo dell'ultima chiamata: serve a prevedere se la prossima sta nel limite.
          const now = total()
          lastStep = { calls: 1, input: now.input - seen.input, output: now.output - seen.output, cost: now.cost - seen.cost, models: {} }
          seen = now
          void writeStatus(pendingText || job?.statusText || '')
        },
        overBudget: () => overBudget(budget, total(), lastStep),
      },
      () => runAssistant(message, history, start.drafts, budget)
    )
    // Prima che il server chiuda la funzione (300 s) si salva comunque una risposta.
    const result = await Promise.race([
      work,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), HARD_STOP_MS)),
    ])
    if (!result) {
      timedOut = true
      await updateState(scope, (s) => {
        if (s.job?.id !== jobId) return
        s.turns.push({
          id: newId(),
          role: 'assistant',
          job: jobId,
          text: 'Questo passo ha richiesto troppo tempo e mi sono fermato prima di finire. Scrivimi "continua" e riprendo, oppure chiedimi una cosa più piccola.',
          usage: { ...tally, models: { ...tally.models } },
        })
        s.job.status = 'done'
        s.job.statusText = ''
        s.job.usage = total()
        s.job.updatedAt = new Date().toISOString()
      })
      return
    }
    const again = Boolean(result.more) && (job?.round ?? 0) < MAX_ROUNDS && !overBudget(budget, total())
    await updateState(scope, (s) => {
      const drafts = new Map(s.drafts.map((d) => [d.leadId, d]))
      for (const id of result.removeDrafts || []) drafts.delete(id)
      for (const d of result.drafts || []) drafts.set(d.leadId, d)
      s.drafts = [...drafts.values()]
      s.turns.push({
        id: newId(),
        role: 'assistant',
        job: jobId,
        text: clean(result.reply || ''),
        actions: result.actions?.length ? result.actions : undefined,
        usage: { ...tally, models: { ...tally.models } },
      })
      if (s.job?.id === jobId) {
        s.job.status = again ? 'running' : 'done'
        s.job.statusText = again ? 'Continuo con il resto…' : ''
        s.job.updatedAt = new Date().toISOString()
        s.job.usage = total()
        s.job.result = { refresh: result.refresh, confirmSend: result.confirmSend, focus: result.focus }
      }
    })
    if (again) {
      const ok = await continueJob(job?.original || message, (job?.round ?? 0) + 1).then(
        () => true,
        () => false
      )
      if (!ok) {
        await updateState(scope, (s) => {
          s.turns.push({ id: newId(), role: 'assistant', text: 'Mi sono fermato a metà: scrivimi "continua" e riprendo da dove sono rimasto.' })
          if (s.job?.id === jobId) s.job.status = 'done'
        })
      }
    }
  } catch (error) {
    if (timedOut) return
    await updateState(scope, (s) => {
      s.turns.push({
        id: newId(),
        role: 'assistant',
        job: jobId,
        text: error instanceof Error ? error.message : 'Qualcosa è andato storto, riprova.',
        usage: tally.calls ? { ...tally, models: { ...tally.models } } : undefined,
      })
      if (s.job?.id === jobId) {
        s.job.status = 'error'
        s.job.updatedAt = new Date().toISOString()
      }
    }).catch(() => undefined)
  }
}

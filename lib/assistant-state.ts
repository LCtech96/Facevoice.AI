import { readSetting, updateSetting } from '@/lib/settings-store'
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
  /** Giro in esecuzione: i giri vecchi (fermati per tempo) non possono piu' scrivere. */
  run?: string
  /** Passi gia' fatti (strumenti usati e risultato in breve): chi riprende non li rifa'. */
  steps?: string[]
}

export type AssistantState = { turns: Turn[]; drafts: Draft[]; job: Job | null }

const MAX_TURNS = 80
/**
 * Oltre questo tempo senza aggiornamenti un lavoro "in corso" e' fermo: la
 * funzione che lo eseguiva (al massimo 300 s) e' stata chiusa dal server.
 */
export const STALE_MS = 330_000
const WORK_BUDGET_MS = 210_000
/** Oltre questo tempo si passa a un nuovo giro, prima che Vercel chiuda la funzione (maxDuration 300 s). */
const HARD_STOP_MS = 270_000
/** Giri massimi per una richiesta (circa 4 minuti l'uno), poi si chiede a Luca se continuare. */
export const MAX_ROUNDS = 8
const MAX_STEPS_SAVED = 40

const keyOf = (scope: Scope) => `assistant_state:${scope}`
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clean = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\s+/gm, '- ')

export function asScope(value: unknown): Scope {
  return (SCOPES as readonly string[]).includes(String(value)) ? (value as Scope) : 'leads'
}

function parseState(value: string | null | undefined): AssistantState {
  try {
    const parsed = value ? JSON.parse(value) : null
    return { turns: parsed?.turns || [], drafts: parsed?.drafts || [], job: parsed?.job || null }
  } catch {
    return { turns: [], drafts: [], job: null }
  }
}

export async function loadState(scope: Scope): Promise<AssistantState> {
  return parseState((await readSetting(keyOf(scope))).value)
}

/**
 * Legge, modifica e salva solo se nel frattempo nessun altro ha salvato.
 * Prima un salvataggio di stato lento poteva sovrascrivere la risposta finale:
 * il lavoro sembrava ancora in corso e dopo qualche minuto risultava "interrotto".
 * fn puo' restituire false per non salvare niente.
 */
function casUpdate(scope: Scope, fn: (state: AssistantState) => void | boolean): Promise<AssistantState> {
  return updateSetting(keyOf(scope), parseState, (state) => {
    if (fn(state) === false) return false
    return { ...state, turns: state.turns.slice(-MAX_TURNS) }
  })
}

// Nello stesso server le scritture di una chat passano una alla volta.
const queues = new Map<Scope, Promise<unknown>>()

export function updateState(scope: Scope, fn: (state: AssistantState) => void | boolean): Promise<AssistantState> {
  const run = () => casUpdate(scope, fn)
  const result = (queues.get(scope) || Promise.resolve()).then(run, run)
  queues.set(scope, result.catch(() => undefined))
  return result
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

/** Il lavoro puo' fare un altro giro: restano giri e (se c'e') limite di spesa. */
export const canContinue = (job: Job | null | undefined) =>
  Boolean(job) && (job!.round ?? 0) < MAX_ROUNDS && !overBudget(job!.budget ?? null, job!.usage || emptyTally())

/** Messaggio con cui un nuovo giro riprende la richiesta. */
export const continuationMessage = (original: string) =>
  `Continua il lavoro richiesto prima (“${original}”) con quello che resta: i passi già fatti sono elencati sopra, non rifarli.`

/** Lavoro "in corso" ma fermo da troppo: va ripreso o chiuso. */
export const isStale = (job: Job | null) => Boolean(job && job.status === 'running' && !isRunning(job))

/**
 * Lavoro rimasto "in corso" ma fermo da troppo, che non puo' ripartire da solo:
 * lo chiude con un messaggio e conserva i token spesi, invece di farlo sparire.
 */
export async function recoverStaleJob(scope: Scope, state: AssistantState): Promise<AssistantState> {
  const job = state.job
  if (!job || !isStale(job)) return state
  return updateState(scope, (s) => {
    if (!s.job || s.job.id !== job.id || !isStale(s.job)) return false
    const lost = minusTally(s.job.usage || emptyTally(), sumUsage(s.turns.filter((t) => t.job === job.id)))
    s.turns.push({
      id: newId(),
      role: 'assistant',
      job: job.id,
      text: 'Mi sono fermato prima di finire. Scrivimi "continua" e riprendo da dove sono rimasto: i passi già fatti non li rifaccio.',
      usage: lost.calls ? lost : undefined,
    })
    s.job.status = 'error'
    s.job.updatedAt = new Date().toISOString()
  })
}

function addTally(a: UsageTally, b: UsageTally): UsageTally {
  const models = { ...a.models }
  for (const [m, n] of Object.entries(b.models)) models[m] = (models[m] || 0) + n
  return { calls: a.calls + b.calls, input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost, models }
}

/**
 * Esegue un giro del lavoro (chiamato dentro after(): prosegue anche a pagina chiusa).
 * Se il tempo del giro finisce prima del termine, chiama `continueJob` per il giro
 * successivo: la richiesta prosegue da sola fino alla fine (o al limite di spesa).
 */
export async function runJob(scope: Scope, jobId: string, message: string, continueJob: (round: number) => Promise<void>) {
  const start = await loadState(scope)
  const job = start.job
  if (!job || job.id !== jobId) return
  const runId = job.run
  const mine = (s: AssistantState) => s.job?.id === jobId && s.job.run === runId

  const history = start.turns.slice(-9, -1).map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }))
  // Token di questo giro; il totale della richiesta somma anche i giri precedenti.
  const tally: UsageTally = emptyTally()
  const base: UsageTally = job.usage && (job.round ?? 0) > 0 ? job.usage : emptyTally()
  const total = () => addTally(base, tally)
  const steps = [...(job.steps || [])]
  const budget = job.budget ?? null
  const round = job.round ?? 0

  let lastWrite = 0
  let pendingText = ''
  let stopped = false
  const writeStatus = async (text?: string, force = false) => {
    if (text !== undefined) pendingText = text
    if (stopped || (!force && Date.now() - lastWrite < 1500)) return
    lastWrite = Date.now()
    await updateState(scope, (s) => {
      if (!mine(s) || s.job!.status !== 'running') return false
      s.job!.statusText = pendingText || s.job!.statusText
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.updatedAt = new Date().toISOString()
    }).catch(() => undefined)
  }

  /** Passa al giro successivo (nuova funzione, tempo pieno). false = non si puo'. */
  const nextRound = async (statusText: string) => {
    if (round >= MAX_ROUNDS || overBudget(budget, total())) return false
    await updateState(scope, (s) => {
      if (!mine(s)) return false
      s.job!.status = 'running'
      s.job!.statusText = statusText
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.updatedAt = new Date().toISOString()
    })
    return continueJob(round + 1).then(
      () => true,
      () => false
    )
  }

  /** Risposta finale: i token non ancora scritti in nessuna risposta di questa richiesta finiscono qui. */
  const reply = (s: AssistantState, text: string, actions?: SocialAction[]) => {
    const unwritten = minusTally(total(), sumUsage(s.turns.filter((t) => t.job === jobId)))
    s.turns.push({ id: newId(), role: 'assistant', job: jobId, text, actions, usage: unwritten.calls ? unwritten : undefined })
  }

  let seen = total()
  let lastStep: UsageTally | undefined
  // Oggetto condiviso con il lavoro: azzerando la scadenza il giro si ferma al passo successivo.
  const timing = { deadline: Date.now() + WORK_BUDGET_MS }
  try {
    const work = runWithStatus(
      {
        status: (text) => void writeStatus(text),
        get deadline() {
          return timing.deadline
        },
        model: job.model,
        usage: tally,
        onUsage: () => {
          // Costo dell'ultima chiamata: serve a prevedere se la prossima sta nel limite.
          const now = total()
          lastStep = { calls: 1, input: now.input - seen.input, output: now.output - seen.output, cost: now.cost - seen.cost, models: {} }
          seen = now
          void writeStatus()
        },
        overBudget: () => overBudget(budget, total(), lastStep),
      },
      () =>
        runAssistant(message, history, start.drafts, budget, {
          done: job.steps,
          onStep: (line) => {
            steps.push(line)
            void writeStatus(undefined, true)
          },
        })
    )
    // Prima che il server chiuda la funzione (300 s) si passa a un nuovo giro.
    const result = await Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), HARD_STOP_MS))])
    if (!result) {
      stopped = true
      // Il giro vecchio non deve lavorare in parallelo a quello nuovo.
      timing.deadline = 1
      const ok = await nextRound('Ci sto mettendo più del previsto: continuo…').catch(() => false)
      if (!ok) {
        await updateState(scope, (s) => {
          if (!mine(s)) return false
          reply(s, 'Questo lavoro sta richiedendo molto tempo e mi sono fermato. Scrivimi "continua" e riprendo da dove sono rimasto: i passi già fatti non li rifaccio.')
          s.job!.status = 'done'
          s.job!.statusText = ''
          s.job!.usage = total()
          s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
          s.job!.updatedAt = new Date().toISOString()
        })
      }
      return
    }
    stopped = true
    const again = Boolean(result.more) && round < MAX_ROUNDS && !overBudget(budget, total())
    await updateState(scope, (s) => {
      if (!mine(s)) return false
      const drafts = new Map(s.drafts.map((d) => [d.leadId, d]))
      for (const id of result.removeDrafts || []) drafts.delete(id)
      for (const d of result.drafts || []) drafts.set(d.leadId, d)
      s.drafts = [...drafts.values()]
      // Giro intermedio: niente messaggio in chat (solo lo stato), salvo azioni da confermare.
      if (!again || result.actions?.length) reply(s, clean(result.reply || ''), result.actions?.length ? result.actions : undefined)
      s.job!.status = again ? 'running' : 'done'
      s.job!.statusText = again ? clean(result.reply || '') || 'Continuo con il resto…' : ''
      s.job!.updatedAt = new Date().toISOString()
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.result = { refresh: result.refresh, confirmSend: result.confirmSend, focus: result.focus }
    })
    if (again) {
      const ok = await continueJob(round + 1).then(
        () => true,
        () => false
      )
      if (!ok) {
        await updateState(scope, (s) => {
          if (!mine(s)) return false
          s.turns.push({ id: newId(), role: 'assistant', job: jobId, text: 'Mi sono fermato a metà: scrivimi "continua" e riprendo da dove sono rimasto.' })
          s.job!.status = 'done'
        })
      }
    }
  } catch (error) {
    if (stopped) return
    stopped = true
    await updateState(scope, (s) => {
      if (!mine(s)) return false
      reply(s, error instanceof Error ? error.message : 'Qualcosa è andato storto, riprova.')
      s.job!.status = 'error'
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.updatedAt = new Date().toISOString()
    }).catch(() => undefined)
  }
}

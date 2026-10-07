import { supabaseAdmin } from '@/lib/supabase-admin'
import { runWithStatus } from '@/lib/ai'
import { runAssistant, type Draft, type SocialAction } from '@/lib/lead-assistant'

// Conversazioni dell'assistente salvate sul server (una per pagina: "leads" e
// "super"). Ogni richiesta diventa un lavoro che prosegue anche se la pagina
// viene chiusa: lo stato (avanzamento, risposta, bozze) si legge da qui.

export const SCOPES = ['leads', 'super'] as const
export type Scope = (typeof SCOPES)[number]

export type Turn = { id: string; role: 'user' | 'assistant'; text: string; actions?: SocialAction[] }

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
}

export type AssistantState = { turns: Turn[]; drafts: Draft[]; job: Job | null }

const MAX_TURNS = 80
/** Oltre questo tempo senza aggiornamenti un lavoro "in corso" e' considerato interrotto. */
export const STALE_MS = 6 * 60_000
const WORK_BUDGET_MS = 210_000
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

/**
 * Esegue il lavoro (chiamato dentro after(): prosegue anche a pagina chiusa).
 * Se il tempo finisce prima del termine, chiama `continueJob` per un nuovo giro.
 */
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
      s.job.updatedAt = new Date().toISOString()
    }).catch(() => undefined)
  }

  const start = await loadState(scope)
  const history = start.turns.slice(-9, -1).map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }))
  const job = start.job

  try {
    const result = await runWithStatus(
      { status: (text) => void writeStatus(text), deadline: Date.now() + WORK_BUDGET_MS },
      () => runAssistant(message, history, start.drafts)
    )
    const again = Boolean(result.more) && (job?.round ?? 0) < MAX_ROUNDS
    await updateState(scope, (s) => {
      const drafts = new Map(s.drafts.map((d) => [d.leadId, d]))
      for (const id of result.removeDrafts || []) drafts.delete(id)
      for (const d of result.drafts || []) drafts.set(d.leadId, d)
      s.drafts = [...drafts.values()]
      s.turns.push({ id: newId(), role: 'assistant', text: clean(result.reply || ''), actions: result.actions?.length ? result.actions : undefined })
      if (s.job?.id === jobId) {
        s.job.status = again ? 'running' : 'done'
        s.job.statusText = again ? 'Continuo con il resto…' : ''
        s.job.updatedAt = new Date().toISOString()
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
    await updateState(scope, (s) => {
      s.turns.push({ id: newId(), role: 'assistant', text: error instanceof Error ? error.message : 'Qualcosa è andato storto, riprova.' })
      if (s.job?.id === jobId) {
        s.job.status = 'error'
        s.job.updatedAt = new Date().toISOString()
      }
    }).catch(() => undefined)
  }
}

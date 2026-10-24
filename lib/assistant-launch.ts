import { canContinue, isStale, loadState, recoverStaleJob, type AssistantState, type Scope } from '@/lib/assistant-state'

// Giri successivi di un lavoro della super chat: ognuno parte in una nuova
// funzione del server (tempo pieno), chiamando la route dell'assistente con la
// chiave interna. Usato a fine giro, e per riprendere i lavori rimasti fermi
// (dalla pagina che li controlla e dal cron di ogni minuto).

export const internalKey = () => (process.env.CRON_SECRET || '').trim()

/** Chiede il giro `round` del lavoro jobId. Rifiutato se un altro l'ha gia' avviato. */
export async function requestRound(origin: string, scope: Scope, jobId: string, round: number) {
  const key = internalKey()
  if (!key) throw new Error('CRON_SECRET mancante: niente continuazione automatica')
  const res = await fetch(`${origin}/api/admin/leads/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ scope, jobId, round }),
  })
  if (!res.ok) throw new Error(`continuazione rifiutata: ${res.status}`)
}

/** Lavoro fermo: riparte da solo con un nuovo giro se puo', altrimenti si chiude con un messaggio. */
export async function resumeOrClose(origin: string, scope: Scope, state: AssistantState): Promise<AssistantState> {
  const job = state.job
  if (!job || !isStale(job)) return state
  if (canContinue(job)) {
    const ok = await requestRound(origin, scope, job.id, (job.round ?? 0) + 1).then(
      () => true,
      () => false
    )
    if (ok) return loadState(scope)
  }
  return recoverStaleJob(scope, await loadState(scope))
}

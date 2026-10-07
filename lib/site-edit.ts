import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToAdmins } from '@/lib/push'

// Modifiche al sito chieste dalla super chat. Il lavoro lo fa Claude Code in
// GitHub Actions (.github/workflows/site-edit.yml) su un ramo site-edit/<id>;
// Vercel ne crea l'anteprima e il sito va online solo quando Luca preme
// "Pubblica" (merge della pull request su main).

export type SiteEditRecord = {
  id: string
  request: string
  model: 'sonnet' | 'opus'
  createdAt: string
  updatedAt: string
  /** Richieste successive sullo stesso ramo (correzioni all'anteprima). */
  revisions?: number
  state?: 'published' | 'discarded'
  pr?: number | null
  summary?: string
  conclusion?: string
  runUrl?: string
}

export type SiteEditStatus = {
  id: string
  request: string
  phase: 'starting' | 'working' | 'preview_building' | 'ready' | 'preview_failed' | 'no_changes' | 'failed' | 'published' | 'discarded'
  summary: string | null
  pr: number | null
  prUrl: string | null
  previewUrl: string | null
  runUrl: string | null
  files: string[]
  createdAt: string
  updatedAt: string
}

const repo = () => (process.env.GITHUB_REPO || 'LCtech96/Facevoice.AI').trim()
const token = () => (process.env.GITHUB_SITE_TOKEN || process.env.GITHUB_TOKEN || '').trim()
const keyOf = (id: string) => `site_edit:${id}`
const branchOf = (id: string) => `site-edit/${id}`

export const siteEditConfigured = () => Boolean(token())

export class SiteEditError extends Error {}

async function gh<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (!token()) throw new SiteEditError('Manca GITHUB_SITE_TOKEN nelle variabili di Vercel: senza non posso modificare il sito.')
  const res = await fetch(`https://api.github.com/repos/${repo()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new SiteEditError(`GitHub ${res.status}: ${data?.message || 'errore'}`)
  return data as T
}

async function load(id: string): Promise<SiteEditRecord | null> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', keyOf(id)).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as SiteEditRecord) : null
  } catch {
    return null
  }
}

async function save(record: SiteEditRecord) {
  record.updatedAt = new Date().toISOString()
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: keyOf(record.id), value: JSON.stringify(record), updated_at: record.updatedAt })
}

const newEditId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Avvia una modifica (o una correzione di una già in anteprima, con reviseId). */
export async function startSiteEdit(request: string, opts: { model?: 'sonnet' | 'opus'; reviseId?: string } = {}) {
  const text = request.trim().slice(0, 4000)
  if (!text) throw new SiteEditError('Scrivi cosa cambiare nel sito.')
  let record = opts.reviseId ? await load(opts.reviseId) : null
  if (opts.reviseId && !record) throw new SiteEditError('Modifica da correggere non trovata.')
  if (record?.state) throw new SiteEditError('Quella modifica è già stata pubblicata o scartata: ne avvio una nuova se me lo chiedi.')

  const now = new Date().toISOString()
  if (record) {
    record.request = text
    record.revisions = (record.revisions || 0) + 1
    record.summary = undefined
    record.conclusion = undefined
  } else {
    record = { id: newEditId(), request: text, model: opts.model || 'sonnet', createdAt: now, updatedAt: now }
  }
  await gh('/dispatches', {
    method: 'POST',
    body: JSON.stringify({ event_type: 'site-edit', client_payload: { id: record.id, request: text, model: record.model } }),
  })
  await save(record)
  return record
}

/** Chiamata dal workflow a fine lavoro. */
export async function recordSiteEditResult(payload: {
  id?: unknown
  conclusion?: unknown
  pr?: unknown
  changed?: unknown
  summary?: unknown
  runUrl?: unknown
}) {
  const id = typeof payload.id === 'string' ? payload.id : ''
  const record = id ? await load(id) : null
  if (!record) return false
  record.conclusion = String(payload.conclusion || '')
  record.summary = typeof payload.summary === 'string' ? payload.summary.slice(0, 4000) : undefined
  if (typeof payload.pr === 'number') record.pr = payload.pr
  if (typeof payload.runUrl === 'string') record.runUrl = payload.runUrl
  await save(record)
  await sendPushToAdmins({
    title: record.conclusion === 'success' ? 'Modifica al sito pronta' : 'Modifica al sito non riuscita',
    body:
      record.conclusion !== 'success'
        ? 'Apri la super chat per i dettagli.'
        : payload.changed
          ? 'Controlla l’anteprima e premi Pubblica nella super chat.'
          : (record.summary || 'Nessuna modifica necessaria.').slice(0, 120),
    url: '/admin/assistant',
    tag: `site-edit-${record.id}`,
  }).catch(() => undefined)
  return true
}

async function findPr(record: SiteEditRecord) {
  const owner = repo().split('/')[0]
  const list = await gh<any[]>(`/pulls?state=all&head=${encodeURIComponent(`${owner}:${branchOf(record.id)}`)}`)
  return list?.[0] || null
}

async function findRun(record: SiteEditRecord) {
  const data = await gh<{ workflow_runs: any[] }>(`/actions/workflows/site-edit.yml/runs?event=repository_dispatch&per_page=30`)
  // La più recente per questo id (le correzioni avviano un nuovo giro).
  return data.workflow_runs?.find((r) => r.display_title === `site-edit ${record.id}`) || null
}

export async function getSiteEditStatus(id: string): Promise<SiteEditStatus | null> {
  const record = await load(id)
  if (!record) return null
  const base: SiteEditStatus = {
    id,
    request: record.request,
    phase: 'starting',
    summary: record.summary || null,
    pr: record.pr ?? null,
    prUrl: null,
    previewUrl: null,
    runUrl: record.runUrl || null,
    files: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
  if (record.state) return { ...base, phase: record.state }

  let run = await findRun(record).catch(() => null)
  // Appena avviata una correzione: il giro trovato e' ancora quello vecchio.
  if (run && !record.conclusion && new Date(run.created_at).getTime() < new Date(record.updatedAt).getTime() - 10_000) run = null
  if (run) base.runUrl = run.html_url
  // Lavoro (ri)partito dopo l'ultimo risultato: ancora in corso.
  if (run && run.status !== 'completed') return { ...base, phase: 'working', summary: null }
  if (!run && !record.conclusion) {
    // GitHub impiega qualche secondo a far partire il lavoro.
    const age = Date.now() - new Date(record.updatedAt).getTime()
    return { ...base, phase: age > 5 * 60_000 ? 'failed' : 'starting' }
  }
  if (run?.conclusion && run.conclusion !== 'success') return { ...base, phase: 'failed' }

  const pr = await findPr(record).catch(() => null)
  if (!pr) return { ...base, phase: 'no_changes' }
  base.pr = pr.number
  base.prUrl = pr.html_url
  if (pr.merged_at) return { ...base, phase: 'published' }
  if (pr.state === 'closed') return { ...base, phase: 'discarded' }

  const files = await gh<any[]>(`/pulls/${pr.number}/files?per_page=50`).catch(() => [])
  base.files = files.map((f) => f.filename)

  // Anteprima Vercel: stato del commit sull'ultima versione del ramo.
  const status = await gh<{ statuses: any[] }>(`/commits/${pr.head.sha}/status`).catch(() => ({ statuses: [] }))
  const vercel = status.statuses?.find((s) => /vercel/i.test(s.context || ''))
  if (vercel?.target_url) base.previewUrl = vercel.target_url
  if (!vercel || vercel.state === 'pending') return { ...base, phase: 'preview_building' }
  if (vercel.state !== 'success') return { ...base, phase: 'preview_failed' }
  return { ...base, phase: 'ready' }
}

/** Mette online: merge della pull request su main (Vercel pubblica da solo). */
export async function publishSiteEdit(id: string) {
  const record = await load(id)
  if (!record) throw new SiteEditError('Modifica non trovata.')
  const status = await getSiteEditStatus(id)
  if (!status || status.phase !== 'ready' || !status.pr) {
    throw new SiteEditError('Si può pubblicare solo quando l’anteprima è pronta e funziona.')
  }
  await gh(`/pulls/${status.pr}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: 'squash', commit_title: `${record.request.replace(/\s+/g, ' ').slice(0, 70)} (super chat)` }),
  })
  await gh(`/git/refs/heads/${branchOf(id)}`, { method: 'DELETE' }).catch(() => undefined)
  record.state = 'published'
  await save(record)
  return getSiteEditStatus(id)
}

export async function discardSiteEdit(id: string) {
  const record = await load(id)
  if (!record) throw new SiteEditError('Modifica non trovata.')
  const pr = await findPr(record).catch(() => null)
  if (pr?.merged_at) throw new SiteEditError('È già online: per tornare indietro chiedimi di annullarla con una nuova modifica.')
  if (pr && pr.state === 'open') await gh(`/pulls/${pr.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
  await gh(`/git/refs/heads/${branchOf(id)}`, { method: 'DELETE' }).catch(() => undefined)
  record.state = 'discarded'
  await save(record)
  return getSiteEditStatus(id)
}

/** Ultime modifiche chieste (per la super chat). */
export async function listSiteEdits(limit = 10) {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .like('key', 'site_edit:%')
    .order('updated_at', { ascending: false })
    .limit(limit)
  return (data || [])
    .map((r) => {
      try {
        return JSON.parse(r.value) as SiteEditRecord
      } catch {
        return null
      }
    })
    .filter((r): r is SiteEditRecord => Boolean(r))
}

import { NextRequest } from 'next/server'
import { adminOnly, json, readBody } from '@/lib/contract-http'
import { CONTRACT_ID_RE, listNotes, markNotesRead } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

// Campanella dei contratti (solo l'amministratore): richieste di modifica, firme, contratti completati.
// GET: ultime notifiche e quante non lette. POST { ids } | { contractId } | { all: true }: segna come lette.

export async function GET(req: NextRequest) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  return json(await listNotes())
}

export async function POST(req: NextRequest) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const body = await readBody(req, 5_000)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && /^n[a-z0-9]{6,20}$/.test(x)).slice(0, 60) : undefined
  const contractId = typeof body?.contractId === 'string' && CONTRACT_ID_RE.test(body.contractId) ? body.contractId : undefined
  const all = body?.all === true
  if (!ids?.length && !contractId && !all) return json({ error: 'Richiesta non valida' }, 400)
  const marked = await markNotesRead({ ids, contractId, all })
  return json({ ok: true, marked, ...(await listNotes()) })
}

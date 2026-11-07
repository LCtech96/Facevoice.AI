import { NextRequest } from 'next/server'
import { adminOnly, errorResponse, json, readBody } from '@/lib/contract-http'
import { SIGNATURE_NOTE, STATUS_LABEL, contractFromDocument, listContracts } from '@/lib/contracts'
import { DOC_ID_RE, DOC_KIND_LABEL, recentDocuments } from '@/lib/assistant-documents'

export const dynamic = 'force-dynamic'

// Pagina Contratti (solo l'amministratore).
// GET: contratti del sito (piu' i documenti della super chat non ancora diventati contratti).
// POST { docId }: il documento diventa un contratto (o si riapre quello che c'e' gia').

export async function GET(req: NextRequest) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const contracts = await listContracts()
  const used = new Set(contracts.map((c) => c.docId).filter(Boolean))
  const documents = (await recentDocuments(20)).filter((d) => !used.has(d.id))
  return json({
    note: SIGNATURE_NOTE,
    contracts: contracts.map((c) => ({ ...c, statusLabel: STATUS_LABEL[c.status] || c.status })),
    documents: documents.map((d) => ({ id: d.id, title: d.title, kind: DOC_KIND_LABEL[d.kind] || d.kind, at: d.at })),
  })
}

export async function POST(req: NextRequest) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const body = await readBody(req, 5_000)
  const docId = typeof body?.docId === 'string' ? body.docId : ''
  if (!DOC_ID_RE.test(docId)) return json({ error: 'Documento non valido.' }, 400)
  try {
    const c = await contractFromDocument(docId, access.email)
    return json({ ok: true, id: c.id })
  } catch (error) {
    return errorResponse(error)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import {
  ContractError,
  applyChange,
  cancelContract,
  clientDevice,
  clientIp,
  contractPdf,
  creatorView,
  deleteDraft,
  ensureParties,
  listContracts,
  loadContract,
  manualChange,
  openContract,
  previewChange,
  rejectChange,
  revokeLink,
  sendSignedEmails,
  setCreatorFields,
  shareContract,
  shareLink,
  shareSummary,
  signContract,
  SIGNATURE_NOTE,
  CONTRACT_DISCLAIMER,
} from '@/lib/saas/contracts'
import { isAIBlockedError } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'
// «Accetta» fa scrivere la modifica all'AI (fino a un minuto); l'invio del link puo' passare da Meta.
export const maxDuration = 120

// Contratti dello spazio di lavoro (lib/saas/contracts.ts): solo titolare e amministratori dello
// spazio (token e spazio come tutte le API dell'area clienti); ogni contratto si legge solo con
// la chiave del suo spazio, quindi da un altro spazio non esiste.
//   GET                       elenco (contratti e documenti non ancora aperti come contratti)
//   GET ?id=                  il contratto (lo apre dal documento la prima volta)
//   GET ?id=&pdf=1[&download=1]  PDF (bozza con la scritta, oppure firmato con il registro)
//   GET ?id=&link=1           link da copiare (mai il PIN: non esiste piu' in chiaro)
//   POST { op, id, ... }      share | revoke | fields (i tuoi dati, mentre scrivi) | preview | apply | manual | reject | sign | cancel
//   DELETE ?id=               elimina una bozza mai inviata (con il suo documento)

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
const json = (body: unknown, status = 200) => {
  const res = NextResponse.json(body, { status })
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v)
  return res
}
const fail = (error: unknown) => {
  if (error instanceof ContractError) return json({ error: error.message, code: error.code }, error.status)
  if (isAIBlockedError(error)) return json({ error: (error as Error).message, code: 'ai_blocked' }, 402)
  console.error('contratti:', error instanceof Error ? error.message.slice(0, 200) : 'errore')
  return json({ error: 'Non riuscito, riprova.' }, 500)
}

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const ws = access.workspace.id
  const params = req.nextUrl.searchParams
  const id = params.get('id') || ''
  try {
    if (!id) return json({ contracts: await listContracts(ws), signatureNote: SIGNATURE_NOTE, disclaimer: CONTRACT_DISCLAIMER })
    // Contratti di prima: «Le parti» si aggiungono qui, senza toccare testo e firme.
    const contract = await ensureParties((await loadContract(ws, id)) || (await openContract(ws, access.userId, id)))
    if (params.get('link') === '1') return json({ link: shareLink(contract) })
    if (params.get('pdf') === '1') {
      const file = contractPdf(contract)
      const download = params.get('download') === '1'
      return new NextResponse(new Uint8Array(file.pdf), {
        status: 200,
        headers: {
          ...NO_STORE,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file.filename}"`,
          'Content-Length': String(file.pdf.length),
        },
      })
    }
    return json({ contract: creatorView(contract) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const ws = access.workspace.id
  const body = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  const op = typeof body.op === 'string' ? body.op : ''
  if (!id || !op) return json({ error: 'Richiesta non valida.' }, 400)
  try {
    switch (op) {
      case 'share': {
        // Il PIN arriva solo qui, dal campo della pagina: si salva solo il suo hash (mai nei log).
        const outcome = await shareContract(access.db, access.userId, id, {
          recipientName: body.recipientName,
          email: body.email,
          channel: body.channel,
          contactId: body.contactId,
          text: body.text,
          pin: body.pin,
          origin: req.nextUrl.origin,
        })
        return json({ ok: true, message: shareSummary(outcome), link: outcome.link, contract: creatorView(outcome.contract) })
      }
      case 'revoke':
        return json({ ok: true, contract: creatorView(await revokeLink(ws, id)) })
      case 'fields': {
        const current = await loadContract(ws, id)
        if (current) await ensureParties(current)
        return json({ ok: true, contract: creatorView(await setCreatorFields(ws, id, body.values)) })
      }
      case 'preview':
        return json({ ok: true, contract: creatorView(await previewChange(access.db, id, body.changeId, body.instructions)) })
      case 'apply':
        return json({ ok: true, contract: creatorView(await applyChange(ws, id, access.userId, body.changeId)) })
      case 'manual':
        return json({ ok: true, contract: creatorView(await manualChange(ws, id, access.userId, { changeId: body.changeId, sections: body.sections, note: body.note })) })
      case 'reject':
        return json({ ok: true, contract: creatorView(await rejectChange(ws, id, body.changeId, body.note)) })
      case 'cancel':
        return json({ ok: true, contract: creatorView(await cancelContract(ws, id)) })
      case 'sign': {
        await ensureParties(await openContract(ws, access.userId, id))
        const signed = await signContract(
          ws,
          id,
          'creatore',
          { versionId: body.versionId, name: body.name, accept: body.accept, strokes: body.strokes, ratio: body.ratio, fields: body.fields, othersRev: body.othersRev },
          { ip: clientIp(req.headers), device: clientDevice(req.headers), userId: access.userId }
        )
        if (signed.completed) await sendSignedEmails(access.db, signed.contract).catch(() => 0)
        return json({ ok: true, completed: signed.completed, contract: creatorView(signed.contract) })
      }
    }
    return json({ error: 'Operazione sconosciuta.' }, 400)
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  try {
    await deleteDraft(access.workspace.id, req.nextUrl.searchParams.get('id') || '')
    return json({ ok: true })
  } catch (error) {
    return fail(error)
  }
}

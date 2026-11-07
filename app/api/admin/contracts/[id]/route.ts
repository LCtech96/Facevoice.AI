import { NextRequest } from 'next/server'
import { adminOnly, clientIp, errorResponse, json, readBody } from '@/lib/contract-http'
import {
  CONTRACT_ID_RE,
  SHARE_CHANNELS,
  applyNewVersion,
  cancelContract,
  contractDoc,
  creatorView,
  deleteDraft,
  linkOrigin,
  loadContract,
  markNotesRead,
  openContract,
  rejectRequest,
  revokeLink,
  setCreatorFields,
  setRecipient,
  signContract,
  type ShareChannel,
} from '@/lib/contracts'
import { afterCompleted, shareContractNow } from '@/lib/contract-share'
import { loadTranscript, reviseDocument } from '@/lib/assistant-documents'
import { loadKnowledge } from '@/lib/meta/agent'
import { emptyFieldLabels } from '@/lib/pdf-doc'
import { stripPartiesSection } from '@/lib/contract-parties'

export const dynamic = 'force-dynamic'
// L'anteprima di una modifica con l'AI puo' durare un minuto.
export const maxDuration = 120

// Un contratto, per l'amministratore. Ogni azione ricontrolla che sia lui.
// GET ?link=1 (link da copiare) &seen=1 (notifiche di questo contratto lette)
// POST { action: recipient | fields | share | revoke | reject | preview | apply | sign | cancel, ... }
// DELETE: cancella una bozza non firmata.

type Ctx = { params: Promise<{ id: string }> }

async function target(ctx: Ctx) {
  const { id } = await ctx.params
  return CONTRACT_ID_RE.test(id) ? id : null
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const id = await target(ctx)
  // Aperto: i contratti di prima ricevono qui gli spazi per i dati delle parti (testo e firme restano).
  const c = id ? await openContract(id) : null
  if (!c) return json({ error: 'Contratto non trovato.' }, 404)
  if (req.nextUrl.searchParams.get('seen') === '1') await markNotesRead({ contractId: c.id }).catch(() => undefined)
  return json({ contract: creatorView(c, linkOrigin(req.nextUrl.origin), req.nextUrl.searchParams.get('link') === '1') })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const id = await target(ctx)
  if (!id) return json({ error: 'Contratto non trovato.' }, 404)
  const body = await readBody(req)
  if (!body) return json({ error: 'Richiesta non valida' }, 400)
  const origin = linkOrigin(req.nextUrl.origin)
  const view = (c: Parameters<typeof creatorView>[0], withLink = false) => creatorView(c, origin, withLink)
  const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
  try {
    switch (body.action) {
      case 'recipient': {
        const c = await setRecipient(id, { name: str(body.name, 120), email: typeof body.email === 'string' ? body.email || null : undefined })
        return json({ ok: true, contract: view(c) })
      }
      case 'fields': {
        const values = body.values && typeof body.values === 'object' ? (body.values as Record<string, unknown>) : {}
        return json({ ok: true, contract: view(await setCreatorFields(id, values)) })
      }
      case 'share': {
        // La scheda "Condividi" della pagina e' la conferma: tutto e' visibile prima del clic.
        const channel = str(body.channel, 20) as ShareChannel
        if (!SHARE_CHANNELS.includes(channel)) return json({ error: 'Canale non valido.' }, 400)
        const shared = await shareContractNow(id, { channel, to: str(body.to, 200), name: str(body.name, 120), text: str(body.text, 2000), pin: str(body.pin, 40), origin }, access.email)
        if (!shared.ok) return json({ error: shared.error[0].toUpperCase() + shared.error.slice(1) + '.' }, shared.retryable ? 502 : 400)
        return json({ ok: true, outcome: shared.outcome, contract: view(shared.contract, true) })
      }
      case 'revoke':
        return json({ ok: true, contract: view(await revokeLink(id)) })
      case 'reject':
        return json({ ok: true, contract: view(await rejectRequest(id, str(body.requestId, 40), body.note)) })
      case 'preview': {
        // "Accetta": l'AI applica la richiesta e mostra il risultato; si salva solo con "Salva".
        const c = await loadContract(id)
        if (!c) return json({ error: 'Contratto non trovato.' }, 404)
        const request = typeof body.requestId === 'string' ? c.requests.find((r) => r.id === body.requestId) : null
        const text = str(body.text, 2000).trim() || request?.text || ''
        if (text.length < 3) return json({ error: 'Scrivi la modifica da fare.' }, 400)
        const transcript = c.recipient.platform && c.recipient.contactId ? await loadTranscript(c.recipient.platform, c.recipient.contactId, 15_000).catch(() => null) : null
        const knowledge = await loadKnowledge().catch(() => '')
        const where = request?.section ? ` (sezione «${request.section}»)` : ''
        const revised = await reviseDocument({
          kind: c.kind,
          current: c.version.doc,
          instructions: `Richiesta di modifica di ${c.recipient.name}${where}, accettata da Luca: ${text}. Cambia solo quello che serve per questa richiesta.`,
          transcript,
          knowledge,
        })
        // "Le parti" nel contratto si aggiunge mostrandolo: non sta nel testo da salvare.
        const proposal = stripPartiesSection(revised.doc)
        const preview = contractDoc({ ...c, version: { ...c.version, doc: proposal }, signatures: {}, final: undefined })
        return json({ ok: true, proposal, preview, missing: emptyFieldLabels(proposal) })
      }
      case 'apply': {
        const mode = body.mode === 'modificata' ? 'modificata' : 'accettata'
        const c = await applyNewVersion(id, { doc: body.doc, requestId: typeof body.requestId === 'string' ? body.requestId : undefined, mode, note: str(body.note, 300), by: access.email })
        return json({ ok: true, contract: view(c) })
      }
      case 'sign': {
        const { contract, completed } = await signContract(id, 'creatore', {
          versionId: str(body.versionId, 40),
          name: str(body.name, 200),
          accepted: body.accepted,
          strokes: body.strokes,
          values: body.values,
          ip: clientIp(req),
          userAgent: req.headers.get('user-agent') || '',
        })
        if (completed) await afterCompleted(contract, origin)
        return json({ ok: true, completed, contract: view(contract) })
      }
      case 'cancel':
        return json({ ok: true, contract: view(await cancelContract(id)) })
      default:
        return json({ error: 'Azione non valida' }, 400)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const id = await target(ctx)
  if (!id) return json({ error: 'Contratto non trovato.' }, 404)
  try {
    await deleteDraft(id)
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

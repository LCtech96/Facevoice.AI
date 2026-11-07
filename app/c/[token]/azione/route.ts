import { NextRequest } from 'next/server'
import { clientIp, errorResponse, json, readBody, sameOrigin } from '@/lib/contract-http'
import { LINK_COOKIE, addChangeRequest, contractByToken, linkOrigin, publicView, saveRecipientData, signContract, verifyLinkCookie } from '@/lib/contracts'
import { afterSigned, notifyCreator, runLater } from '@/lib/contract-share'

export const dynamic = 'force-dynamic'

// Azioni di chi ha ricevuto il link (dopo il PIN, con il cookie di questo link):
//   { action: 'richiesta', text, section? }  -> richiesta di modifica, avviso a Facevoice AI
//   { action: 'dati', values }                -> i dati di chi riceve (nome, codice fiscale...), salvati mentre scrive
//   { action: 'firma', versionId, name, accepted: [true,true,true], strokes, values }
// La firma vale solo per la versione mostrata: se il contratto e' cambiato si ricarica.

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  const { token } = await params
  const c = await contractByToken(token)
  if (!c || !c.share) return json({ error: 'Link non valido.' }, 404)
  if (!verifyLinkCookie(req.cookies.get(LINK_COOKIE)?.value, c.share)) return json({ error: 'Inserisci di nuovo il PIN.', pin: true }, 401)
  const body = await readBody(req)
  if (!body) return json({ error: 'Richiesta non valida.' }, 400)
  try {
    if (body.action === 'richiesta') {
      const { contract, request } = await addChangeRequest(c.id, { text: body.text, section: body.section })
      await runLater(() => notifyCreator(contract, 'modifica', { requestId: request.id }))
      return json({ ok: true, view: publicView(contract) })
    }
    if (body.action === 'dati') {
      // Bozza dei dati: niente avvisi e niente log (sono dati personali).
      const contract = await saveRecipientData(c.id, body.values)
      return json({ ok: true, view: publicView(contract) })
    }
    if (body.action === 'firma') {
      const { contract, completed } = await signContract(c.id, 'destinatario', {
        versionId: typeof body.versionId === 'string' ? body.versionId : '',
        name: typeof body.name === 'string' ? body.name : '',
        accepted: body.accepted,
        strokes: body.strokes,
        values: body.values,
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent') || '',
      })
      // Avvisi a chi crea (campanella, push, email) dopo la risposta: la firma e' gia' salvata.
      const origin = linkOrigin(req.nextUrl.origin)
      await runLater(() => afterSigned(contract, 'destinatario', completed, origin))
      return json({ ok: true, completed, view: publicView(contract) })
    }
    return json({ error: 'Azione non valida.' }, 400)
  } catch (error) {
    return errorResponse(error)
  }
}

import { NextRequest } from 'next/server'
import { clientIp, errorResponse, json, readBody, sameOrigin } from '@/lib/contract-http'
import { LINK_COOKIE, addChangeRequest, contractByToken, linkOrigin, publicView, signContract, verifyLinkCookie } from '@/lib/contracts'
import { afterCompleted, notifyCreator } from '@/lib/contract-share'

export const dynamic = 'force-dynamic'

// Azioni di chi ha ricevuto il link (dopo il PIN, con il cookie di questo link):
//   { action: 'richiesta', text, section? }  -> richiesta di modifica, avviso a Facevoice AI
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
      await notifyCreator(contract, 'modifica', request.id)
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
      if (completed) await afterCompleted(contract, linkOrigin(req.nextUrl.origin))
      else await notifyCreator(contract, 'firma_destinatario')
      return json({ ok: true, completed, view: publicView(contract) })
    }
    return json({ error: 'Azione non valida.' }, 400)
  } catch (error) {
    return errorResponse(error)
  }
}

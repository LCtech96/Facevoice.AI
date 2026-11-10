import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { accessView, changeAccessPassword, deleteAccess, grantBoards, revokeBoards, setAccessEmail } from '@/lib/todo-access'
import { forgetBellViewer, viewerKey } from '@/lib/todo-bell'
import { clearCodes } from '@/lib/todo-login'
import { errorResponse, json, readBody } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Un accesso (solo l'admin): aggiungi o togli progetti, email (per il codice di
// entrata), password nuova (la persona esce e rientra con quella nuova), elimina (la
// persona esce subito). Password, email o accesso cambiati: i codici di entrata gia'
// mandati non valgono piu'.

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const { id } = await params
    const body = await readBody(req, 20_000)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    switch (body.action) {
      case 'grant':
        return json({ access: accessView(await grantBoards(id, body.boardIds)) })
      case 'revoke':
        return json({ access: accessView(await revokeBoards(id, body.boardIds)) })
      case 'password': {
        const access = await changeAccessPassword(id, body.password)
        await clearCodes(access.id)
        return json({ access: accessView(access) })
      }
      case 'email': {
        const access = await setAccessEmail(id, body.email)
        await clearCodes(access.id)
        return json({ access: accessView(access) })
      }
      default:
        return json({ error: 'Azione non valida.' }, 400)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const { id } = await params
    await deleteAccess(id)
    await Promise.all([clearCodes(id), forgetBellViewer(viewerKey({ kind: 'person', id }))])
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

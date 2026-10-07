import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { approveAccess, rejectAccess, setDisabledModels, verifyActionLink } from '@/lib/chat-access'
import { CHAT_MODELS } from '@/lib/chat-models'
import { SITE_URL } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'

function page(title: string, text: string) {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#120400;color:#fff;font-family:system-ui,sans-serif;padding:24px">
<div style="max-width:380px;text-align:center"><p style="font-size:20px;font-weight:600">${title}</p><p style="opacity:.75">${text}</p>
<p><a href="${SITE_URL}/admin" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:999px;background:#ff6a1a;color:#fff;text-decoration:none">Apri il pannello admin</a></p></div></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** Link Approva / Rifiuta dell'email all'admin (firmati, senza login). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const userId = p.get('uid') || ''
  const action = p.get('action') || ''
  if (!verifyActionLink(userId, action, Number(p.get('exp')), p.get('sig') || '')) {
    return page('Link non valido', 'Il link è scaduto o non è corretto. Approva o rifiuta dal pannello admin.')
  }
  try {
    if (action === 'approve') {
      const done = await approveAccess(userId)
      return done
        ? page('Accesso approvato', `${escape(done.email)} ora può usare la chat AI interna. Gli abbiamo mandato un'email di benvenuto.`)
        : page('Utente non trovato', 'Questo account non esiste più.')
    }
    if (action === 'reject') {
      await rejectAccess(userId)
      return page('Richiesta rifiutata', "L'utente non è stato abilitato alla chat interna.")
    }
  } catch (error) {
    console.error('chat access:', error)
    return page('Errore', 'Non è stato possibile completare l’operazione: riprova dal pannello admin.')
  }
  return page('Azione non valida', '')
}

/** Pulsanti in /admin. body: { userId, action: 'approve' | 'reject' } */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const userId = String(body?.userId || '')
  if (!userId) return NextResponse.json({ error: 'Utente mancante' }, { status: 400 })
  try {
    if (body?.action === 'approve') {
      const done = await approveAccess(userId)
      if (!done) return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 })
      return NextResponse.json({ status: 'member' })
    }
    if (body?.action === 'reject') {
      await rejectAccess(userId)
      return NextResponse.json({ status: 'rejected' })
    }
    if (body?.action === 'models') {
      const known = new Set(CHAT_MODELS.map((m) => m.id))
      const list = (Array.isArray(body?.disabled) ? body.disabled : []).filter((m: unknown): m is string => typeof m === 'string' && known.has(m))
      await setDisabledModels(userId, list)
      return NextResponse.json({ disabled_models: list })
    }
    return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Errore' }, { status: 500 })
  }
}

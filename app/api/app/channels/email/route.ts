import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { EMAIL_PRESETS, IMAP_PORTS, SMTP_PORTS, presetById, presetForAddress } from '@/lib/saas/email-presets'
import { explainMailError, testMailbox, type EmailSecret } from '@/lib/saas/email'
import { connectionOwner, deleteConnection, listConnections, saveConnection, setChannelState } from '@/lib/saas/connections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Collegamento della casella email di un cliente (IMAP + SMTP).

export async function GET() {
  // Elenco dei fornitori per la pagina di collegamento (niente dati riservati).
  return NextResponse.json({
    presets: EMAIL_PRESETS.map(({ id, label, domains, passwordHelp, passwordUrl, imap, smtp }) => ({ id, label, domains, passwordHelp, passwordUrl, imap, smtp })),
  })
}

const port = (value: unknown, allowed: number[], fallback: number) => {
  const n = Number(value)
  return allowed.includes(n) ? n : fallback
}

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))

  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Scrivi un indirizzo email valido.' }, { status: 400 })
  const preset = presetById(String(body.preset || '')) || presetForAddress(email)
  // Le password per le app di Google si copiano con gli spazi ("abcd efgh ..."): vanno tolti.
  const rawPassword = String(body.password || '')
  const password = preset?.id === 'gmail' ? rawPassword.replace(/\s+/g, '') : rawPassword.trim()
  if (!password) return NextResponse.json({ error: 'Scrivi la password.' }, { status: 400 })
  const custom = !preset || body.preset === 'custom'
  const secret: EmailSecret = {
    user: String(body.username || '').trim() || email,
    password,
    imap: custom
      ? { host: String(body.imapHost || '').trim(), port: port(body.imapPort, IMAP_PORTS, 993) }
      : preset!.imap,
    smtp: custom
      ? { host: String(body.smtpHost || '').trim(), port: port(body.smtpPort, SMTP_PORTS, 465) }
      : preset!.smtp,
  }
  if (!secret.imap.host || !secret.smtp.host) return NextResponse.json({ error: 'Scrivi i server IMAP e SMTP.' }, { status: 400 })

  const owner = await connectionOwner('email', email)
  if (owner && owner !== access.workspace.id) {
    return NextResponse.json({ error: 'Questa casella è già collegata a un altro spazio di lavoro.' }, { status: 409 })
  }

  try {
    await testMailbox(secret)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    console.warn('email connect test:', email, raw)
    const message = /non è un indirizzo|non esiste|non è raggiungibile|Porta/.test(raw) ? raw : explainMailError(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const connection = await saveConnection(access.db, {
      platform: 'email',
      externalId: email,
      displayName: String(body.displayName || '').trim().slice(0, 80) || null,
      meta: { provider: custom ? 'custom' : preset!.id, savesSent: custom ? false : preset!.savesSent },
      secret,
      userId: access.userId,
    })
    await setChannelState(access.db, 'email', { status: 'connected', handle: email })
    return NextResponse.json({ connection: { id: connection.id, email, status: connection.status } })
  } catch (error) {
    console.error('email connect save:', error instanceof Error ? error.message : error)
    const keyMissing = error instanceof Error && /CHANNEL_SECRETS_KEY/.test(error.message)
    return NextResponse.json({ error: keyMissing ? 'Il servizio non è ancora configurato per salvare le credenziali.' : 'Collegamento non salvato, riprova.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const id = req.nextUrl.searchParams.get('id') || ''
  const connections = await listConnections(access.db, 'email')
  const target = connections.find((c) => c.id === id)
  if (!target) return NextResponse.json({ error: 'Collegamento non trovato' }, { status: 404 })
  await deleteConnection(access.db, target.id)
  if (connections.length <= 1) await setChannelState(access.db, 'email', { status: 'not_connected', handle: null })
  return NextResponse.json({ ok: true })
}

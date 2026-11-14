import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authFromRequest, ownerOnlyResponse, sharedRevokedResponse, type AppUser } from '@/lib/workspace'
import { disableSharedPassword, readSharedAccess, setSharedPassword, sharedPasswordProblem } from '@/lib/shared-access'
import { appBaseUrl } from '@/lib/app-url'

export const dynamic = 'force-dynamic'

// «Accesso con password per i collaboratori» (pagina Account). GET: com'e' adesso.
// POST { action: 'enable' | 'change' | 'disable', password? }: solo il titolare, entrato con
// il suo accesso (Google o la sua email e password), non chi e' entrato con la password dei
// collaboratori. Cambiare o spegnere la password fa uscire subito chi era entrato con lei;
// le sessioni del titolare non si toccano.

const NO_STORE = { 'Cache-Control': 'no-store' }

async function who(req: NextRequest): Promise<AppUser | NextResponse> {
  let auth
  try {
    auth = await authFromRequest(req)
  } catch {
    return NextResponse.json({ error: 'Non disponibile in questo momento, riprova.' }, { status: 503 })
  }
  if (auth && 'revoked' in auth) return sharedRevokedResponse(auth.revoked)
  if (!auth?.user.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  return auth.user
}

const providers = (user: AppUser) => Array.from(new Set((user.identities || []).map((i) => i.provider).filter(Boolean)))

function view(req: NextRequest, user: AppUser, access: Awaited<ReturnType<typeof readSharedAccess>>) {
  const email = access.email || (user.email || '').toLowerCase()
  const link = `${appBaseUrl(req)}/app?accesso=password&email=${encodeURIComponent(email)}`
  return {
    email,
    enabled: access.enabled,
    changedAt: access.changedAt,
    shared: Boolean(user.shared),
    providers: providers(user),
    link,
  }
}

export async function GET(req: NextRequest) {
  const user = await who(req)
  if (user instanceof NextResponse) return user
  try {
    return NextResponse.json(view(req, user, await readSharedAccess(user.id)), { headers: NO_STORE })
  } catch (error) {
    console.error('password collaboratori (lettura):', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Non riesco a leggere le impostazioni, riprova.' }, { status: 500 })
  }
}

/**
 * La password dei collaboratori non deve essere quella con cui entra il titolare: altrimenti chi
 * la usa entrerebbe come titolare (con tutti i poteri sull'account). Si prova ad accedere con lei
 * (per tutti gli account: anche chi e' entrato con Google puo' avere una password); se l'accesso
 * riesce, la sessione appena aperta si chiude subito. Se non si riesce a controllare: 'unknown'
 * (e non si salva).
 */
async function ownPasswordCheck(email: string, password: string): Promise<'same' | 'different' | 'unknown'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return 'unknown'
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.signInWithPassword({ email, password }).catch(() => null)
  if (!result) return 'unknown'
  const token = result.data?.session?.access_token
  if (token) {
    await supabaseAdmin.auth.admin.signOut(token, 'local').catch(() => undefined)
    return 'same'
  }
  const err = result.error as { code?: string; message?: string; status?: number } | null
  if (err?.code === 'invalid_credentials' || /invalid login credentials/i.test(err?.message || '')) return 'different'
  // Email da confermare: la password era giusta.
  if (err?.code === 'email_not_confirmed' || /not confirmed/i.test(err?.message || '')) return 'same'
  return 'unknown'
}

const ACTION_TEXT = {
  enable: 'è stata attivata la password per i collaboratori',
  change: 'è stata cambiata la password per i collaboratori',
  disable: 'è stata spenta la password per i collaboratori',
} as const

/** Avviso al titolare (se non e' stato lui, se ne accorge subito e la spegne da Account). */
function notifyOwner(req: NextRequest, email: string, action: keyof typeof ACTION_TEXT) {
  const account = `${appBaseUrl(req)}/app/account`
  const what = ACTION_TEXT[action]
  const text = `Sul tuo account Facevoice AI ${what}.\n\nSe non sei stato tu, apri ${account}, spegni la password dei collaboratori e cambia la tua password.`
  const html = emailLayout(`
<p>Sul tuo account Facevoice AI <strong>${escapeHtml(what)}</strong>.</p>
<p>Se non sei stato tu, apri la pagina Account, spegni la password dei collaboratori e cambia la tua password.</p>
<p><a href="${escapeHtml(account)}" style="display: inline-block; background: #1f4fe0; color: #ffffff; padding: 10px 18px; border-radius: 999px; text-decoration: none;">Apri Account</a></p>`)
  after(() => sendEmail({ to: email, subject: 'Password per i collaboratori: modifica sul tuo account', text, html }).catch(() => false))
}

export async function POST(req: NextRequest) {
  const user = await who(req)
  if (user instanceof NextResponse) return user
  if (user.shared) return ownerOnlyResponse('Solo il titolare dell’account può cambiare o spegnere la password dei collaboratori: deve entrare con il suo accesso.')
  const body = await req.json().catch(() => ({}))
  const action = body?.action
  try {
    if (action === 'disable') {
      const access = await disableSharedPassword(user.id)
      notifyOwner(req, (user.email || '').toLowerCase(), 'disable')
      return NextResponse.json(view(req, user, access), { headers: NO_STORE })
    }
    if (action !== 'enable' && action !== 'change') return NextResponse.json({ error: 'Azione non valida.' }, { status: 400 })
    const problem = sharedPasswordProblem(body?.password)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    const password = body.password as string
    const own = await ownPasswordCheck((user.email || '').toLowerCase(), password)
    if (own === 'same') return NextResponse.json({ error: 'Usa una password diversa da quella con cui entri tu: questa è solo per i collaboratori.' }, { status: 400 })
    if (own === 'unknown') return NextResponse.json({ error: 'Non riesco a controllare la password in questo momento, riprova tra poco.' }, { status: 503 })
    const access = await setSharedPassword(user, password)
    notifyOwner(req, (user.email || '').toLowerCase(), action)
    return NextResponse.json(view(req, user, access), { headers: NO_STORE })
  } catch (error) {
    console.error('password collaboratori:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Non riesco a salvare, riprova.' }, { status: 500 })
  }
}

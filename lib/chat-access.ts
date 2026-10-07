import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'

// Richieste di accesso alla chat interna: chi si registra e non e' abilitato
// preme "Richiedi accesso"; l'admin riceve push ed email con i link Approva /
// Rifiuta (firmati: funzionano senza login e scadono dopo 7 giorni) e trova gli
// stessi pulsanti in /admin accanto all'email dell'utente.

export type AccessStatus = 'member' | 'pending' | 'rejected' | null
type AccessRequest = { email: string; requestedAt: string; status: 'pending' | 'rejected' }

const PREFIX = 'chat_access_request:'
const LINK_TTL_MS = 7 * 24 * 3600_000
const NOTIFY_AGAIN_MS = 60 * 60_000

const secret = () => (process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function sign(userId: string, action: string, exp: number) {
  return createHmac('sha256', secret()).update(`${userId}.${action}.${exp}`).digest('base64url')
}

export function actionLink(userId: string, action: 'approve' | 'reject') {
  const exp = Date.now() + LINK_TTL_MS
  return `${SITE_URL}/api/admin/chat-access?uid=${encodeURIComponent(userId)}&action=${action}&exp=${exp}&sig=${sign(userId, action, exp)}`
}

export function verifyActionLink(userId: string, action: string, exp: number, sig: string) {
  if (!secret() || !userId || !sig || !Number.isFinite(exp) || exp < Date.now()) return false
  const expected = Buffer.from(sign(userId, action, exp))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

async function readRequest(userId: string): Promise<AccessRequest | null> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', PREFIX + userId).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as AccessRequest) : null
  } catch {
    return null
  }
}

async function writeRequest(userId: string, request: AccessRequest | null) {
  if (!request) {
    await supabaseAdmin.from('app_settings').delete().eq('key', PREFIX + userId)
    return
  }
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: PREFIX + userId, value: JSON.stringify(request), updated_at: new Date().toISOString() })
}

/** Stato di tutti gli utenti: membri della chat e richieste aperte o rifiutate. */
export async function accessStatuses(): Promise<Map<string, AccessStatus>> {
  const map = new Map<string, AccessStatus>()
  const [{ data: requests }, { data: members }] = await Promise.all([
    supabaseAdmin.from('app_settings').select('key, value').like('key', `${PREFIX}%`),
    supabaseAdmin.from('chat_members').select('user_id'),
  ])
  for (const row of requests || []) {
    try {
      map.set(row.key.slice(PREFIX.length), (JSON.parse(row.value) as AccessRequest).status)
    } catch {}
  }
  for (const m of members || []) map.set(m.user_id, 'member')
  return map
}

export async function statusOf(userId: string): Promise<AccessStatus> {
  const { data: member } = await supabaseAdmin.from('chat_members').select('user_id').eq('user_id', userId).maybeSingle()
  if (member) return 'member'
  return (await readRequest(userId))?.status ?? null
}

/** Nuova richiesta dell'utente: salvata e notificata agli admin (al massimo una volta l'ora). */
export async function requestAccess(userId: string, email: string): Promise<AccessStatus> {
  if ((await statusOf(userId)) === 'member') return 'member'
  const previous = await readRequest(userId)
  const recent = previous?.status === 'pending' && Date.now() - new Date(previous.requestedAt).getTime() < NOTIFY_AGAIN_MS
  await writeRequest(userId, { email, requestedAt: recent ? previous!.requestedAt : new Date().toISOString(), status: 'pending' })
  if (recent) return 'pending'

  const approve = actionLink(userId, 'approve')
  const reject = actionLink(userId, 'reject')
  await Promise.allSettled([
    sendPushToAdmins({
      title: 'Richiesta di accesso alla chat AI',
      body: `${email} chiede di usare la chat interna. Apri per approvare.`,
      url: '/admin',
      tag: `chat-access:${userId}`,
    }),
    sendEmail({
      to: [...ADMIN_EMAILS],
      subject: `Richiesta di accesso alla chat AI: ${email}`,
      text: `${email} ha chiesto di usare la chat AI interna di Facevoice.\n\nApprova: ${approve}\nRifiuta: ${reject}\n\nPuoi farlo anche da ${SITE_URL}/admin`,
      html: emailLayout(`
<p><strong>${escapeHtml(email)}</strong> ha chiesto di usare la <strong>chat AI interna</strong> di Facevoice.</p>
<p>
  <a href="${approve}" style="display:inline-block;background:#1f8f4e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px;">Approva</a>
  <a href="${reject}" style="display:inline-block;background:#b3261e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Rifiuta</a>
</p>
<p style="color:#666;font-size:13px;">Puoi farlo anche dal <a href="${SITE_URL}/admin">pannello admin</a>. I link scadono tra 7 giorni.</p>`),
    }),
  ])
  return 'pending'
}

/** Abilita l'utente alla chat interna (dipendente, 20 $ al mese) e gli manda l'email di benvenuto. */
export async function approveAccess(userId: string): Promise<{ email: string } | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  const email = data?.user?.email?.toLowerCase()
  if (error || !email) return null
  const { data: existing } = await supabaseAdmin.from('chat_members').select('user_id').eq('user_id', userId).maybeSingle()
  if (!existing) {
    const { error: insertError } = await supabaseAdmin
      .from('chat_members')
      .insert({ user_id: userId, email, role: 'employee', monthly_limit_usd: 20, is_active: true })
    if (insertError) throw insertError
    await sendWelcomeEmail(email, null)
  }
  await writeRequest(userId, null)
  return { email }
}

export async function rejectAccess(userId: string) {
  const previous = await readRequest(userId)
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
  await writeRequest(userId, { email: previous?.email || data?.user?.email || '', requestedAt: previous?.requestedAt || new Date().toISOString(), status: 'rejected' })
}

export async function sendWelcomeEmail(email: string, displayName: string | null) {
  const greeting = displayName ? `Ciao ${displayName},` : 'Ciao,'
  const chatUrl = `${SITE_URL}/ai-chat`

  return sendEmail({
    to: email,
    subject: 'Sei stato abilitato alla chat AI di Facevoice',
    text: [
      greeting,
      '',
      'il tuo account è stato abilitato alla chat AI interna di Facevoice AI.',
      `Puoi iniziare subito da qui: ${chatUrl}`,
      '',
      'Accedi con questo indirizzo email e la password del tuo account.',
      '',
      "Importante: le informazioni che condividi nella chat potranno essere utilizzate per migliorare il modello e perfezionare l'AI aziendale. Evita di inserire dati personali sensibili non necessari.",
      '',
      'Se trovi un problema o vuoi proporre una modifica, usa il pulsante "Segnala un problema" dentro la chat.',
    ].join('\n'),
    html: emailLayout(`
<p>${escapeHtml(greeting)}</p>
<p>il tuo account è stato abilitato alla <strong>chat AI interna di Facevoice AI</strong>.</p>
<p><a href="${chatUrl}" style="display: inline-block; background: #0b1f3a; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none;">Apri la chat</a></p>
<p>Accedi con questo indirizzo email e la password del tuo account.</p>
<div style="background: #fff8e1; border-left: 4px solid #f2b705; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
  <strong>Importante:</strong> le informazioni che condividi nella chat potranno essere utilizzate per migliorare il modello e perfezionare l'AI aziendale. Evita di inserire dati personali sensibili non necessari.
</div>
<p>Se trovi un problema o vuoi proporre una modifica, usa il pulsante <em>Segnala un problema</em> dentro la chat.</p>`),
  })
}

// ---------------------------------------------------------------------
// Modelli AI disattivati per singolo utente (di base tutti attivi)
// ---------------------------------------------------------------------

const MODELS_PREFIX = 'chat_models_disabled:'

export async function getDisabledModels(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', MODELS_PREFIX + userId).maybeSingle()
  try {
    const list = data?.value ? JSON.parse(data.value) : []
    return Array.isArray(list) ? list.filter((m): m is string => typeof m === 'string') : []
  } catch {
    return []
  }
}

export async function setDisabledModels(userId: string, models: string[]) {
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: MODELS_PREFIX + userId, value: JSON.stringify([...new Set(models)]), updated_at: new Date().toISOString() })
}

export async function allDisabledModels(): Promise<Map<string, string[]>> {
  const { data } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${MODELS_PREFIX}%`)
  const map = new Map<string, string[]>()
  for (const row of data || []) {
    try {
      map.set(row.key.slice(MODELS_PREFIX.length), JSON.parse(row.value))
    } catch {}
  }
  return map
}

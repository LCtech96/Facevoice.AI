import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { loginCodeHash, newLoginCode, newNonce, sameLoginCodeHash, type readPending } from '@/lib/todo-auth'
import { accessById, maskEmail, type AccessRow } from '@/lib/todo-access'

// Secondo passaggio dell'entrata nella pagina generale: dopo nome e password giusti
// parte per email un codice di 6 cifre (valido 10 minuti, una volta sola). Si salva
// solo l'impronta del codice, con scadenza e tentativi, in app_settings. Al massimo 5
// codici sbagliati (poi il codice si brucia e si ricomincia dalla password), un nuovo
// invio ogni 60 secondi e al massimo 4 invii (il primo + 3) ogni 15 minuti per persona.
// Password cambiata, accesso eliminato o email cambiata: il codice non vale piu'.

export const CODE_TTL_MS = 10 * 60_000
export const CODE_MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60_000
export const SEND_WINDOW_MS = 15 * 60_000
export const MAX_SENDS_PER_WINDOW = 4

export const NO_EMAIL_MESSAGE = 'Per entrare serve la verifica via email: chiedi all’admin di aggiungere la tua email.'
export const SEND_FAILED_MESSAGE = 'Non riusciamo a inviare il codice in questo momento, riprova tra poco.'
export const RESTART_MESSAGE = 'Il codice non è più valido: rientra con nome e password.'
export const EXPIRED_MESSAGE = 'Il codice è scaduto: rientra con nome e password per riceverne uno nuovo.'
export const BURNED_MESSAGE = 'Troppi codici sbagliati: rientra con nome e password per riceverne uno nuovo.'
export const WRONG_CODE_MESSAGE = 'Codice non corretto.'

const KEY = 'todo_login_codes'

type CodeEntry = { access_id: string; nonce: string; hash: string; version: number; email: string; exp: number; attempts: number; sent_at: number }
type Send = { access_id: string; t: number }
type CodeStore = { codes: CodeEntry[]; sends: Send[] }

type Pending = NonNullable<ReturnType<typeof readPending>>

function parse(raw: string | null): CodeStore {
  try {
    const v = raw ? JSON.parse(raw) : null
    return {
      codes: Array.isArray(v?.codes) ? v.codes.filter((c: CodeEntry) => c && typeof c.access_id === 'string' && typeof c.hash === 'string') : [],
      sends: Array.isArray(v?.sends) ? v.sends.filter((x: Send) => x && typeof x.access_id === 'string' && Number.isFinite(x.t)) : [],
    }
  } catch {
    return { codes: [], sends: [] }
  }
}

/** Solo il necessario: codici non scaduti, invii degli ultimi 15 minuti. */
const prune = (s: CodeStore, at: number): CodeStore => ({
  codes: s.codes.filter((c) => c.exp > at).slice(-500),
  sends: s.sends.filter((x) => x.t > at - SEND_WINDOW_MS).slice(-2000),
})

export function codeEmail(code: string) {
  const line = `Il tuo codice per entrare nella Todo di Facevoice AI: ${code} — scade tra 10 minuti. Se non sei stato tu, ignora questa email.`
  return {
    subject: `${code} è il tuo codice per la Todo di Facevoice AI`,
    text: line,
    html: emailLayout(`
<p>Il tuo codice per entrare nella Todo di Facevoice AI:</p>
<p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${escapeHtml(code)}</p>
<p>Scade tra 10 minuti. Se non sei stato tu, ignora questa email.</p>`),
  }
}

async function deliver(email: string, code: string): Promise<boolean> {
  try {
    const ok = await sendEmail({ to: email, ...codeEmail(code) })
    if (!ok) console.error('todo: codice di entrata non inviato')
    return ok
  } catch (error) {
    console.error('todo: codice di entrata non inviato', error instanceof Error ? error.message.slice(0, 160) : 'errore')
    return false
  }
}

export type StartResult =
  | { ok: true; nonce: string; email: string; reused: boolean; resendIn: number }
  | { ok: false; status: number; error: string; noEmail?: boolean }

const waitMinutes = (sends: Send[], at: number) => Math.max(1, Math.ceil((sends[0].t + SEND_WINDOW_MS - at) / 60_000))
const tooManySends = (minutes: number) => `Hai chiesto troppi codici. Riprova tra ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}.`
const secondsLeft = (sentAt: number, at: number) => Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_MS - at) / 1000))

/**
 * Password giusta: manda il codice (o riusa quello appena mandato, se e' di meno di 60
 * secondi fa) e da' il «nonce» da mettere nel cookie di attesa.
 */
export async function startLogin(access: AccessRow, at = Date.now()): Promise<StartResult> {
  if (!access.email) return { ok: false, status: 403, error: NO_EMAIL_MESSAGE, noEmail: true }
  const email = access.email
  const nonce = newNonce()
  const code = newLoginCode()
  const hash = loginCodeHash(access.id, nonce, code)
  if (!hash) return { ok: false, status: 503, error: 'Pagina non disponibile in questo momento.' }
  let outcome: StartResult | null = null
  await updateSetting(KEY, parse, (raw) => {
    const cur = prune(raw, at)
    const live = cur.codes.find((c) => c.access_id === access.id && c.version === access.session_version && c.email === email && c.attempts < CODE_MAX_ATTEMPTS)
    if (live && at - live.sent_at < RESEND_COOLDOWN_MS) {
      outcome = { ok: true, nonce: live.nonce, email, reused: true, resendIn: secondsLeft(live.sent_at, at) }
      return false
    }
    const mine = cur.sends.filter((x) => x.access_id === access.id)
    if (mine.length >= MAX_SENDS_PER_WINDOW) {
      outcome = { ok: false, status: 429, error: tooManySends(waitMinutes(mine, at)) }
      return false
    }
    outcome = { ok: true, nonce, email, reused: false, resendIn: Math.ceil(RESEND_COOLDOWN_MS / 1000) }
    const entry: CodeEntry = { access_id: access.id, nonce, hash, version: access.session_version, email, exp: at + CODE_TTL_MS, attempts: 0, sent_at: at }
    // Un solo codice valido per persona: quello nuovo sostituisce i precedenti.
    return { codes: [...cur.codes.filter((c) => c.access_id !== access.id), entry], sends: [...cur.sends, { access_id: access.id, t: at }] }
  })
  const result = outcome as StartResult | null
  if (!result) return { ok: false, status: 500, error: 'Qualcosa non è andato: riprova.' }
  if (!result.ok || result.reused) return result
  if (await deliver(email, code)) return result
  // Email non partita: il codice si cancella (nessuno lo conosce) e l'invio non conta.
  await updateSetting(KEY, parse, (cur) => ({
    codes: cur.codes.filter((c) => !(c.access_id === access.id && c.nonce === nonce)),
    sends: cur.sends.filter((x) => !(x.access_id === access.id && x.t === at)),
  })).catch(() => undefined)
  return { ok: false, status: 503, error: SEND_FAILED_MESSAGE }
}

export type ResendResult = { ok: true; resendIn: number } | { ok: false; status: number; error: string; restart?: boolean; resendIn?: number }

/** «Invia di nuovo il codice»: codice nuovo (quello di prima non vale piu'), 10 minuti nuovi, tentativi azzerati. */
export async function resendCode(pending: Pending, access: AccessRow, at = Date.now()): Promise<ResendResult> {
  if (!access.email) return { ok: false, status: 403, error: NO_EMAIL_MESSAGE, restart: true }
  const email = access.email
  const code = newLoginCode()
  const hash = loginCodeHash(access.id, pending.nonce, code)
  if (!hash) return { ok: false, status: 503, error: 'Pagina non disponibile in questo momento.' }
  let outcome: ResendResult | null = null
  let previous: CodeEntry | null = null
  await updateSetting(KEY, parse, (raw) => {
    const cur = prune(raw, at)
    previous = null
    const entry = cur.codes.find((c) => c.access_id === access.id && c.nonce === pending.nonce)
    if (!entry || entry.version !== access.session_version || entry.email !== email || entry.attempts >= CODE_MAX_ATTEMPTS) {
      outcome = { ok: false, status: 401, error: entry ? RESTART_MESSAGE : EXPIRED_MESSAGE, restart: true }
      return false
    }
    if (at - entry.sent_at < RESEND_COOLDOWN_MS) {
      const s = secondsLeft(entry.sent_at, at)
      outcome = { ok: false, status: 429, error: `Aspetta ${s} secondi prima di chiedere un altro codice.`, resendIn: s }
      return false
    }
    const mine = cur.sends.filter((x) => x.access_id === access.id)
    if (mine.length >= MAX_SENDS_PER_WINDOW) {
      outcome = { ok: false, status: 429, error: tooManySends(waitMinutes(mine, at)) }
      return false
    }
    previous = entry
    outcome = { ok: true, resendIn: Math.ceil(RESEND_COOLDOWN_MS / 1000) }
    const next: CodeEntry = { ...entry, hash, exp: at + CODE_TTL_MS, attempts: 0, sent_at: at }
    return { codes: cur.codes.map((c) => (c === entry ? next : c)), sends: [...cur.sends, { access_id: access.id, t: at }] }
  })
  const result = outcome as ResendResult | null
  if (!result) return { ok: false, status: 500, error: 'Qualcosa non è andato: riprova.' }
  if (!result.ok) return result
  if (await deliver(email, code)) return result
  // Email non partita: torna valido il codice di prima (se nel frattempo nessuno l'ha cambiato).
  const before = previous as CodeEntry | null
  await updateSetting(KEY, parse, (cur) => ({
    codes: cur.codes.map((c) => (before && c.access_id === access.id && c.nonce === pending.nonce && c.hash === hash ? before : c)),
    sends: cur.sends.filter((x) => !(x.access_id === access.id && x.t === at)),
  })).catch(() => undefined)
  return { ok: false, status: 503, error: SEND_FAILED_MESSAGE }
}

export type VerifyResult = { ok: true } | { ok: false; status: number; error: string; restart?: boolean; left?: number }

/** Codice scritto dalla persona: giusto -> si consuma (una volta sola); sbagliato -> un tentativo in meno. */
export async function verifyCode(pending: Pending, access: AccessRow, rawCode: unknown, at = Date.now()): Promise<VerifyResult> {
  const code = typeof rawCode === 'string' ? rawCode.replace(/[\s-]/g, '') : ''
  if (!/^\d{6}$/.test(code)) return { ok: false, status: 400, error: 'Scrivi il codice di 6 cifre che hai ricevuto per email.' }
  const hash = loginCodeHash(access.id, pending.nonce, code)
  if (!hash) return { ok: false, status: 503, error: 'Pagina non disponibile in questo momento.' }
  let outcome: VerifyResult | null = null
  await updateSetting(KEY, parse, (raw) => {
    const cur: CodeStore = { codes: raw.codes, sends: raw.sends.filter((x) => x.t > at - SEND_WINDOW_MS) }
    const entry = cur.codes.find((c) => c.access_id === access.id && c.nonce === pending.nonce)
    const drop = () => ({ ...cur, codes: cur.codes.filter((c) => c !== entry) })
    if (!entry) {
      outcome = { ok: false, status: 401, error: EXPIRED_MESSAGE, restart: true }
      return false
    }
    if (entry.version !== access.session_version || entry.version !== pending.version || entry.email !== access.email) {
      outcome = { ok: false, status: 401, error: RESTART_MESSAGE, restart: true }
      return drop()
    }
    if (entry.exp <= at) {
      outcome = { ok: false, status: 401, error: EXPIRED_MESSAGE, restart: true }
      return drop()
    }
    if (entry.attempts >= CODE_MAX_ATTEMPTS) {
      outcome = { ok: false, status: 401, error: BURNED_MESSAGE, restart: true }
      return drop()
    }
    if (sameLoginCodeHash(entry.hash, hash)) {
      outcome = { ok: true }
      return drop()
    }
    const attempts = entry.attempts + 1
    if (attempts >= CODE_MAX_ATTEMPTS) {
      outcome = { ok: false, status: 401, error: BURNED_MESSAGE, restart: true }
      return drop()
    }
    outcome = { ok: false, status: 401, error: WRONG_CODE_MESSAGE, left: CODE_MAX_ATTEMPTS - attempts }
    return { ...cur, codes: cur.codes.map((c) => (c === entry ? { ...c, attempts } : c)) }
  })
  return (outcome as VerifyResult | null) || { ok: false, status: 500, error: 'Qualcosa non è andato: riprova.' }
}

/** Codici di una persona da buttare (password cambiata, accesso eliminato, email cambiata). */
export async function clearCodes(accessId: string): Promise<void> {
  await updateSetting(KEY, parse, (cur) => (cur.codes.some((c) => c.access_id === accessId) ? { ...cur, codes: cur.codes.filter((c) => c.access_id !== accessId) } : false)).catch(() => undefined)
}

/**
 * Persona in attesa del codice (cookie di attesa valido, codice ancora vivo), per
 * mostrare subito il riquadro del codice anche dopo aver ricaricato la pagina.
 */
export async function pendingLogin(pending: Pending | null, at = Date.now()): Promise<{ access: AccessRow; maskedEmail: string; resendIn: number } | null> {
  if (!pending) return null
  const access = await accessById(pending.id)
  if (!access || access.session_version !== pending.version || !access.email) return null
  const entry = parse((await readSetting(KEY)).value).codes.find((c) => c.access_id === access.id && c.nonce === pending.nonce)
  if (!entry || entry.exp <= at || entry.attempts >= CODE_MAX_ATTEMPTS || entry.version !== access.session_version || entry.email !== access.email) return null
  return { access, maskedEmail: maskEmail(access.email), resendIn: secondsLeft(entry.sent_at, at) }
}

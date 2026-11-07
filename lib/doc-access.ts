import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminEmail } from '@/lib/admin-auth'

// Accesso ai PDF dei documenti della super chat da una scheda nuova del browser
// ("Apri PDF"), dove non si puo' mandare il token di accesso: la pagina chiede un
// cookie firmato (HttpOnly, SameSite=Strict, valido solo per la route dei
// documenti, 1 ora, rinnovato al clic su "Apri PDF"/"Scarica") e a ogni apertura si
// ricontrolla che quell'utente sia ancora l'amministratore. All'uscita dall'account il
// cookie si cancella (DELETE sulla route di accesso), cosi' su un browser condiviso
// i contratti non si riaprono dalla cronologia. Nessun link pubblico.

export const DOC_COOKIE = 'fv_docs'
export const DOC_COOKIE_PATH = '/api/admin/assistant/documents'
export const DOC_COOKIE_TTL_S = 3600

function key(): Buffer | null {
  const base = (process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  return base ? createHmac('sha256', base).update('assistant-docs-cookie').digest() : null
}

const sign = (secret: Buffer, userId: string, exp: number) => createHmac('sha256', secret).update(`${userId}.${exp}`).digest('base64url')

/** Valore del cookie per l'utente (null se il server non ha una chiave per firmare). */
export function signDocAccess(userId: string, now = Date.now()): string | null {
  const secret = key()
  if (!secret || !/^[\w-]{8,64}$/.test(userId)) return null
  const exp = Math.floor(now / 1000) + DOC_COOKIE_TTL_S
  return `${userId}.${exp}.${sign(secret, userId, exp)}`
}

/** Cookie valido, non scaduto, e l'utente e' ancora l'amministratore. */
export async function verifyDocAccess(value: string | undefined | null, now = Date.now()): Promise<boolean> {
  const secret = key()
  if (!secret || !value) return false
  const [userId, expText, sig] = value.split('.')
  const exp = Number(expText)
  if (!userId || !sig || !/^[\w-]{8,64}$/.test(userId) || !Number.isFinite(exp) || exp * 1000 < now) return false
  const expected = Buffer.from(sign(secret, userId, exp))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
    return isAdminEmail(data.user?.email)
  } catch {
    return false
  }
}

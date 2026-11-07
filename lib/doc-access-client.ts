// Lato browser: cookie per aprire i PDF dei documenti della super chat in una scheda
// nuova (vedi lib/doc-access.ts). Si chiede quando compare la scheda del documento e
// si rinnova al clic se e' vecchio; all'uscita dall'account si cancella.

export const DOC_ACCESS_API = '/api/admin/assistant/documents/access'
/** Il cookie dura un'ora sul server: dopo mezz'ora il clic lo rinnova prima di aprire. */
const FRESH_MS = 30 * 60_000

type Grant = { at: number; ok: boolean | null; promise: Promise<boolean> }
let grant: Grant | null = null

/** Cookie ottenuto da poco: il link si puo' aprire subito, senza rinnovarlo. */
export function docAccessFresh(now = Date.now()): boolean {
  return Boolean(grant && grant.ok === true && now - grant.at < FRESH_MS)
}

/** Chiede (o rinnova) il cookie. request: la POST con il token dell'amministratore. */
export function ensureDocAccess(request: () => Promise<Response>, options: { force?: boolean } = {}): Promise<boolean> {
  if (grant && (grant.ok === null || (!options.force && docAccessFresh()))) return grant.promise
  const current: Grant = { at: Date.now(), ok: null, promise: Promise.resolve(false) }
  current.promise = request()
    .then((res) => res.ok)
    .catch(() => false)
    .then((ok) => {
      current.ok = ok
      if (!ok && grant === current) grant = null
      return ok
    })
  grant = current
  return current.promise
}

/** Uscita dall'account: il cookie non resta valido su un browser condiviso. */
export async function clearDocAccess(): Promise<void> {
  grant = null
  try {
    await fetch(DOC_ACCESS_API, { method: 'DELETE', credentials: 'same-origin', keepalive: true })
  } catch {}
}

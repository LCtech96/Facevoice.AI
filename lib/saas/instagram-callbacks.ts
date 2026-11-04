import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { workspaceDb } from '@/lib/workspace-db'
import { connectionForAccount } from './meta'
import { connectionOwner, deleteConnection, listConnections, setChannelState, updateConnection } from './connections'

// Chiamate di Meta quando una persona toglie l'accesso all'app dal suo
// Instagram (rimozione dell'autorizzazione) o chiede di cancellare i dati.
// Arrivano come "signed_request" firmato con la chiave dell'app.

type SignedPayload = { user_id?: string | number; algorithm?: string; issued_at?: number }

export function parseSignedRequest(signed: string | null): SignedPayload | null {
  if (!signed || !signed.includes('.')) return null
  const [sig, body] = signed.split('.', 2)
  const secrets = [process.env.INSTAGRAM_APP_SECRET, process.env.META_APP_SECRET].map((s) => s?.trim()).filter(Boolean) as string[]
  const received = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const valid = secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(body).digest()
    return expected.length === received.length && timingSafeEqual(expected, received)
  })
  if (!valid) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload
    return payload.algorithm && payload.algorithm.toUpperCase() !== 'HMAC-SHA256' ? null : payload
  } catch {
    return null
  }
}

/** Accesso tolto dall'utente: il collegamento resta visibile ma non e' piu' attivo. */
export async function deauthorizeInstagram(userId: string): Promise<boolean> {
  const connection = await connectionForAccount('instagram', userId)
  if (!connection) return false
  const db = workspaceDb(connection.workspace_id)
  await updateConnection(db, connection.id, { status: 'disconnected', last_error: 'Accesso tolto da Instagram: ricollega l’account.' })
  const others = (await listConnections(db, 'instagram')).filter((c) => c.id !== connection.id && c.status !== 'disconnected')
  if (!others.length) await setChannelState(db, 'instagram', { status: 'not_connected', handle: null })
  return true
}

/** Cancellazione richiesta: collegamento, credenziali e messaggi di quell'account. */
export async function deleteInstagramData(userId: string): Promise<string> {
  const code = `IG${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase()
  // Anche se l'accesso era gia' stato tolto (collegamento "disconnected").
  const workspaceId = await connectionOwner('instagram', userId).catch(() => null)
  const db = workspaceId ? workspaceDb(workspaceId) : null
  const connection = db ? (await listConnections(db, 'instagram')).find((c) => c.external_id === userId) : null
  if (db && connection) {
    const { error } = await db.from('social_messages').delete().eq('platform', 'instagram').eq('channel_account_id', userId)
    if (error) console.error('instagram data deletion (messaggi):', error.message)
    await deleteConnection(db, connection.id)
    const others = (await listConnections(db, 'instagram')).filter((c) => c.status !== 'disconnected')
    if (!others.length) await setChannelState(db, 'instagram', { status: 'not_connected', handle: null })
  }
  console.log(`instagram data deletion ${code}: ${connection ? 'dati cancellati' : 'nessun dato trovato'}`)
  return code
}

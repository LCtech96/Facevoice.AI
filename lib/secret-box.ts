import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// Cifratura delle credenziali dei clienti (token Meta, password IMAP...) prima
// di salvarle nel database. La chiave sta solo nelle variabili d'ambiente di
// Vercel (CHANNEL_SECRETS_KEY, 32 byte in base64): chi legge il database senza
// la chiave vede solo testo cifrato. AES-256-GCM, formato "v1.iv.tag.dati".

function key(): Buffer {
  const raw = process.env.CHANNEL_SECRETS_KEY?.trim()
  if (!raw) throw new Error('CHANNEL_SECRETS_KEY mancante: impossibile salvare o leggere le credenziali dei canali')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('CHANNEL_SECRETS_KEY non valida: servono 32 byte in base64')
  return buf
}

export function sealSecret(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function openSecret<T = unknown>(sealed: string): T {
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('credenziale cifrata in un formato sconosciuto')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as T
}

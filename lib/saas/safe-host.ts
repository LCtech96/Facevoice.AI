import { lookup } from 'dns/promises'
import { isIP } from 'net'

// Il cliente puo' indicare un server di posta qualsiasi: prima di collegarsi si
// controlla che sia un nome pubblico e che non punti a indirizzi interni
// (localhost, rete privata, metadati del cloud).

function isPrivate(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase()
    if (a === '::1' || a === '::') return true
    if (a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivate(mapped[1]) : false
  }
  const [a, b] = address.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

export async function assertPublicHost(host: string): Promise<void> {
  const clean = host.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(clean)) {
    throw new Error(`"${host}" non è un indirizzo di server valido.`)
  }
  const addresses = await lookup(clean, { all: true }).catch(() => [])
  if (!addresses.length) throw new Error(`Il server "${host}" non esiste o non risponde.`)
  if (addresses.some((a) => isPrivate(a.address))) throw new Error(`Il server "${host}" non è raggiungibile.`)
}

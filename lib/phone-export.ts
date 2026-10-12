// Esportazione dei numeri della Ricerca clienti (CSV per Excel/Numbers,
// vCard per importarli nei Contatti del telefono). Solo lato browser.

export type PhoneRow = {
  name: string
  phone: string
  status: string
  calledAt: string | null
  address: string | null
  search: string | null
}

export type ExportEntry = PhoneRow & { number: string; mobile: boolean }

/** "+39 333 123 4567" -> "+393331234567"; i numeri italiani senza prefisso lo ricevono. */
export function normalizePhone(raw: string): string | null {
  let n = raw.replace(/[^\d+]/g, '')
  if (n.startsWith('00')) n = `+${n.slice(2)}`
  if (!n.startsWith('+')) n = n.startsWith('39') && n.length >= 11 ? `+${n}` : `+39${n}`
  return n.length >= 8 ? n : null
}

/** Cellulare italiano: dopo +39 inizia con 3 (i fissi iniziano con 0). Esteri: non distinguibili, contano come fissi. */
export function isMobile(normalized: string) {
  return /^\+393\d{8,9}$/.test(normalized)
}

/** Numero leggibile: "+39 333 123 4567" / "+39 091 123456". */
export function prettyPhone(normalized: string) {
  const m = normalized.match(/^\+39(3\d{2})(\d{3})(\d{3,4})$/)
  if (m) return `+39 ${m[1]} ${m[2]} ${m[3]}`
  return normalized.startsWith('+39') ? `+39 ${normalized.slice(3)}` : normalized
}

/** Un numero per riga, senza doppioni (piu' schede con lo stesso numero = una sola). */
export function collectPhones(rows: PhoneRow[], onlyMobile: boolean): ExportEntry[] {
  const seen = new Map<string, ExportEntry>()
  for (const row of rows) {
    const number = normalizePhone(row.phone)
    if (!number || seen.has(number)) continue
    const mobile = isMobile(number)
    if (onlyMobile && !mobile) continue
    seen.set(number, { ...row, number, mobile })
  }
  return [...seen.values()].sort((a, b) => Number(b.mobile) - Number(a.mobile) || a.name.localeCompare(b.name, 'it'))
}

const csvCell = (value: string) => (/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/** CSV con ";" (Excel in italiano) e BOM per gli accenti. */
export function toCsv(entries: ExportEntry[], statusLabel: (s: string) => string) {
  const header = ['Nome', 'Telefono', 'Tipo', 'Stato', 'Chiamato', 'Indirizzo', 'Ricerca']
  const lines = entries.map((e) =>
    [
      e.name,
      prettyPhone(e.number),
      e.mobile ? 'Cellulare' : 'Fisso',
      statusLabel(e.status),
      e.calledAt ? new Date(e.calledAt).toLocaleDateString('it-IT') : '',
      e.address || '',
      e.search || '',
    ]
      .map(csvCell)
      .join(';')
  )
  return `\uFEFF${[header.join(';'), ...lines].join('\r\n')}\r\n`
}

const vcfText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** vCard 3.0: si importa nei Contatti di iPhone/Android (poi i numeri compaiono anche su WhatsApp). */
export function toVcf(entries: ExportEntry[], statusLabel: (s: string) => string) {
  return entries
    .map((e) =>
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:;${vcfText(e.name)};;;`,
        `FN:${vcfText(e.name)}`,
        `ORG:${vcfText(e.name)}`,
        `TEL;TYPE=${e.mobile ? 'CELL' : 'WORK'}:${e.number}`,
        e.address ? `ADR;TYPE=WORK:;;${vcfText(e.address)};;;;` : '',
        `NOTE:${vcfText(`Ricerca clienti Facevoice · ${statusLabel(e.status)}${e.search ? ` · ${e.search}` : ''}`)}`,
        'END:VCARD',
      ]
        .filter(Boolean)
        .join('\r\n')
    )
    .join('\r\n')
}

/**
 * Salva il file. Sul telefono apre il menu Condividi (Salva in File, WhatsApp, Mail…),
 * che funziona anche dall'app installata; sul computer lo scarica.
 */
export async function saveFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  if (touch && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return
      } catch (error) {
        // Condivisione annullata dall'utente: non serve scaricare.
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

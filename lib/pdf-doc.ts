import { createHash } from 'crypto'

// PDF semplice e valido (PDF 1.4) senza librerie: pagine A4, font standard Helvetica e
// Helvetica-Bold (Type1, WinAnsiEncoding, non incorporati: li ha ogni lettore PDF),
// testo a capo con le larghezze vere dei caratteri (tabella AFM per i codici WinAnsi),
// salti di pagina automatici (un titolo non resta mai da solo in fondo alla pagina),
// "Pagina N di M" e un avviso breve in fondo a ogni pagina. Usato dai documenti
// dell'Assistente (contratti, preventivi, lettere: lib/saas/documents.ts).
// Il file e' tutto ASCII: i caratteri accentati vanno nei testi come \ooo (codici WinAnsi),
// cosi' le posizioni nella tabella xref sono sempre giuste.

export type PdfSection = { heading?: string; paragraphs: string[]; bullets?: string[] }
export type PdfSignature = { label: string; name?: string }
export type PdfDocument = {
  title: string
  subtitle?: string
  /** Righe sotto il titolo (data, parti...). */
  meta?: string[]
  sections: PdfSection[]
  signatures?: PdfSignature[]
  /** Nota finale dopo le sezioni (es. da dove viene il documento). */
  closing?: string
  /** Avviso breve in fondo a ogni pagina. */
  footer: string
  /** Metadati del file. */
  info?: { title?: string; subject?: string; createdAt?: Date }
}

// --- Caratteri: Unicode -> WinAnsi ------------------------------------------------------------

/** Codici WinAnsi 0x80-0x9F (gli altri da 0xA0 a 0xFF sono uguali a Latin-1). */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

/** Caratteri senza posto in WinAnsi: equivalente ASCII vicino. */
const FALLBACK: Record<number, string> = {
  0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2212: '-', 0x2043: '-', 0x2044: '/',
  0x2032: "'", 0x2035: "'", 0x201b: "'", 0x02bc: "'", 0x02b9: "'",
  0x2033: '"', 0x201f: '"', 0x02ba: '"',
  0x2190: '<-', 0x2192: '->', 0x2194: '<->', 0x21d2: '=>', 0x2264: '<=', 0x2265: '>=', 0x2260: '!=', 0x2248: '~',
  0x2713: 'v', 0x2714: 'v', 0x2717: 'x', 0x2718: 'x', 0x25cf: '•', 0x25aa: '•', 0x25e6: '•', 0x2023: '•',
  0x2116: 'N.', 0x2153: '1/3', 0x2154: '2/3',
  // Lettere che non si scompongono in lettera + segno.
  0x0141: 'L', 0x0142: 'l', 0x0110: 'D', 0x0111: 'd', 0x0131: 'i', 0x0126: 'H', 0x0127: 'h', 0x0166: 'T', 0x0167: 't',
}

/** Spazi "strani" (stretti, fissi, ideografici) e caratteri invisibili. */
const isSpace = (cp: number) => (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0x1680
const isInvisible = (cp: number) => (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x00ad

/** Codice WinAnsi di un carattere, oppure null. */
function winAnsiCode(cp: number): number | null {
  if (cp >= 0x20 && cp <= 0x7e) return cp
  if (cp >= 0xa0 && cp <= 0xff) return cp
  return WIN_ANSI_HIGH[cp] ?? null
}

/**
 * Testo -> stringa di codici WinAnsi (un carattere JS per byte, 0-255). Le lettere
 * italiane (à è é ì ò ù), €, virgolette curve, trattini e « » restano quelle; il resto
 * diventa un equivalente ASCII vicino (senza accenti), emoji e simboli spariscono, mai
 * byte rotti. "\n" resta (a capo); tabulazioni -> spazio; altri caratteri di controllo via.
 */
export function toWinAnsi(input: string): string {
  let out = ''
  for (const ch of String(input ?? '').normalize('NFC')) {
    const cp = ch.codePointAt(0) as number
    if (cp === 0x0a) {
      out += '\n'
      continue
    }
    if (cp === 0x09) {
      out += ' '
      continue
    }
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue
    const code = winAnsiCode(cp)
    if (code !== null) {
      out += String.fromCharCode(code)
      continue
    }
    if (isSpace(cp)) {
      out += ' '
      continue
    }
    if (isInvisible(cp)) continue
    const fallback = FALLBACK[cp]
    if (fallback !== undefined) {
      out += toWinAnsi(fallback)
      continue
    }
    // Lettere con segni (ă, ł, ç̌...): la lettera senza segni, se esiste in WinAnsi.
    const bare = ch.normalize('NFKD').replace(/\p{M}+/gu, '')
    if (bare && bare !== ch && [...bare].every((c) => winAnsiCode(c.codePointAt(0) as number) !== null)) {
      out += [...bare].map((c) => String.fromCharCode(winAnsiCode(c.codePointAt(0) as number) as number)).join('')
      continue
    }
    // Emoji, pittogrammi e simboli decorativi: niente. Altre lettere (alfabeti diversi): "?".
    if (/[\p{Extended_Pictographic}\p{So}\p{Sk}\p{M}]/u.test(ch)) continue
    out += '?'
  }
  return out
}

// --- Larghezze dei caratteri (AFM, unita' su 1000) per i codici WinAnsi 32-255 --------------------

const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
]
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 350,
  556, 350, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
]

type FontKey = 'F1' | 'F2'
const WIDTHS: Record<FontKey, number[]> = { F1: HELVETICA_WIDTHS, F2: HELVETICA_BOLD_WIDTHS }

/** Larghezza in punti di un testo gia' in WinAnsi. */
export function textWidth(winAnsi: string, font: FontKey, size: number): number {
  const table = WIDTHS[font]
  let units = 0
  for (let i = 0; i < winAnsi.length; i++) {
    const code = winAnsi.charCodeAt(i)
    if (code >= 32 && code <= 255) units += table[code - 32]
  }
  return (units * size) / 1000
}

/** A capo per parole (testo gia' in WinAnsi): le parole piu' lunghe della riga si spezzano. */
export function wrapText(winAnsi: string, font: FontKey, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const hard of winAnsi.split('\n')) {
    const words = hard.split(/ +/).filter((w) => w !== '')
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, font, size) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      // Parola troppo lunga per una riga (es. un indirizzo web): si spezza dove serve.
      while (textWidth(word, font, size) > maxWidth) {
        let cut = 1
        while (cut < word.length && textWidth(word.slice(0, cut + 1), font, size) <= maxWidth) cut++
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      line = word
    }
    if (line) lines.push(line)
  }
  return lines
}

// --- Impaginazione -------------------------------------------------------------------------------

/** A4 in punti. */
export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89
const MARGIN_X = 62
const MARGIN_TOP = 64
/** Sotto questa altezza (dal basso) c'e' il piede della pagina. */
const CONTENT_BOTTOM = 92
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
const BODY_SIZE = 10.5
const BODY_LEADING = 15
const BULLET_INDENT = 14

type Item = { text: string; font: FontKey; size: number; x: number; grey?: boolean }
type Row = { items: Item[]; rule?: boolean }
type Block = { rows: Row[]; leading: number; before: number; keepWithNext?: boolean; keepTogether?: boolean }
type PlacedRow = Row & { baseline: number; leading: number }

function textBlock(text: string, opts: { font?: FontKey; size?: number; leading?: number; before?: number; indent?: number; grey?: boolean; keepWithNext?: boolean; bullet?: boolean }): Block {
  const font = opts.font ?? 'F1'
  const size = opts.size ?? BODY_SIZE
  const indent = opts.indent ?? 0
  const hang = opts.bullet ? BULLET_INDENT : 0
  const lines = wrapText(toWinAnsi(text), font, size, CONTENT_WIDTH - indent - hang)
  const rows: Row[] = lines.map((line, k) => ({
    items: [
      ...(opts.bullet && k === 0 ? [{ text: '\x95', font, size, x: indent, grey: opts.grey }] : []),
      { text: line, font, size, x: indent + hang, grey: opts.grey },
    ],
  }))
  return { rows, leading: opts.leading ?? Math.round(size * 1.42 * 10) / 10, before: opts.before ?? 0, keepWithNext: opts.keepWithNext }
}

function signatureBlock(signatures: PdfSignature[]): Block {
  const rows: Row[] = [{ items: [{ text: toWinAnsi('Firme'), font: 'F2', size: 11.5, x: 0 }] }]
  const columnWidth = (CONTENT_WIDTH - 24) / 2
  const col = (i: number) => i * (columnWidth + 24)
  // Etichette e nomi interi, a capo nella loro colonna (mai tagliati): la riga e' alta quanto la colonna piu' lunga.
  const lines = (text: string, font: FontKey) => (text ? wrapText(toWinAnsi(text), font, 9.5, columnWidth).filter((l) => l !== '') : [])
  const columnRows = (texts: string[][], font: FontKey) => {
    const height = Math.max(0, ...texts.map((t) => t.length))
    for (let r = 0; r < height; r++) {
      rows.push({ items: texts.flatMap((t, i) => (t[r] ? [{ text: t[r], font, size: 9.5, x: col(i) }] : [])) })
    }
  }
  for (let k = 0; k < signatures.length; k += 2) {
    const pair = signatures.slice(k, k + 2)
    rows.push({ items: [] }, { items: [] })
    rows.push({ items: pair.map((_, i) => ({ text: '_'.repeat(Math.floor(columnWidth / textWidth('_', 'F1', 10))), font: 'F1' as FontKey, size: 10, x: col(i) })) })
    columnRows(pair.map((s) => lines(s.label, 'F2')), 'F2')
    columnRows(pair.map((s) => lines(s.name || '', 'F1')), 'F1')
  }
  // keepTogether con l'altezza vera (tutte le righe, anche quelle andate a capo).
  return { rows, leading: 15, before: 18, keepTogether: true }
}

/** Blocchi del documento, nell'ordine. */
function blocksOf(doc: PdfDocument): Block[] {
  const blocks: Block[] = []
  blocks.push(textBlock(doc.title || 'Documento', { font: 'F2', size: 17, leading: 22 }))
  if (doc.subtitle) blocks.push(textBlock(doc.subtitle, { size: 11.5, leading: 16, before: 4, grey: true }))
  for (const [k, line] of (doc.meta || []).entries()) blocks.push(textBlock(line, { size: 10, leading: 14, before: k === 0 ? 10 : 1 }))
  blocks.push({ rows: [{ items: [], rule: true }], leading: 10, before: 8 })
  for (const section of doc.sections) {
    const heading = (section.heading || '').trim()
    if (heading) blocks.push(textBlock(heading, { font: 'F2', size: 12, leading: 16, before: 12, keepWithNext: true }))
    for (const [k, paragraph] of section.paragraphs.entries()) {
      if (paragraph.trim()) blocks.push(textBlock(paragraph.trim(), { before: k === 0 && heading ? 3 : 7, leading: BODY_LEADING }))
    }
    for (const [k, bullet] of (section.bullets || []).entries()) {
      if (bullet.trim()) blocks.push(textBlock(bullet.trim(), { bullet: true, indent: 6, before: k === 0 ? 6 : 2, leading: BODY_LEADING }))
    }
  }
  if (doc.signatures?.length) blocks.push(signatureBlock(doc.signatures))
  if (doc.closing?.trim()) blocks.push(textBlock(doc.closing.trim(), { size: 8.5, leading: 12, before: 22, grey: true }))
  return blocks
}

/** Pagine con le righe gia' al loro posto (baseline in punti dal basso). */
function layout(doc: PdfDocument): PlacedRow[][] {
  const pages: PlacedRow[][] = [[]]
  const top = PAGE_HEIGHT - MARGIN_TOP
  let y = top
  const newPage = () => {
    pages.push([])
    y = top
  }
  const blocks = blocksOf(doc)
  const room = () => y - CONTENT_BOTTOM
  const full = top - CONTENT_BOTTOM
  blocks.forEach((block, index) => {
    const height = block.rows.length * block.leading
    const before = y === top ? 0 : block.before
    if (block.keepTogether && before + height > room() && height <= full) newPage()
    if (block.keepWithNext) {
      // Un titolo resta con almeno le prime due righe di quello che segue.
      const next = blocks[index + 1]
      const following = next ? next.before + Math.min(2, next.rows.length) * next.leading : 0
      if (before + height + following > room() && height + following <= full) newPage()
    }
    if (y !== top) y -= block.before
    for (const row of block.rows) {
      if (y - block.leading < CONTENT_BOTTOM) newPage()
      const size = Math.max(10, ...row.items.map((i) => i.size))
      pages[pages.length - 1].push({ ...row, baseline: y - size, leading: block.leading })
      y -= block.leading
    }
  })
  if (pages.length > 1 && !pages[pages.length - 1].length) pages.pop()
  return pages
}

/** Quante pagine avra' il documento. */
export function pdfPageCount(doc: PdfDocument): number {
  return layout(doc).length
}

// --- Scrittura del file --------------------------------------------------------------------------

/** Stringa PDF letterale: ( ) \ si proteggono; i byte fuori dall'ASCII stampabile diventano \ooo. */
export function pdfString(winAnsi: string): string {
  let out = '('
  for (let i = 0; i < winAnsi.length; i++) {
    const code = winAnsi.charCodeAt(i) & 0xff
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(code)
  }
  return `${out})`
}

/** Testo per i metadati (Titolo...): UTF-16BE con BOM, in esadecimale (qualsiasi carattere). */
function pdfTextString(text: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return `<${hex}>`
}

const num = (n: number) => (Math.round(n * 100) / 100).toString()

function pdfDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
}

/** Comandi di disegno di una pagina. */
function pageContent(rows: PlacedRow[], pageNumber: number, pageCount: number, footer: string): string {
  const ops: string[] = []
  for (const row of rows) {
    if (row.rule) {
      const y = row.baseline + 6
      ops.push(`0.75 G 0.6 w ${num(MARGIN_X)} ${num(y)} m ${num(PAGE_WIDTH - MARGIN_X)} ${num(y)} l S`)
    }
    for (const item of row.items) {
      if (!item.text) continue
      ops.push(`${item.grey ? '0.35' : '0'} g BT /${item.font} ${num(item.size)} Tf 1 0 0 1 ${num(MARGIN_X + item.x)} ${num(row.baseline)} Tm ${pdfString(item.text)} Tj ET`)
    }
  }
  // Piede: riga sottile, eventuale testo breve (al massimo 3 righe) e numero di pagina.
  ops.push(`0.8 G 0.5 w ${num(MARGIN_X)} 72 m ${num(PAGE_WIDTH - MARGIN_X)} 72 l S`)
  const label = toWinAnsi(`Pagina ${pageNumber} di ${pageCount}`)
  const labelWidth = textWidth(label, 'F1', 8)
  const footerLines = footer.trim() ? wrapText(toWinAnsi(footer), 'F1', 7.5, CONTENT_WIDTH - labelWidth - 18).slice(0, 3) : []
  footerLines.forEach((line, k) => ops.push(`0.4 g BT /F1 7.5 Tf 1 0 0 1 ${num(MARGIN_X)} ${num(60 - k * 9.5)} Tm ${pdfString(line)} Tj ET`))
  ops.push(`0.4 g BT /F1 8 Tf 1 0 0 1 ${num(PAGE_WIDTH - MARGIN_X - labelWidth)} 60 Tm ${pdfString(label)} Tj ET`)
  return `${ops.join('\n')}\n`
}

/** Il documento come file PDF (Buffer) e il numero di pagine. */
export function renderPdf(doc: PdfDocument): { pdf: Buffer; pages: number } {
  const pages = layout(doc)
  const count = pages.length
  // Oggetti: 1 catalogo, 2 pagine, 3-4 font, 5 info, poi per ogni pagina: pagina e contenuto.
  const objects: string[] = []
  const pageIds = pages.map((_, k) => 6 + k * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${count} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  const created = doc.info?.createdAt ?? new Date()
  objects[5] = `<< /Title ${pdfTextString((doc.info?.title || doc.title || 'Documento').slice(0, 300))}${
    doc.info?.subject ? ` /Subject ${pdfTextString(doc.info.subject.slice(0, 300))}` : ''
  } /Producer (Facevoice AI) /Creator (Facevoice AI) /CreationDate (${pdfDate(created)}) >>`
  pages.forEach((rows, k) => {
    const content = pageContent(rows, k + 1, count, doc.footer)
    objects[pageIds[k]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[k] + 1} 0 R >>`
    objects[pageIds[k] + 1] = `<< /Length ${content.length} >>\nstream\n${content}endstream`
  })
  // Tutto in byte singoli (latin1): la seconda riga e' il commento "binario" di rito.
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  const fileId = createHash('md5').update(out).digest('hex')
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R /ID [<${fileId}> <${fileId}>] >>\nstartxref\n${xref}\n%%EOF\n`
  return { pdf: Buffer.from(out, 'latin1'), pages: count }
}

/** Nome del file dal titolo: solo lettere e numeri ASCII, trattini (es. "Contratto-di-collaborazione-v2.pdf"). */
export function pdfFileName(title: string, suffix = ''): string {
  const base = String(title || 'documento')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return `${base || 'documento'}${suffix ? `-${suffix.replace(/[^A-Za-z0-9]+/g, '')}` : ''}.pdf`
}

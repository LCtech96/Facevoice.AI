// PDF dei documenti della super chat (contratti, preventivi, lettere) senza
// librerie: PDF 1.4, pagina A4, font standard Helvetica e Helvetica-Bold
// (Type1, WinAnsiEncoding: lettere accentate italiane, €, virgolette curve,
// trattini, «»). A capo con le larghezze vere dei caratteri (tabelle AFM di
// Helvetica), salto pagina automatico (un titolo non resta mai da solo in
// fondo alla pagina), "Pagina N di M" e la frase di avviso in fondo a ogni pagina.
// I segnaposto "[DA COMPLETARE: …]" escono in grassetto e colorati.

export type DocSection = { heading?: string; paragraphs: string[]; bullets?: string[] }
export type DocSignature = { label: string; name?: string }
export type StructuredDoc = {
  title: string
  subtitle?: string
  /** Righe sotto il titolo: data, parti… */
  meta?: string[]
  sections: DocSection[]
  signatures?: DocSignature[]
  /** Avviso breve stampato in fondo a ogni pagina. */
  footer?: string
}

// Larghezze AFM (millesimi di em) dei codici WinAnsi da 32 a 255.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
]
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 350,
  556, 350, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
]

/** Caratteri Unicode che in WinAnsi stanno tra 128 e 159 (€, virgolette curve, trattini…). */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

/** Caratteri senza posto in WinAnsi: la cosa piu' vicina in ASCII (o WinAnsi). */
const FALLBACK: Record<string, string> = {
  '‐': '-', '‑': '-', '‒': '-', '―': '—', '−': '-', '⁃': '-',
  '′': "'", '″': '"', '‛': '‘', '‟': '“', 'ʼ': '’', '´': "'",
  '←': '<-', '→': '->', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '​': '', '‌': '', '‍': '', '⁠': '', '﻿': '', '­': '',
  '✓': 'v', '✔': 'v', '✕': 'x', '✗': 'x', '✘': 'x',
  '●': '•', '▪': '•', '■': '•', '‣': '•', '∙': '•', '⁃ ': '-', '◦': '•',
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't',
  '№': 'N.', '‧': '.', '⁄': '/', '×': 'x', '✕ ': 'x', '∞': 'infinito',
}

/** Il carattere e' un'emoji o un simbolo grafico senza equivalente: si toglie. */
const isPictograph = (cp: number) =>
  (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f1e6 && cp <= 0x1f1ff)

const SYMBOL = /^[\p{Extended_Pictographic}\p{So}\p{Sk}]$/u
const COMBINING = /^\p{M}$/u

function mapCodePoint(ch: string, out: number[], depth = 0) {
  const cp = ch.codePointAt(0) ?? 63
  if (cp === 9) return void out.push(32)
  if (cp < 32 || (cp >= 127 && cp < 160)) return
  if (cp < 127) return void out.push(cp)
  if (cp === 0xad) return
  if (cp <= 0xff) return void out.push(cp)
  if (WIN_ANSI_HIGH[cp] !== undefined) return void out.push(WIN_ANSI_HIGH[cp])
  if (FALLBACK[ch] !== undefined && depth < 2) {
    for (const c of FALLBACK[ch]) mapCodePoint(c, out, depth + 1)
    return
  }
  // Emoji e simboli grafici (⭐, ⏰…) e segni rimasti da soli: si tolgono, niente "?".
  if (isPictograph(cp) || SYMBOL.test(ch) || COMBINING.test(ch)) return
  // Lettere con segni (ă, ő, ç…): la lettera senza il segno.
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (base && base !== ch && depth < 2) {
    for (const c of base) mapCodePoint(c, out, depth + 1)
    return
  }
  out.push(63) // "?"
}

/** Testo -> codici WinAnsi (mai byte rotti: cio' che non c'e' diventa la cosa piu' vicina in ASCII). */
export function toWinAnsi(text: string): number[] {
  const out: number[] = []
  // NFC: "e" + accento separato diventa "é" (che in WinAnsi c'e').
  for (const ch of String(text ?? '').normalize('NFC')) mapCodePoint(ch, out)
  return out
}

const widthOf = (code: number, bold: boolean) => (bold ? HELVETICA_BOLD : HELVETICA)[code - 32] ?? 556

/** Larghezza in punti di una serie di codici WinAnsi. */
export function codesWidth(codes: number[], bold: boolean, size: number) {
  let total = 0
  for (const c of codes) total += widthOf(c, bold)
  return (total * size) / 1000
}

export function textWidth(text: string, bold: boolean, size: number) {
  return codesWidth(toWinAnsi(text), bold, size)
}

// ---------------------------------------------------------------------
// A capo
// ---------------------------------------------------------------------

/** Pezzo di parola con il suo stile (i segnaposto sono in grassetto e colorati). */
type Piece = { codes: number[]; strong: boolean }
type Word = { pieces: Piece[]; width: number }
export type Line = { words: Word[]; width: number; last: boolean }

const PLACEHOLDER = /(\[DA COMPLETARE[^\]]*\])/i

function wordWidth(pieces: Piece[], bold: boolean, size: number) {
  return pieces.reduce((sum, p) => sum + codesWidth(p.codes, bold || p.strong, size), 0)
}

/** Parole di una riga di testo, con lo stile di ogni pezzo. */
function wordsOf(text: string, bold: boolean, size: number): Word[] {
  const words: Word[] = []
  let current: Piece[] = []
  const flush = () => {
    if (current.length) words.push({ pieces: current, width: wordWidth(current, bold, size) })
    current = []
  }
  for (const segment of text.split(PLACEHOLDER)) {
    if (!segment) continue
    const strong = PLACEHOLDER.test(segment) && /^\[/.test(segment)
    const codes = toWinAnsi(segment)
    let piece: number[] = []
    for (const code of codes) {
      if (code === 32) {
        if (piece.length) current.push({ codes: piece, strong })
        piece = []
        flush()
      } else piece.push(code)
    }
    if (piece.length) current.push({ codes: piece, strong })
  }
  flush()
  return words
}

/** Parola troppo lunga per la riga (indirizzi, link): si spezza dove serve. */
function splitLong(word: Word, max: number, bold: boolean, size: number): Word[] {
  const out: Word[] = []
  let pieces: Piece[] = []
  let width = 0
  for (const piece of word.pieces) {
    let chunk: number[] = []
    for (const code of piece.codes) {
      const w = codesWidth([code], bold || piece.strong, size)
      if (width + w > max && (chunk.length || pieces.length)) {
        if (chunk.length) pieces.push({ codes: chunk, strong: piece.strong })
        out.push({ pieces, width })
        pieces = []
        chunk = []
        width = 0
      }
      chunk.push(code)
      width += w
    }
    if (chunk.length) pieces.push({ codes: chunk, strong: piece.strong })
  }
  if (pieces.length) out.push({ pieces, width })
  return out
}

/** Testo diviso in righe larghe al massimo maxWidth (gli "a capo" del testo restano). */
export function wrapText(text: string, maxWidth: number, bold: boolean, size: number): Line[] {
  const space = codesWidth([32], bold, size)
  const lines: Line[] = []
  for (const hard of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const words = wordsOf(hard, bold, size).flatMap((w) => (w.width > maxWidth ? splitLong(w, maxWidth, bold, size) : [w]))
    let current: Word[] = []
    let width = 0
    for (const word of words) {
      const next = current.length ? width + space + word.width : word.width
      if (current.length && next > maxWidth) {
        lines.push({ words: current, width, last: false })
        current = [word]
        width = word.width
      } else {
        current.push(word)
        width = next
      }
    }
    if (current.length) lines.push({ words: current, width, last: true })
  }
  if (lines.length) lines[lines.length - 1].last = true
  return lines
}

// ---------------------------------------------------------------------
// Impaginazione
// ---------------------------------------------------------------------

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 62
const TOP = PAGE_H - 64
/** Sotto questa altezza non si scrive: c'e' il piede della pagina. */
const BOTTOM = 86
const CONTENT_W = PAGE_W - 2 * MARGIN_X

const TEXT_COLOR = '0.12 0.12 0.14 rg'
const GRAY = '0.42 0.42 0.45 rg'
const PLACEHOLDER_COLOR = '0.72 0.25 0.02 rg'

type Block = {
  lines: Line[]
  bold: boolean
  size: number
  leading: number
  before: number
  indent: number
  align: 'left' | 'center' | 'justify'
  color: string
  /** Simbolo all'inizio della prima riga (punto elenco). */
  bullet?: boolean
  /** Il blocco resta sulla stessa pagina dell'inizio del successivo (titoli). */
  keepWithNext?: boolean
  rule?: boolean
}

const num = (n: number) => (Math.round(n * 100) / 100).toString()

/** Stringa PDF letterale: ( ) \ con la barra davanti, codici oltre l'ASCII in ottale. */
function pdfString(codes: number[]) {
  let out = '('
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += `\\${String.fromCharCode(c)}`
    else if (c >= 32 && c < 127) out += String.fromCharCode(c)
    else out += `\\${c.toString(8).padStart(3, '0')}`
  }
  return `${out})`
}

/** Comandi PDF di una riga: un solo Td, poi pezzi di testo con il loro stile. */
function drawLine(line: Line, x: number, y: number, block: Pick<Block, 'bold' | 'size' | 'color'>, wordSpacing: number): string {
  const ops: string[] = ['BT', `${x.toFixed(2)} ${y.toFixed(2)} Td`, `${num(wordSpacing)} Tw`]
  let style: string | null = null
  let run: number[] = []
  const flush = () => {
    if (run.length) ops.push(`${pdfString(run)} Tj`)
    run = []
  }
  line.words.forEach((word, i) => {
    word.pieces.forEach((piece, j) => {
      const strong = block.bold || piece.strong
      const key = `${strong ? 'F2' : 'F1'}|${piece.strong ? 'p' : 'n'}`
      if (key !== style) {
        flush()
        ops.push(`/${strong ? 'F2' : 'F1'} ${num(block.size)} Tf`, piece.strong ? PLACEHOLDER_COLOR : block.color)
        style = key
      }
      // Lo spazio tra due parole va con il pezzo prima (Tw lo allarga quando la riga e' giustificata).
      if (i > 0 && j === 0) run.push(32)
      run.push(...piece.codes)
    })
  })
  flush()
  ops.push('ET')
  return ops.join('\n')
}

function block(text: string, options: Omit<Block, 'lines'> & { width?: number }): Block {
  const width = (options.width ?? CONTENT_W) - options.indent
  return { ...options, lines: wrapText(text, width, options.bold, options.size) }
}

/** Righe del blocco che devono stare insieme alla prima pagina (niente riga sola in fondo). */
const minLines = (b: Block | undefined) => (b ? Math.min(2, b.lines.length) : 0)

type Page = string[]

/** Righe del piede: avviso breve a sinistra, "Pagina N di M" a destra. */
function footerOps(footer: string, page: number, total: number): string {
  const ops: string[] = [`0.82 0.82 0.85 RG 0.5 w ${MARGIN_X} 66 m ${num(PAGE_W - MARGIN_X)} 66 l S`]
  const label = `Pagina ${page} di ${total}`
  const labelCodes = toWinAnsi(label)
  const labelWidth = codesWidth(labelCodes, false, 8)
  ops.push(`BT /F1 8 Tf ${GRAY} 0 Tw ${num(PAGE_W - MARGIN_X - labelWidth)} 52 Td ${pdfString(labelCodes)} Tj ET`)
  const lines = wrapText(footer, CONTENT_W - labelWidth - 24, false, 7.5).slice(0, 3)
  lines.forEach((line, i) => ops.push(drawLine(line, MARGIN_X, 52 - i * 9.5, { bold: false, size: 7.5, color: GRAY }, 0)))
  return ops.join('\n')
}

/** Firme: due per riga, con lo spazio per firmare e il nome sotto la linea. */
function signatureOps(signatures: DocSignature[], startY: number): { ops: string[]; height: number }[] {
  const rows: { ops: string[]; height: number }[] = []
  const colW = (CONTENT_W - 30) / 2
  for (let i = 0; i < signatures.length; i += 2) {
    const ops: string[] = []
    let height = 92
    signatures.slice(i, i + 2).forEach((sig, k) => {
      const x = MARGIN_X + k * (colW + 30)
      // Tutte le righe (anche i segnaposto lunghi): la riga di firme si allunga.
      const label = wrapText(sig.label, colW, true, 10)
      label.forEach((line, n) => ops.push(drawLine(line, x, startY - 12 - n * 13, { bold: true, size: 10, color: TEXT_COLOR }, 0)))
      const lineY = startY - 12 - (Math.max(1, label.length) - 1) * 13 - 34
      ops.push(`0.25 0.25 0.28 RG 0.6 w ${num(x)} ${num(lineY)} m ${num(x + colW)} ${num(lineY)} l S`)
      let bottom = startY - lineY
      if (sig.name) {
        const name = wrapText(sig.name, colW, false, 9.5)
        name.forEach((line, n) => ops.push(drawLine(line, x, lineY - 13 - n * 12, { bold: false, size: 9.5, color: GRAY }, 0)))
        if (name.length) bottom += 13 + (name.length - 1) * 12
      }
      height = Math.max(height, bottom + 8)
    })
    rows.push({ ops, height })
  }
  return rows
}

/** Pagine con i comandi di disegno (senza piede). */
function layout(doc: StructuredDoc): Page[] {
  const blocks: Block[] = []
  blocks.push(block(doc.title || 'Documento', { bold: true, size: 17, leading: 22, before: 0, indent: 0, align: 'center', color: TEXT_COLOR }))
  if (doc.subtitle?.trim()) blocks.push(block(doc.subtitle, { bold: false, size: 11, leading: 15, before: 4, indent: 0, align: 'center', color: GRAY }))
  const meta = (doc.meta || []).filter((m) => m?.trim())
  meta.forEach((m, i) => blocks.push(block(m, { bold: false, size: 10, leading: 14, before: i === 0 ? 14 : 0, indent: 0, align: 'left', color: TEXT_COLOR })))
  blocks.push({ lines: [], bold: false, size: 10, leading: 0, before: 10, indent: 0, align: 'left', color: TEXT_COLOR, rule: true })

  for (const section of doc.sections || []) {
    if (section.heading?.trim()) {
      blocks.push(block(section.heading, { bold: true, size: 12, leading: 16, before: 16, indent: 0, align: 'left', color: TEXT_COLOR, keepWithNext: true }))
    }
    for (const p of section.paragraphs || []) {
      if (p?.trim()) blocks.push(block(p, { bold: false, size: 10.5, leading: 15, before: 6, indent: 0, align: 'justify', color: TEXT_COLOR }))
    }
    for (const b of section.bullets || []) {
      if (b?.trim()) blocks.push(block(b, { bold: false, size: 10.5, leading: 15, before: 3, indent: 16, align: 'justify', color: TEXT_COLOR, bullet: true }))
    }
  }

  const pages: Page[] = [[]]
  let y = TOP
  const atTop = () => y >= TOP - 0.01
  const newPage = () => {
    pages.push([])
    y = TOP
  }
  const page = () => pages[pages.length - 1]

  blocks.forEach((b, index) => {
    if (b.rule) {
      if (!atTop()) {
        y -= b.before
        page().push(`0.82 0.82 0.85 RG 0.6 w ${MARGIN_X} ${num(y)} m ${num(PAGE_W - MARGIN_X)} ${num(y)} l S`)
        y -= 4
      }
      return
    }
    if (!b.lines.length) return
    // Spazio che serve ora: il titolo con l'inizio del blocco dopo, gli altri almeno due righe.
    let need = b.before + (b.keepWithNext ? b.lines.length * b.leading + (blocks[index + 1]?.before ?? 0) + minLines(blocks[index + 1]) * (blocks[index + 1]?.leading ?? 0) : minLines(b) * b.leading)
    if (b.keepWithNext && need > TOP - BOTTOM) need = b.before + b.lines.length * b.leading
    if (y - need < BOTTOM && !atTop()) newPage()
    if (!atTop()) y -= b.before
    b.lines.forEach((line, i) => {
      if (y - b.leading < BOTTOM) newPage()
      y -= b.leading
      const baseline = y + (b.leading - b.size) / 2 + 1
      const width = CONTENT_W - b.indent
      let x = MARGIN_X + b.indent
      if (b.align === 'center') x = MARGIN_X + Math.max(0, (CONTENT_W - line.width) / 2)
      const spaces = line.words.length - 1
      let spacing = 0
      if (b.align === 'justify' && !line.last && spaces > 0) {
        spacing = (width - line.width) / spaces
        // Righe con pochissime parole: meglio a sinistra che con buchi enormi.
        if (spacing > b.size * 0.9) spacing = 0
      }
      if (b.bullet && i === 0) {
        page().push(`BT /F1 ${num(b.size)} Tf ${b.color} 0 Tw ${num(MARGIN_X + 3)} ${num(baseline)} Td ${pdfString([0x95])} Tj ET`)
      }
      page().push(drawLine(line, x, baseline, b, spacing))
    })
  })

  // Firme in fondo, ogni riga di firme intera sulla stessa pagina.
  const signatures = (doc.signatures || []).filter((s) => s?.label?.trim())
  if (signatures.length) {
    let first = true
    for (const row of signatureOps(signatures, 0)) {
      const before = first ? 26 : 8
      if (y - before - row.height < BOTTOM && !atTop()) newPage()
      if (!atTop()) y -= before
      const top = y
      // Le firme sono state disegnate da y = 0: si spostano alla posizione vera.
      page().push(`q 1 0 0 1 0 ${num(top)} cm`, ...row.ops, 'Q')
      y -= row.height
      first = false
    }
  }
  return pages
}

/** Testo per le informazioni del PDF (titolo): UTF-16BE con BOM, va bene con ogni lettera. */
function infoString(text: string) {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return `<${hex}>`
}

const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`

export const MAX_PAGES = 80

/** PDF 1.4 del documento. pages: numero di pagine. */
export function renderPdf(doc: StructuredDoc, options: { createdAt?: Date } = {}): { bytes: Buffer; pages: number } {
  const footer = (doc.footer || '').trim()
  const laid = layout(doc).slice(0, MAX_PAGES)
  const total = laid.length
  const pageStreams = laid.map((ops, i) => [ops.join('\n'), footerOps(footer, i + 1, total)].filter(Boolean).join('\n'))

  // Oggetti: 1 catalogo, 2 pagine, 3-4 font, 5 info, poi pagina + contenuto per ogni pagina.
  const objects: string[] = []
  const pageIds = laid.map((_, i) => 6 + i * 2)
  objects.push('<< /Type /Catalog /Pages 2 0 R /Lang (it-IT) >>')
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const created = pdfDate(options.createdAt ?? new Date())
  objects.push(`<< /Title ${infoString((doc.title || 'Documento').slice(0, 200))} /Producer (Facevoice AI) /Creator (Facevoice AI) /CreationDate (${created}) /ModDate (${created}) >>`)
  pageStreams.forEach((content, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ProcSet [/PDF /Text] >> /Contents ${pageIds[i] + 1} 0 R >>`
    )
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  })

  // Intestazione con 4 byte oltre l'ASCII: i programmi capiscono che il file e' binario.
  const chunks: Buffer[] = [Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  let offset = chunks[0].length
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(offset)
    const chunk = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
    chunks.push(chunk)
    offset += chunk.length
  })
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('')
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'))
  return { bytes: Buffer.concat(chunks), pages: total }
}

/** Nome del file dal titolo, solo lettere ASCII: "Contratto di servizi – Giusy" -> "contratto-di-servizi-giusy.pdf". */
export function pdfFilename(title: string) {
  const slug = String(title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return `${slug || 'documento'}.pdf`
}

import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'
import { DOC_COOKIE, verifyDocAccess } from '@/lib/doc-access'
import { DOC_ID_RE, DOC_KIND_LABEL, findVersion, loadDocument, renderDocumentPdf } from '@/lib/assistant-documents'
import { pdfFilename } from '@/lib/pdf-doc'

export const dynamic = 'force-dynamic'

// PDF di un documento della super chat, creato al momento dalla versione salvata.
// Solo l'amministratore: con il suo token (fetch) o con il cookie firmato della
// scheda (Apri PDF in una scheda nuova). Mai in cache, mai un link pubblico.
//   ?v=2         versione (senza: l'ultima)
//   ?download=1  da scaricare invece che da aprire
//   ?meta=1      elenco delle versioni (JSON)

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }

async function isAdmin(req: NextRequest) {
  if (req.headers.get('authorization')) return Boolean((await getStaffAccess(req))?.isAdmin)
  return verifyDocAccess(req.cookies.get(DOC_COOKIE)?.value)
}

/** Errore leggibile anche nella scheda nuova del browser (testo semplice), JSON per la pagina. */
function failure(req: NextRequest, message: string, status: number) {
  if (req.nextUrl.searchParams.get('meta') === '1') return NextResponse.json({ error: message }, { status, headers: NO_STORE })
  return new NextResponse(message, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin(req))) return failure(req, 'Solo l’amministratore può aprire i documenti: torna nella super chat e riprova da lì.', 401)
  const { id } = await params
  const record = DOC_ID_RE.test(id) ? await loadDocument(id) : null
  if (!record) return failure(req, 'Documento non trovato.', 404)

  if (req.nextUrl.searchParams.get('meta') === '1') {
    return NextResponse.json(
      {
        id: record.id,
        kind: DOC_KIND_LABEL[record.kind] || record.kind,
        basedOn: record.basedOn ? { name: record.basedOn.name, platform: record.basedOn.platform } : null,
        versions: record.versions.map((v) => ({ v: v.v, at: v.at, title: v.doc.title, pages: v.pages, placeholders: v.placeholders.length })),
      },
      { headers: NO_STORE }
    )
  }

  const asked = Number(req.nextUrl.searchParams.get('v'))
  const version = findVersion(record, Number.isInteger(asked) && asked > 0 ? asked : null)
  if (!version) return failure(req, 'Questa versione del documento non è più salvata.', 404)

  const pdf = renderDocumentPdf(version)
  const name = pdfFilename(record.versions.length > 1 ? `${version.doc.title} v${version.v}` : version.doc.title)
  const download = req.nextUrl.searchParams.get('download') === '1'
  return new NextResponse(new Uint8Array(pdf.bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

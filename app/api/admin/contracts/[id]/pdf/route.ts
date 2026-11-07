import { NextRequest, NextResponse } from 'next/server'
import { adminOnly, NO_STORE } from '@/lib/contract-http'
import { CONTRACT_ID_RE, contractPdf, loadContract } from '@/lib/contracts'
import { pdfFilename } from '@/lib/pdf-doc'

export const dynamic = 'force-dynamic'

// PDF del contratto per l'amministratore (con il suo token). Senza tutte le firme c'e'
// la scritta chiara "BOZZA – non firmato"; firmato: firme disegnate e registro delle firme.
//   ?download=1  da scaricare invece che da aprire

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await adminOnly(req)
  if (!('userId' in access)) return access
  const { id } = await params
  const c = CONTRACT_ID_RE.test(id) ? await loadContract(id) : null
  if (!c) return NextResponse.json({ error: 'Contratto non trovato.' }, { status: 404, headers: NO_STORE })
  const pdf = contractPdf(c)
  const name = pdfFilename(`${c.version.doc.title}${c.status === 'firmato' ? ' firmato' : ''}`)
  const download = req.nextUrl.searchParams.get('download') === '1'
  return new NextResponse(new Uint8Array(pdf.bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
    },
  })
}

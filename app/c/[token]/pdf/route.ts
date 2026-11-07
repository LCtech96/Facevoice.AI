import { NextRequest, NextResponse } from 'next/server'
import { NO_STORE } from '@/lib/contract-http'
import { LINK_COOKIE, contractByToken, contractPdf, verifyLinkCookie } from '@/lib/contracts'
import { pdfFilename } from '@/lib/pdf-doc'

export const dynamic = 'force-dynamic'

// PDF per chi ha il link (solo dopo il PIN, con il cookie di questo link). Finche' non
// firmano tutti e due c'e' la scritta chiara "BOZZA – non firmato".

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const c = await contractByToken(token)
  const text = (message: string, status: number) => new NextResponse(message, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } })
  if (!c || !c.share) return text('Link non valido.', 404)
  if (!verifyLinkCookie(req.cookies.get(LINK_COOKIE)?.value, c.share)) return text('Apri di nuovo il link e inserisci il PIN.', 401)
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

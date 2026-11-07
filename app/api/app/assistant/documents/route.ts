import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { currentDocumentPdf, loadDocument } from '@/lib/saas/documents'

export const dynamic = 'force-dynamic'

// PDF di un documento dell'Assistente (contratto, preventivo, lettera…), creato a ogni
// richiesta dal documento salvato (lib/saas/documents.ts). Solo per i membri dello spazio a
// cui appartiene (token e spazio come tutte le API dell'area clienti): mai un link pubblico,
// i contratti contengono dati personali. ?id=<documento>&v=<versione> (default l'ultima);
// inline per aprirlo nel visore del telefono, ?download=1 per scaricarlo. Mai in cache.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const params = req.nextUrl.searchParams
  const doc = await loadDocument(access.workspace.id, params.get('id') || '').catch(() => null)
  if (!doc) return NextResponse.json({ error: 'Documento non trovato.' }, { status: 404 })
  const version = Number(params.get('v'))
  if (params.get('v') && !doc.versions.some((v) => v.n === version)) return NextResponse.json({ error: 'Versione non trovata.' }, { status: 404 })
  // Gia' un contratto: data/ora e termine di consegna come sono nella pagina del contratto (mai quelli vecchi della chat).
  const file = await currentDocumentPdf(access.workspace.id, doc, Number.isInteger(version) && version > 0 ? version : null)
  const download = params.get('download') === '1'
  return new NextResponse(new Uint8Array(file.pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file.filename}"`,
      'Content-Length': String(file.pdf.length),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

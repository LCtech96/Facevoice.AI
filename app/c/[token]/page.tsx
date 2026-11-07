import type { Metadata } from 'next'
import PublicContract from '@/components/contracts/PublicContract'

// Pagina del contratto per chi lo riceve: senza account, si apre solo con il link e il PIN
// (controllo sul server, app/api/c/[token]/route.ts). Mai indicizzata, mai in cache; nessun
// marchio oltre al nome dell'attivita' che manda il contratto.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Contratto',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
  openGraph: null,
  twitter: null,
  other: { google: 'notranslate' },
}

export default async function ContractLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PublicContract token={typeof token === 'string' ? token.slice(0, 64) : ''} />
}

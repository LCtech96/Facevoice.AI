import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { LINK_COOKIE, contractByToken, publicView, verifyLinkCookie } from '@/lib/contracts'
import PinForm from './PinForm'
import ContractPublic from './ContractPublic'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Pagina pubblica del contratto (senza login). Si apre solo con il link unico e il PIN:
// prima il modulo del PIN, poi (con il cookie firmato di questo link) il contratto.
// Il PIN non e' mai nella pagina, nel codice o nell'indirizzo. Link sconosciuto o
// revocato: sempre lo stesso "Link non valido". Mai indicizzata, mai in cache.

export const metadata: Metadata = {
  title: 'Contratto',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

function Shell({ brand, children }: { brand: string | null; children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-[#f4f4f6] text-[#1d1d1f]" translate="no">
      <header className="border-b border-[#e2e2e6] bg-white">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-3">
          <span className="text-base font-semibold">{brand || 'Contratto'}</span>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-5">{children}</div>
    </main>
  )
}

export default async function ContractLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const c = await contractByToken(token)
  if (!c || !c.share) {
    return (
      <Shell brand={null}>
        <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Link non valido</h1>
          <p className="mt-2 text-sm text-[#6b6b73]">Il link non esiste o non è più attivo. Chiedi a chi te l’ha mandato un link nuovo.</p>
        </div>
      </Shell>
    )
  }
  const cookie = (await cookies()).get(LINK_COOKIE)?.value
  if (!verifyLinkCookie(cookie, c.share)) {
    return (
      <Shell brand={c.creator.name}>
        <PinForm token={token} creator={c.creator.name} />
      </Shell>
    )
  }
  return (
    <Shell brand={c.creator.name}>
      <ContractPublic token={token} initial={publicView(c)} />
    </Shell>
  )
}

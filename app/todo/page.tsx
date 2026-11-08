import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { ACCESS_COOKIE, readAccessSession } from '@/lib/todo-auth'
import { accessForSession } from '@/lib/todo-access'
import LoginForm from './LoginForm'
import Portal from './Portal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Pagina generale dei progetti per le persone a cui l'admin ha dato un accesso:
// si entra con nome e password, poi si vedono solo i propri progetti (cartelle e
// calendario) e si lavora dentro. Pagina a sé, mai indicizzata, mai in cache.

export const metadata: Metadata = {
  title: 'Progetti',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

export default async function TodoPortalPage() {
  let person = null
  let revoked = false
  try {
    const session = readAccessSession((await cookies()).get(ACCESS_COOKIE)?.value)
    person = await accessForSession(session)
    // Cookie autentico ma non piu' valido: password cambiata o accesso tolto dall'admin.
    revoked = !person && !!session
  } catch {
    person = null
  }
  return (
    <main className="min-h-[100dvh] bg-[var(--background)]" translate="no">
      {person ? (
        <Suspense fallback={null}>
          <Portal name={person.name} />
        </Suspense>
      ) : (
        <LoginForm revoked={revoked} />
      )}
    </main>
  )
}

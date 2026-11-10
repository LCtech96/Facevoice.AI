import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { ACCESS_COOKIE, PENDING_COOKIE, readAccessSession, readPending } from '@/lib/todo-auth'
import { accessForSession } from '@/lib/todo-access'
import { pendingLogin } from '@/lib/todo-login'
import LoginForm from './LoginForm'
import Portal from './Portal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Pagina generale dei progetti per le persone a cui l'admin ha dato un accesso:
// si entra una volta sola (nome, password e codice arrivato per email), poi si vedono
// solo i propri progetti (cartelle, calendario, campanella) e si lavora dentro. I link
// ?p=progetto&t=attivita' (anche dalle email) restano anche passando dall'entrata.
// Pagina a sé, mai indicizzata, mai in cache.

export const metadata: Metadata = {
  title: 'Progetti',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

export default async function TodoPortalPage() {
  let person = null
  let revoked = false
  let pending: { maskedEmail: string; resendIn: number } | null = null
  try {
    const jar = await cookies()
    const session = readAccessSession(jar.get(ACCESS_COOKIE)?.value)
    person = await accessForSession(session)
    // Cookie autentico ma non piu' valido: password cambiata o accesso tolto dall'admin.
    revoked = !person && !!session
    if (!person) {
      const waiting = await pendingLogin(readPending(jar.get(PENDING_COOKIE)?.value))
      if (waiting) pending = { maskedEmail: waiting.maskedEmail, resendIn: waiting.resendIn }
    }
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
        <LoginForm revoked={revoked && !pending} pending={pending} />
      )}
    </main>
  )
}

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { readSession, sessionCookieName } from '@/lib/todo-auth'
import { TodoError, boardByToken, viewerFor, type BoardRow } from '@/lib/todo-store'
import LoginForm from './LoginForm'
import GuestBoard from './GuestBoard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Todo list condivisa (senza account del sito): si apre solo con il link, il proprio
// nome e la password personale data dall'admin. Pagina a sé: nessun menu del sito,
// nessun collegamento ad altre pagine. Prima di entrare non si mostrano né il nome
// della todo list né chi ne fa parte. Link sconosciuto o rigenerato: sempre lo stesso
// "Link non valido". Mai indicizzata, mai in cache.

export const metadata: Metadata = {
  title: 'Todo list',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="min-h-[100dvh] bg-[var(--background)] px-4 pt-16" translate="no">
      <div className="mx-auto max-w-sm rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-6 text-center">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{text}</p>
      </div>
    </main>
  )
}

export default async function TodoLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let board: BoardRow | null = null
  try {
    board = await boardByToken(token)
  } catch (error) {
    if (error instanceof TodoError && error.setup) return <Notice title="Pagina non ancora pronta" text="La todo list non è ancora attiva. Riprova più tardi." />
    return <Notice title="Pagina non disponibile" text="Qualcosa non è andato: riprova tra poco." />
  }
  if (!board) return <Notice title="Link non valido" text="Il link non esiste o non è più attivo. Chiedi un link nuovo a chi te l’ha mandato." />
  let unlocked = false
  try {
    unlocked = Boolean(await viewerFor(board, readSession((await cookies()).get(sessionCookieName(board.id))?.value, board)))
  } catch {
    // Persone non ancora pronte (o database lento): si mostra il modulo, che risponde in modo neutro.
    unlocked = false
  }
  return (
    <main className="min-h-[100dvh] bg-[var(--background)]" translate="no">
      {unlocked ? <GuestBoard token={token} name={board.name} /> : <LoginForm token={token} />}
    </main>
  )
}

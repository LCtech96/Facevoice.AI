'use client'

import { useCallback, useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import { getAccessToken } from '@/lib/session-token'
import { useStaffAccess } from '@/components/useStaffAccess'
import MemoryTab, { type KnowledgeItem } from './MemoryTab'
import AIContextPanel from './AIContextPanel'
import CorrectionsPanel from './CorrectionsPanel'

// Memoria AI: cosa sa l'assistente (voci di memoria) e le regole per ogni lavoro.
// Si apre dal menu in alto; prima era una scheda di "Canali e AI".
export default function MemoryPage() {
  const staff = useStaffAccess()
  const readOnly = !staff.loading && !staff.can('control', 'edit')
  const [items, setItems] = useState<KnowledgeItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const authFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await getAccessToken()
    if (!token) throw new Error('Sessione scaduta')
    return fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    })
  }, [])

  useEffect(() => {
    authFetch('/api/admin/ai-knowledge')
      .then(async (res) => {
        if (!res.ok) return setError('Non hai accesso a questa pagina: chiedilo all’amministratore.')
        const data = await res.json().catch(() => ({}))
        setItems(data.items || [])
      })
      .catch(() => setError('Impossibile caricare la memoria, ricarica la pagina.'))
  }, [authFetch])

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-4xl mx-auto px-4 pt-20 md:pt-24 pb-28 md:pb-16">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Memoria AI</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--text-secondary)]">
          Quello che l&apos;AI sa di Facevoice e le regole che segue nelle risposte, nelle email e nei post.
        </p>
        {error && <p className="text-sm text-[var(--text-secondary)]">{error}</p>}
        {!error && items === null && <p className="text-sm text-[var(--text-secondary)]">Caricamento…</p>}
        {items && (
          <>
            {readOnly && (
              <p className="mb-4 px-3 py-2 rounded-lg bg-[var(--background-secondary)] text-xs text-[var(--text-secondary)]">
                Sola consultazione: per modificare chiedi il permesso all’amministratore.
              </p>
            )}
            <fieldset disabled={readOnly} className="contents">
              <MemoryTab items={items} authFetch={authFetch} onChange={setItems} />
            </fieldset>
            {/* Correzioni delle risposte (da «Correggi» in Messaggi): si possono copiare tra le voci qui sopra. */}
            <CorrectionsPanel
              authFetch={authFetch}
              readOnly={readOnly}
              onPromoted={(item) => setItems((list) => [item as KnowledgeItem, ...(list || [])])}
            />
            {/* Fuori dal fieldset: in sola consultazione i blocchi devono comunque aprirsi. */}
            <AIContextPanel authFetch={authFetch} readOnly={readOnly} />
          </>
        )}
      </div>
    </main>
  )
}

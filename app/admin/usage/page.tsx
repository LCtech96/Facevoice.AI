'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { getChatModelName } from '@/lib/chat-models'

type ModelTotals = {
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  costUsd: number
}

type MemberUsage = {
  userId: string
  email: string
  displayName: string | null
  role: 'admin' | 'employee'
  isActive: boolean
  limitUsd: number
  spentUsd: number
  remainingUsd: number
  percentUsed: number
  lastUsedAt: string | null
  totals: Omit<ModelTotals, 'model'>
  byModel: ModelTotals[]
}

const formatUsd = (value: number) => `$${value.toFixed(2)}`
const formatTokens = (value: number) => value.toLocaleString('it-IT')

export default function AdminUsagePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberUsage[]>([])
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [periodStart, setPeriodStart] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const supabase = createClient()

  const load = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) {
      router.push('/auth')
      return
    }

    try {
      const response = await fetch('/api/admin/chat-usage', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Accesso non consentito.')
        return
      }

      setError(null)
      setMembers(data.members || [])
      setTotalCostUsd(data.totalCostUsd || 0)
      setPeriodStart(data.periodStart || null)
    } catch (err) {
      setError('Impossibile caricare i dati di consumo.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.push('/auth')
        return
      }
      load()
    }
    check()
  }, [router, supabase, load])

  const patchMember = async (userId: string, updates: Record<string, unknown>) => {
    const token = await getAccessToken()
    if (!token) return

    const response = await fetch('/api/admin/chat-usage', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId, ...updates }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      alert(data.error || 'Modifica non riuscita.')
      return
    }

    load()
  }

  const addMember = async () => {
    const email = newEmail.trim()
    if (!email) return

    setAdding(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/chat-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()
      if (!response.ok) {
        alert(data.error || 'Impossibile aggiungere il dipendente.')
        return
      }

      setNewEmail('')
      load()
    } finally {
      setAdding(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)] rounded-full animate-spin" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex flex-col">
        <Navigation />
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-[var(--text-secondary)] text-center max-w-md">{error}</p>
        </div>
      </main>
    )
  }

  const period = periodStart
    ? new Date(periodStart).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
    : ''

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 pt-24 pb-16">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Consumo AI del team
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Periodo: {period} · Totale speso {formatUsd(totalCostUsd)}
          </p>
        </header>

        <section className="mb-8 p-4 bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            Aggiungi un dipendente
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            Deve essersi gia&apos; registrato sul sito con questa email.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="nome@facevoice.ai"
              className="flex-1 px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            />
            <button
              onClick={addMember}
              disabled={adding || !newEmail.trim()}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {adding ? 'Aggiungo...' : 'Aggiungi'}
            </button>
          </div>
        </section>

        <div className="space-y-3">
          {members.map((member) => {
            const overLimit = member.remainingUsd <= 0
            const nearLimit = !overLimit && member.percentUsed > 80

            return (
              <div
                key={member.userId}
                className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--text-primary)] truncate">
                        {member.displayName || member.email}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] truncate">
                        {member.email}
                        {member.role === 'admin' && ' · admin'}
                        {!member.isActive && ' · sospeso'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-semibold"
                        style={{
                          color: overLimit
                            ? '#FF3B30'
                            : nearLimit
                              ? '#FF9500'
                              : 'var(--text-primary)',
                        }}
                      >
                        {formatUsd(member.spentUsd)}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        su {formatUsd(member.limitUsd)}
                      </p>
                    </div>
                  </div>

                  <div className="h-2 w-full bg-[var(--background-secondary)] rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, member.percentUsed)}%`,
                        backgroundColor: overLimit
                          ? '#FF3B30'
                          : nearLimit
                            ? '#FF9500'
                            : 'var(--accent-blue)',
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-secondary)]">
                    <span>{member.totals.requests} richieste</span>
                    <span>{formatTokens(member.totals.inputTokens)} token in</span>
                    <span>{formatTokens(member.totals.outputTokens)} token out</span>
                    <span>{formatTokens(member.totals.cacheReadTokens)} da cache</span>
                    <span>
                      {member.lastUsedAt
                        ? `ultimo uso ${new Date(member.lastUsedAt).toLocaleString('it-IT')}`
                        : 'mai usato questo mese'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <label className="text-xs text-[var(--text-secondary)]">
                      Limite mensile $
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      defaultValue={member.limitUsd}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isFinite(value) && value !== member.limitUsd) {
                          patchMember(member.userId, { monthly_limit_usd: value })
                        }
                      }}
                      className="w-24 px-2 py-1 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                    />
                    <button
                      onClick={() =>
                        patchMember(member.userId, { is_active: !member.isActive })
                      }
                      className="px-3 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
                    >
                      {member.isActive ? 'Sospendi' : 'Riattiva'}
                    </button>
                    {member.byModel.length > 0 && (
                      <button
                        onClick={() =>
                          setExpanded(expanded === member.userId ? null : member.userId)
                        }
                        className="px-3 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
                      >
                        {expanded === member.userId ? 'Nascondi dettaglio' : 'Dettaglio per modello'}
                      </button>
                    )}
                  </div>
                </div>

                {expanded === member.userId && (
                  <div className="border-t border-[var(--border-color)] bg-[var(--background-secondary)] p-4 space-y-2">
                    {member.byModel.map((row) => (
                      <div
                        key={row.model}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-medium text-[var(--text-primary)]">
                          {getChatModelName(row.model)}
                        </span>
                        <span className="text-[var(--text-secondary)]">
                          {row.requests} richieste · {formatTokens(row.inputTokens)} in ·{' '}
                          {formatTokens(row.outputTokens)} out ·{' '}
                          {formatTokens(row.cacheReadTokens)} cache · {formatUsd(row.costUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {members.length === 0 && (
            <p className="text-center text-[var(--text-secondary)] py-12">
              Nessun dipendente abilitato. Aggiungine uno qui sopra.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

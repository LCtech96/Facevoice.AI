'use client'

import { useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'

interface Payment {
  id: string
  collaborator_name?: string | null
  collaborator_email: string
  amount: number
  currency: string
  note?: string | null
  entry_date: string
  entry_time: string
  due_date: string
  created_at: string
}

export default function PaymentsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPayments = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token

      if (!accessToken) {
        router.push('/auth')
        return
      }

      try {
        const response = await fetch('/api/payments/my', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Errore nel caricare i pagamenti')
        }

        setPayments(data.payments || [])
      } catch (err: any) {
        setError(err.message || 'Errore nel caricare i pagamenti')
      } finally {
        setLoading(false)
      }
    }

    loadPayments()
  }, [router, supabase])

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-6">
            Pagamenti
          </h1>

          {loading && (
            <div className="text-[var(--text-secondary)]">Caricamento...</div>
          )}

          {error && (
            <div className="text-red-500 bg-red-500/10 border border-red-500/20 p-4 rounded-lg">
              {error}
            </div>
          )}

          {!loading && !error && payments.length === 0 && (
            <div className="text-[var(--text-secondary)]">
              Nessun pagamento disponibile.
            </div>
          )}

          {!loading && !error && payments.length > 0 && (
            <div className="space-y-4">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                      {payment.collaborator_name || payment.collaborator_email}
                    </h2>
                    <span className="text-[var(--accent-blue)] font-bold">
                      {Number(payment.amount).toFixed(2)} {payment.currency}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mb-2">
                    Scadenza: {payment.due_date}
                  </p>
                  <p className="text-sm text-[var(--text-secondary)] mb-2">
                    Inserito: {payment.entry_date} {payment.entry_time}
                  </p>
                  {payment.note && (
                    <p className="text-[var(--text-primary)]">{payment.note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

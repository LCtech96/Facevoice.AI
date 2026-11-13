'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellOff, BellRing, Loader2, Mail, Smartphone, Trash2 } from 'lucide-react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'

// Notifiche dei messaggi in arrivo, scelte da ognuno (admin e dipendenti con accesso
// ai Messaggi): per ogni canale collegato push sui propri dispositivi e/o email al
// proprio indirizzo. Le push arrivano solo sui dispositivi attivati qui (sull'iPhone
// dall'app aggiunta alla schermata Home).

type Channel = { id: string; label: string; emailAllowed: boolean }
type Pref = { push: boolean; email: boolean }
type Device = { id: string; name: string; device: string; lastDeliveredAt: string | null; lastError: string | null }
type Data = { email: string; isAdmin: boolean; channels: Channel[]; prefs: Record<string, Pref>; publicKey: string; devices: Device[] }
type PushState = 'busy' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

async function api(method: string, body?: unknown) {
  const token = await getAccessToken()
  const res = await fetch('/api/notifications', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }).catch(() => null)
  const data = res ? await res.json().catch(() => ({})) : {}
  return { ok: Boolean(res?.ok), status: res?.status || 0, data: (data || {}) as Record<string, any> }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-[var(--accent-blue)]' : 'bg-[var(--border-color)]'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [denied, setDenied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [push, setPush] = useState<PushState>('busy')

  const load = useCallback(async () => {
    const r = await api('GET')
    if (r.status === 401) return router.replace('/auth')
    if (!r.ok) return setDenied(r.data.error || 'Non riesco a caricare le notifiche: riprova.')
    setData(r.data as Data)
  }, [router])

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: auth }) => (auth.user ? load() : router.replace('/auth')))
  }, [load, router])

  // Stato delle push su questo dispositivo (e aggiornamento in silenzio dei suoi dati).
  useEffect(() => {
    const check = async () => {
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setPush(isIos && !standalone() ? 'ios-install' : 'unsupported')
      if (Notification.permission === 'denied') return setPush('denied')
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      setPush(sub ? 'on' : 'off')
      if (sub) api('POST', { subscription: sub.toJSON(), installed: standalone() }).catch(() => undefined)
    }
    check().catch(() => setPush('unsupported'))
  }, [])

  const flash = (text: string) => {
    setNotice(text)
    setTimeout(() => setNotice(null), 3000)
  }

  const setPref = async (channel: string, patch: Partial<Pref>) => {
    if (!data) return
    const before = data.prefs
    setData({ ...data, prefs: { ...before, [channel]: { ...before[channel], ...patch } } })
    setError(null)
    const r = await api('PUT', { channel, ...patch })
    if (!r.ok) {
      setData((d) => (d ? { ...d, prefs: before } : d))
      return setError(r.data.error || 'Non riesco a salvare: riprova.')
    }
    setData((d) => (d ? { ...d, prefs: r.data.prefs } : d))
    flash('Salvato')
  }

  const enablePush = async () => {
    if (!data) return
    setError(null)
    setPush('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return setPush(permission === 'denied' ? 'denied' : 'off')
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.publicKey) }))
      const r = await api('POST', { subscription: sub.toJSON(), installed: standalone(), test: true })
      if (!r.ok) throw new Error(r.data.error || 'Registrazione non riuscita')
      setPush('on')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
      setPush('off')
    }
  }

  const disablePush = async () => {
    setPush('busy')
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await api('DELETE', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    setPush('off')
    load()
  }

  const test = async () => {
    const r = await api('POST', { test: true })
    flash(r.ok ? `Prova inviata a ${r.data.sent} dispositiv${r.data.sent === 1 ? 'o' : 'i'}.` : r.data.error || 'Prova non riuscita')
  }

  const removeDevice = async (d: Device) => {
    if (!window.confirm(`Togliere «${d.name}»? Non riceverà più le notifiche.`)) return
    await api('DELETE', { id: d.id })
    load()
  }

  const card = 'rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4'
  const pill = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] px-4 text-sm font-medium text-[var(--text-primary)]'

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-20 md:pt-24">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
          <BellRing className="h-6 w-6 text-[var(--accent-blue)]" /> Notifiche
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Scegli per quali messaggi ricevere un avviso e come: notifica sul telefono o sul computer, email, oppure entrambe.</p>

        {denied && <p className="mt-6 rounded-xl border border-[#FF9500]/40 bg-[#FF9500]/10 px-4 py-3 text-sm text-[var(--text-primary)]">{denied}</p>}
        {!data && !denied && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--accent-blue)]" />
          </div>
        )}

        {data && (
          <>
            <section className={`${card} mt-6`}>
              <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                <Smartphone className="h-5 w-5 text-[var(--accent-blue)]" /> Notifiche su questo dispositivo
              </h2>
              {push === 'ios-install' && (
                <p className="mt-2 text-sm text-[#FF9500]">
                  Da Safari l’iPhone non riceve notifiche. Tocca Condividi → «Aggiungi alla schermata Home», apri Facevoice AI dalla Home e torna qui per attivarle.
                </p>
              )}
              {push === 'unsupported' && <p className="mt-2 text-sm text-[var(--text-secondary)]">Questo browser non supporta le notifiche.</p>}
              {push === 'denied' && <p className="mt-2 text-sm text-[#FF3B30]">Notifiche bloccate: riattivale dalle impostazioni del dispositivo, poi ricarica la pagina.</p>}
              {(push === 'off' || push === 'busy' || push === 'on') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {push === 'on' ? (
                    <>
                      <button type="button" onClick={test} className={pill}>
                        <Bell className="h-4 w-4" /> Manda una prova
                      </button>
                      <button type="button" onClick={disablePush} className={`${pill} text-[var(--text-secondary)]`}>
                        <BellOff className="h-4 w-4" /> Disattiva su questo dispositivo
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={enablePush} disabled={push === 'busy'} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-sm font-semibold text-white disabled:opacity-50">
                      {push === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Attiva le notifiche su questo dispositivo
                    </button>
                  )}
                </div>
              )}
              {data.devices.length > 0 && (
                <ul className="mt-4 divide-y divide-[var(--border-color)] rounded-xl border border-[var(--border-color)]">
                  {data.devices.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--text-primary)]">{d.name}</span>
                        <span className="block text-xs text-[var(--text-secondary)]">
                          {d.lastError ? `Ultimo invio non riuscito` : d.lastDeliveredAt ? `Ultima notifica: ${new Date(d.lastDeliveredAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Ancora nessuna notifica'}
                        </span>
                      </span>
                      <button type="button" onClick={() => removeDevice(d)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[#FF3B30]" aria-label={`Togli ${d.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {data.devices.length === 0 && push !== 'on' && <p className="mt-3 text-xs text-[var(--text-secondary)]">Nessun tuo dispositivo riceve ancora notifiche.</p>}
            </section>

            <section className={`${card} mt-4`}>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 border-b border-[var(--border-color)] pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                <span>Messaggi da</span>
                <span className="flex w-12 justify-center"><Bell className="h-4 w-4" aria-label="Push" /></span>
                <span className="flex w-12 justify-center"><Mail className="h-4 w-4" aria-label="Email" /></span>
              </div>
              <ul className="divide-y divide-[var(--border-color)]">
                {data.channels.map((c) => {
                  const pref = data.prefs[c.id] || { push: false, email: false }
                  return (
                    <li key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 py-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--text-primary)]">{c.label}</span>
                        {!c.emailAllowed && <span className="block text-xs text-[var(--text-secondary)]">Solo push: un avviso email finirebbe nella stessa casella.</span>}
                      </span>
                      <Toggle on={pref.push} onChange={(v) => setPref(c.id, { push: v })} label={`Notifica push per ${c.label}`} />
                      <Toggle on={pref.email && c.emailAllowed} disabled={!c.emailAllowed} onChange={(v) => setPref(c.id, { email: v })} label={`Email per ${c.label}`} />
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Le email arrivano a <span className="font-medium text-[var(--text-primary)]">{data.email}</span>, al massimo una ogni 10 minuti per la stessa persona. Le push arrivano sui tuoi dispositivi attivati qui sopra.
              </p>
            </section>

            {error && <p className="mt-4 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
          </>
        )}
      </div>
      {notice && (
        <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-6" role="status">
          <p className="rounded-xl bg-[#1c1c1e] px-4 py-2.5 text-sm text-white shadow-xl">{notice}</p>
        </div>
      )}
    </main>
  )
}

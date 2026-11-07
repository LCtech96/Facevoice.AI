'use client'

import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'

// Modulo del PIN: campo nascosto (puntini), tastiera numerica sul telefono (con il
// passaggio alla tastiera completa se il PIN ha anche lettere). Il PIN va solo al
// server, che lo confronta con l'hash: non resta nella pagina.

export default function PinForm({ token, creator }: { token: string; creator: string }) {
  const [pin, setPin] = useState('')
  const [letters, setLetters] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || pin.trim().length < 4) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/c/${encodeURIComponent(token)}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setPin('')
    if (res?.ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setError(data?.error || 'Connessione assente: riprova.')
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-6 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <KeyRound className="mx-auto h-8 w-8 text-[#1a2a73]" />
      <h1 className="mt-3 text-center text-lg font-semibold">{creator} ti ha mandato un contratto</h1>
      <p className="mt-1 text-center text-sm text-[#6b6b73]">Per aprirlo scrivi il PIN che ti è stato dato a parte.</p>
      <label className="mt-5 block text-sm font-medium" htmlFor="pin">
        PIN
      </label>
      <input
        id="pin"
        type="password"
        inputMode={letters ? 'text' : 'numeric'}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={12}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
        className="mt-1 w-full rounded-xl border border-[#d0d0d6] bg-white px-4 py-3 text-center text-xl tracking-[0.4em] text-[#1d1d1f]"
        aria-describedby="pin-help"
      />
      <button type="button" onClick={() => setLetters(!letters)} className="mt-2 min-h-[36px] text-xs text-[#1a2a73] underline" id="pin-help">
        {letters ? 'Usa la tastiera numerica' : 'Il PIN ha anche lettere? Usa la tastiera completa'}
      </button>
      {error && (
        <p className="mt-2 text-sm text-[#c4271b]" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || pin.trim().length < 4}
        className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#1a2a73] px-5 py-3 text-base font-semibold text-white disabled:opacity-40"
      >
        {busy && <Loader2 className="h-5 w-5 animate-spin" />} Apri il contratto
      </button>
    </form>
  )
}

'use client'

import { authFetch } from '@/components/useAssistantChat'

// PDF di un contratto per l'amministratore: si scarica con il suo token (niente link
// pubblici) e si apre in una scheda nuova o si salva. La scheda si apre subito, dentro
// il clic, cosi' il browser non la blocca; l'indirizzo arriva dopo.

export async function openContractPdf(id: string, filename: string, download: boolean): Promise<string | null> {
  const win = download ? null : window.open('', '_blank')
  if (win) win.opener = null
  const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(id)}/pdf${download ? '?download=1' : ''}`).catch(() => null)
  if (!res?.ok) {
    win?.close()
    return 'Non riesco ad aprire il PDF, riprova.'
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  if (win) {
    win.location.href = url
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return null
}

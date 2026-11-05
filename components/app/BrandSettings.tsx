'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Palette, Trash2, Type } from 'lucide-react'
import { useWorkspace } from './WorkspaceContext'

// Marchio dello spazio, nella pagina Istruzioni: logo, colori, font (titoli e testi) e
// firma in fondo alle slide. Vale per i caroselli nuovi; quelli gia' fatti si aggiornano
// tutti alla prima modifica (cambio di stile, slide corretta…).

type Brand = { dark: string; accent: string; light: string; handle: string; logo: string | null; fonts: { heading: string | null; body: string | null } }

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

export default function BrandSettings({ canEdit }: { canEdit: boolean }) {
  const { appFetch } = useWorkspace()
  const [brand, setBrand] = useState<Brand | null>(null)
  const [colors, setColors] = useState({ dark: '#141922', accent: '#3b82f6', light: '#bfd4ff', handle: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const fontRef = useRef<HTMLInputElement>(null)
  const fontRole = useRef<'heading' | 'body' | 'both'>('both')

  const apply = (next: Brand) => {
    setBrand(next)
    setColors({ dark: next.dark, accent: next.accent, light: next.light, handle: next.handle })
  }

  useEffect(() => {
    appFetch('/api/app/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.brand && apply(d.brand))
      .catch(() => undefined)
  }, [appFetch])

  const call = useCallback(
    async (what: string, init: RequestInit, url = '/api/app/brand', ok = 'Salvato.') => {
      setBusy(what)
      setError(null)
      setNotice(null)
      const res = await appFetch(url, init).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      setBusy(null)
      if (res?.ok && data.brand) {
        apply(data.brand)
        setNotice(`${ok} Vale per i caroselli nuovi; quelli già fatti si aggiornano alla prima modifica.`)
      } else setError(data.error || 'Non salvato, riprova.')
    },
    [appFetch]
  )

  const upload = async (kind: 'logo' | 'font', file: File | undefined) => {
    if (!file) return
    if (file.size > 3_000_000) return setError('File troppo pesante (massimo 3 MB).')
    const data = await readFile(file)
    await call(kind === 'logo' ? 'logo' : `font-${fontRole.current}`, { method: 'POST', body: JSON.stringify({ kind, data, name: file.name, role: fontRole.current }) }, undefined, kind === 'logo' ? 'Logo salvato.' : 'Font salvato.')
    if (logoRef.current) logoRef.current.value = ''
    if (fontRef.current) fontRef.current.value = ''
  }

  const pickFont = (role: 'heading' | 'body' | 'both') => {
    fontRole.current = role
    fontRef.current?.click()
  }

  const colorsChanged = brand && (colors.dark !== brand.dark || colors.accent !== brand.accent || colors.light !== brand.light || colors.handle !== brand.handle)

  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Palette className="h-5 w-5 text-[var(--accent-blue)]" /> Il tuo marchio
      </h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Logo, colori e font usati nei caroselli creati dall’Assistente.</p>
      {!brand ? (
        <Loader2 className="mt-4 h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      ) : (
        <div className="mt-4 space-y-5">
          {/* Logo */}
          <div>
            <p className="text-sm font-semibold">Logo</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div
                className="flex h-20 w-32 items-center justify-center rounded-xl border border-[var(--border-color)]"
                style={{ backgroundImage: 'repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}
              >
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo} alt="Logo" className="max-h-16 max-w-28 object-contain" />
                ) : (
                  <span className="text-xs text-[var(--text-secondary)]">Nessun logo</span>
                )}
              </div>
              {canEdit && (
                <>
                  <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => upload('logo', e.target.files?.[0])} />
                  <button onClick={() => logoRef.current?.click()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm disabled:opacity-50">
                    {busy === 'logo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {brand.logo ? 'Cambia logo' : 'Carica logo'}
                  </button>
                  {brand.logo && (
                    <button
                      onClick={() => call('logo-off', { method: 'DELETE' }, '/api/app/brand?what=logo', 'Logo tolto.')}
                      disabled={busy !== null}
                      aria-label="Togli il logo"
                      className="p-1.5 text-[var(--text-secondary)] disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Meglio un PNG con lo sfondo trasparente: va in alto su ogni slide.</p>
          </div>

          {/* Colori e firma */}
          <div>
            <p className="text-sm font-semibold">Colori e firma</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {(
                [
                  ['dark', 'Scuro (sfondi)'],
                  ['accent', 'Principale'],
                  ['light', 'Chiaro'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-2 py-1.5 text-xs">
                  <input
                    type="color"
                    value={colors[key]}
                    onChange={(e) => setColors((c) => ({ ...c, [key]: e.target.value }))}
                    disabled={!canEdit}
                    className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span>
                    {label}
                    <span className="block font-mono text-[10px] text-[var(--text-secondary)]">{colors[key]}</span>
                  </span>
                </label>
              ))}
            </div>
            <input
              value={colors.handle}
              onChange={(e) => setColors((c) => ({ ...c, handle: e.target.value }))}
              readOnly={!canEdit}
              maxLength={40}
              placeholder="Firma in fondo alle slide (es. @tuonome)"
              className="mt-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px] md:text-sm"
            />
            {canEdit && colorsChanged && (
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => call('colors', { method: 'PATCH', body: JSON.stringify(colors) }, undefined, 'Colori salvati.')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy === 'colors' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva colori
                </button>
              </div>
            )}
          </div>

          {/* Font */}
          <div>
            <p className="text-sm font-semibold">Font</p>
            <input ref={fontRef} type="file" accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff" className="hidden" onChange={(e) => upload('font', e.target.files?.[0])} />
            <div className="mt-2 space-y-2">
              {(
                [
                  ['heading', 'Titoli'],
                  ['body', 'Testi'],
                ] as const
              ).map(([role, label]) => (
                <div key={role} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-sm">
                  <Type className="h-4 w-4 text-[var(--accent-blue)]" />
                  <span className="w-14 text-[var(--text-secondary)]">{label}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {brand.fonts[role] || (role === 'body' && brand.fonts.heading ? `${brand.fonts.heading} (come i titoli)` : 'Predefinito (Inter Tight)')}
                  </span>
                  {canEdit && (
                    <>
                      <button onClick={() => pickFont(role)} disabled={busy !== null} className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs disabled:opacity-50">
                        {busy === `font-${role}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : brand.fonts[role] ? 'Cambia' : 'Carica'}
                      </button>
                      {brand.fonts[role] && (
                        <button
                          onClick={() => call(`font-${role}-off`, { method: 'DELETE' }, `/api/app/brand?what=${role}`, 'Font tolto.')}
                          disabled={busy !== null}
                          aria-label={`Togli il font dei ${label.toLowerCase()}`}
                          className="p-1 text-[var(--text-secondary)] disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <button onClick={() => pickFont('both')} disabled={busy !== null} className="mt-2 text-xs font-semibold text-[var(--accent-blue)] disabled:opacity-50">
                {busy === 'font-both' ? 'Carico…' : 'Hai un solo font? Caricalo qui per titoli e testi insieme'}
              </button>
            )}
            <p className="mt-1 text-xs text-[var(--text-secondary)]">File .ttf, .otf o .woff (non .woff2), massimo 3 MB. Se carichi solo il font dei titoli, si usa anche per i testi.</p>
          </div>

          {error && <p className="text-sm text-[#FF3B30]">{error}</p>}
          {notice && <p className="text-sm text-[#34C759]">{notice}</p>}
        </div>
      )}
    </section>
  )
}

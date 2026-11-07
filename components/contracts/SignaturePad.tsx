'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

// Firma col dito (o col mouse) per i contratti: Pointer Events su un canvas con touch-action: none
// (la pagina non scorre mentre si firma, anche su iPhone Safari), nitido sugli schermi ad alta
// densita' (devicePixelRatio). I tratti si salvano come punti da 0 a 1000 nella larghezza e
// nell'altezza del riquadro (vettoriali, poi semplificati sul server) con le proporzioni del riquadro.

export type SignatureValue = { strokes: number[][][]; ratio: number }

/** Larghezza / altezza del riquadro. */
const RATIO = 2.8
const MAX_STROKES = 40
const MAX_POINTS = 2500
/** Punti piu' vicini di cosi' (su 1000) non si aggiungono. */
const MIN_STEP = 3

export default function SignaturePad({ onChange, disabled = false, label = 'Firma qui col dito' }: { onChange: (value: SignatureValue | null) => void; disabled?: boolean; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<number[][][]>([])
  const active = useRef<number | null>(null)
  const size = useRef({ w: 0, h: 0 })
  const [empty, setEmpty] = useState(true)

  const redraw = useCallback(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1b2559'
    for (const stroke of strokes.current) {
      if (!stroke.length) continue
      ctx.beginPath()
      stroke.forEach(([x, y], i) => (i === 0 ? ctx.moveTo((x / 1000) * w, (y / 1000) * h) : ctx.lineTo((x / 1000) * w, (y / 1000) * h)))
      if (stroke.length === 1) ctx.lineTo((stroke[0][0] / 1000) * w + 0.5, (stroke[0][1] / 1000) * h)
      ctx.stroke()
    }
  }, [])

  // Il riquadro segue la larghezza della pagina (rotazione del telefono compresa).
  useEffect(() => {
    const el = canvas.current
    const wrap = box.current
    if (!el || !wrap) return
    const fit = () => {
      const w = Math.max(200, wrap.clientWidth)
      const h = Math.round(w / RATIO)
      const dpr = window.devicePixelRatio || 1
      size.current = { w, h }
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      el.style.width = `${w}px`
      el.style.height = `${h}px`
      redraw()
    }
    fit()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    observer?.observe(wrap)
    window.addEventListener('orientationchange', fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('orientationchange', fit)
    }
  }, [redraw])

  const total = () => strokes.current.reduce((n, s) => n + s.length, 0)
  const pointOf = (clientX: number, clientY: number) => {
    const rect = (canvas.current as HTMLCanvasElement).getBoundingClientRect()
    const clamp = (v: number) => Math.round(Math.min(1000, Math.max(0, v)))
    return [clamp(((clientX - rect.left) / rect.width) * 1000), clamp(((clientY - rect.top) / rect.height) * 1000)]
  }
  const emit = () => {
    const done = strokes.current.filter((s) => s.length)
    onChange(done.length ? { strokes: done.map((s) => s.map((p) => [p[0], p[1]])), ratio: RATIO } : null)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || active.current !== null || strokes.current.length >= MAX_STROKES || total() >= MAX_POINTS) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    active.current = e.pointerId
    strokes.current.push([pointOf(e.clientX, e.clientY)])
    setEmpty(false)
    redraw()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (active.current !== e.pointerId) return
    e.preventDefault()
    const stroke = strokes.current[strokes.current.length - 1]
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    const events = native.getCoalescedEvents?.() || []
    for (const ev of events.length ? events : [native]) {
      if (total() >= MAX_POINTS) break
      const p = pointOf(ev.clientX, ev.clientY)
      const last = stroke[stroke.length - 1]
      if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= MIN_STEP) stroke.push(p)
    }
    redraw()
  }
  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (active.current !== e.pointerId) return
    active.current = null
    emit()
  }
  const clear = () => {
    strokes.current = []
    active.current = null
    setEmpty(true)
    redraw()
    onChange(null)
  }

  return (
    <div>
      <div ref={box} className="relative w-full overflow-hidden rounded-xl border-2 border-dashed border-[#c7cbd6] bg-white">
        <canvas
          ref={canvas}
          aria-label={label}
          role="img"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={onPointerEnd}
          style={{ touchAction: 'none', display: 'block' }}
          className={`select-none ${disabled ? 'opacity-60' : 'cursor-crosshair'}`}
        />
        {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#9aa0ae]">{label}</p>}
        <div className="pointer-events-none absolute inset-x-6 bottom-6 border-b border-[#d6d9e0]" />
      </div>
      <div className="mt-1.5 flex justify-end">
        <button type="button" onClick={clear} disabled={disabled || empty} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[#4b5263] disabled:opacity-40">
          <Eraser className="h-4 w-4" /> Cancella
        </button>
      </div>
    </div>
  )
}

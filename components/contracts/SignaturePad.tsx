'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

// Firma col dito (o col mouse) sullo schermo. Pointer Events con touch-action: none,
// cosi' su iPhone Safari il dito disegna invece di scorrere la pagina; canvas nitido
// sugli schermi ad alta densita'. I tratti si salvano come punti da 0 a 1000 nel
// riquadro (largo 3 volte l'altezza): gli stessi che finiscono, vettoriali, nel PDF.

const MAX_POINTS = 6000

export default function SignaturePad({ onChange, disabled, label = 'Firma qui col dito' }: { onChange: (strokes: number[][]) => void; disabled?: boolean; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<number[][]>([])
  const active = useRef<{ id: number; stroke: number[] } | null>(null)
  const points = useRef(0)
  const [empty, setEmpty] = useState(true)

  const setup = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a2a73'
    ctx.fillStyle = '#1a2a73'
    return { ctx, rect }
  }, [])

  const toPx = (rect: DOMRect, x: number, y: number): [number, number] => [(x / 1000) * rect.width, (y / 1000) * rect.height]

  const redraw = useCallback(() => {
    const s = setup()
    if (!s) return
    const { ctx, rect } = s
    ctx.clearRect(0, 0, rect.width, rect.height)
    for (const stroke of strokes.current) {
      if (stroke.length < 2) continue
      ctx.beginPath()
      const [x0, y0] = toPx(rect, stroke[0], stroke[1])
      if (stroke.length === 2) {
        ctx.arc(x0, y0, 1.3, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.moveTo(x0, y0)
      for (let i = 2; i + 1 < stroke.length; i += 2) {
        const [x, y] = toPx(rect, stroke[i], stroke[i + 1])
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }, [setup])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    redraw()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redraw()) : null
    ro?.observe(canvas)
    return () => ro?.disconnect()
  }, [redraw])

  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.round(Math.min(1000, Math.max(0, ((e.clientX - rect.left) / rect.width) * 1000)))
    const y = Math.round(Math.min(1000, Math.max(0, ((e.clientY - rect.top) / rect.height) * 1000)))
    return [x, y]
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || active.current || points.current >= MAX_POINTS) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const [x, y] = point(e)
    const stroke = [x, y]
    strokes.current.push(stroke)
    active.current = { id: e.pointerId, stroke }
    points.current++
    redraw()
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current
    if (!a || a.id !== e.pointerId) return
    e.preventDefault()
    const native = e.nativeEvent as PointerEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native]
    const s = setup()
    for (const ev of events.length ? events : [native]) {
      if (points.current >= MAX_POINTS) break
      const [x, y] = point(ev)
      const lx = a.stroke[a.stroke.length - 2]
      const ly = a.stroke[a.stroke.length - 1]
      if (Math.abs(x - lx) + Math.abs(y - ly) < 2) continue
      a.stroke.push(x, y)
      points.current++
      if (s) {
        const [px, py] = toPx(s.rect, lx, ly)
        const [qx, qy] = toPx(s.rect, x, y)
        s.ctx.beginPath()
        s.ctx.moveTo(px, py)
        s.ctx.lineTo(qx, qy)
        s.ctx.stroke()
      }
    }
  }

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current
    if (!a || a.id !== e.pointerId) return
    active.current = null
    const copy = strokes.current.map((s) => [...s])
    setEmpty(copy.length === 0)
    onChange(copy)
  }

  const clear = () => {
    strokes.current = []
    active.current = null
    points.current = 0
    setEmpty(true)
    redraw()
    onChange([])
  }

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          role="img"
          aria-label={label}
          className={`block w-full touch-none select-none rounded-xl border-2 border-dashed bg-white ${disabled ? 'border-[#d0d0d6] opacity-60' : 'border-[#9a9aa6]'}`}
          style={{ aspectRatio: '3 / 1', touchAction: 'none', WebkitUserSelect: 'none' }}
        />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#9a9aa6]">{label}</span>}
        <span className="pointer-events-none absolute bottom-[22%] left-[6%] right-[6%] border-b border-[#d0d0d6]" />
      </div>
      <div className="mt-1.5 flex justify-end">
        <button type="button" onClick={clear} disabled={disabled || empty} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[#d0d0d6] px-4 py-2 text-sm text-[#1d1d1f] disabled:opacity-40">
          <Eraser className="h-4 w-4" /> Cancella
        </button>
      </div>
    </div>
  )
}

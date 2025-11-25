'use client'

import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  radius: number
  vx: number
  vy: number
  color: string
  opacity: number
}

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationFrameRef = useRef<number>()
  const isMouseMovingRef = useRef(false)
  const mouseXRef = useRef(0)
  const mouseYRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    // Imposta dimensioni canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Configurazione particelle
    const maxParticles = 200 // Più particelle per un effetto più espanso
    const minRadius = 0.5 // Particelle molto piccole
    const maxRadius = 1.5
    const minSpeed = 0.1 // Movimento molto lento
    const maxSpeed = 0.3

    // Colori per le particelle (bianco/grigio chiaro)
    const colors = ['rgba(255, 255, 255, 0.6)', 'rgba(255, 255, 255, 0.4)', 'rgba(255, 255, 255, 0.3)', 'rgba(200, 200, 200, 0.5)']

    // Crea particelle iniziali distribuite su tutta l'area
    const createParticle = (x?: number, y?: number): Particle => {
      return {
        x: x ?? Math.random() * canvas.width,
        y: y ?? Math.random() * canvas.height,
        radius: Math.random() * (maxRadius - minRadius) + minRadius,
        vx: (Math.random() - 0.5) * maxSpeed,
        vy: (Math.random() - 0.5) * maxSpeed,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: Math.random() * 0.5 + 0.3,
      }
    }

    // Inizializza particelle distribuite su tutta l'area
    for (let i = 0; i < maxParticles; i++) {
      particlesRef.current.push(createParticle())
    }

    // Genera particelle quando il mouse si muove
    const generateParticles = (event: MouseEvent) => {
      if (particlesRef.current.length < maxParticles * 1.5) {
        const particle = createParticle(event.x, event.y)
        particlesRef.current.push(particle)
      }
    }

    // Gestione eventi mouse
    const handleMouseMove = (event: MouseEvent) => {
      isMouseMovingRef.current = true
      mouseXRef.current = event.x
      mouseYRef.current = event.y
      generateParticles(event)
    }

    const handleMouseOut = () => {
      isMouseMovingRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseout', handleMouseOut)

    // Anima le particelle
    const animate = () => {
      context.clearRect(0, 0, canvas.width, canvas.height)

      // Aggiorna e disegna ogni particella
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const particle = particlesRef.current[i]

        // Aggiorna posizione (movimento molto lento)
        particle.x += particle.vx
        particle.y += particle.vy

        // Rimbalza ai bordi
        if (particle.x < 0 || particle.x > canvas.width) {
          particle.vx = -particle.vx
        }
        if (particle.y < 0 || particle.y > canvas.height) {
          particle.vy = -particle.vy
        }

        // Mantieni le particelle dentro il canvas
        particle.x = Math.max(0, Math.min(canvas.width, particle.x))
        particle.y = Math.max(0, Math.min(canvas.height, particle.y))

        // Riduci gradualmente la dimensione (opzionale)
        particle.radius *= 0.9995

        // Rimuovi particelle troppo piccole
        if (particle.radius <= 0.1) {
          particlesRef.current.splice(i, 1)
          // Aggiungi una nuova particella per mantenere il numero
          if (particlesRef.current.length < maxParticles) {
            particlesRef.current.push(createParticle())
          }
          continue
        }

        // Disegna la particella
        context.beginPath()
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fillStyle = particle.color.replace('0.6', particle.opacity.toString())
        context.fill()
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    // Cleanup
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseout', handleMouseOut)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
      style={{ background: 'transparent' }}
    />
  )
}


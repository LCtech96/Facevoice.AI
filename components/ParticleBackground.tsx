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
  createdAt: number // Timestamp di creazione
  initialOpacity: number // Opacità iniziale per calcolare il fade
}

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationFrameRef = useRef<number>()
  const isMouseMovingRef = useRef(false)
  const mouseXRef = useRef(0)
  const mouseYRef = useRef(0)
  // Traccia la velocità del mouse per far seguire le particelle - devono essere a livello componente
  const lastMouseXRef = useRef(0)
  const lastMouseYRef = useRef(0)
  const lastMouseTimeRef = useRef(Date.now())

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
    const createParticle = (x?: number, y?: number, isMouseGenerated: boolean = false): Particle => {
      const opacity = isMouseGenerated ? (Math.random() * 0.4 + 0.5) : (Math.random() * 0.5 + 0.3)
      return {
        x: x ?? Math.random() * canvas.width,
        y: y ?? Math.random() * canvas.height,
        radius: Math.random() * (maxRadius - minRadius) + minRadius,
        vx: (Math.random() - 0.5) * maxSpeed,
        vy: (Math.random() - 0.5) * maxSpeed,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: opacity,
        createdAt: Date.now(),
        initialOpacity: opacity,
      }
    }

    // Inizializza particelle distribuite su tutta l'area
    for (let i = 0; i < maxParticles; i++) {
      particlesRef.current.push(createParticle())
    }

    // Genera particelle quando il mouse si muove - PRODUZIONE INFINITA
    const generateParticles = (event: MouseEvent, mouseVx: number, mouseVy: number) => {
      // Calcola la velocità del mouse per determinare quante particelle creare
      const mouseSpeed = Math.sqrt(mouseVx * mouseVx + mouseVy * mouseVy)
      
      // Crea più particelle se il mouse si muove velocemente, meno se si muove lentamente
      // Minimo 3 particelle, massimo 10
      const baseParticles = 3
      const speedMultiplier = Math.min(mouseSpeed / 50, 1) // Normalizza la velocità
      const particlesToCreate = baseParticles + Math.floor(speedMultiplier * 7)
      
      // RIMOSSO IL LIMITE - Produzione infinita di particelle
      for (let i = 0; i < particlesToCreate; i++) {
        // Aggiungi un po' di randomicità alla posizione per evitare che siano tutte sovrapposte
        const offsetX = (Math.random() - 0.5) * 15
        const offsetY = (Math.random() - 0.5) * 15
        
        // Calcola la direzione del movimento del mouse
        const directionX = mouseVx !== 0 ? mouseVx / Math.max(Math.abs(mouseVx), 1) : (Math.random() - 0.5)
        const directionY = mouseVy !== 0 ? mouseVy / Math.max(Math.abs(mouseVy), 1) : (Math.random() - 0.5)
        
        // Le particelle seguono meglio la direzione del mouse
        const followStrength = Math.min(mouseSpeed / 100, 0.8) // Più forte se il mouse si muove velocemente
        const randomComponent = 0.3 // Componente casuale ridotta per seguire meglio
        
        const initialOpacity = Math.random() * 0.4 + 0.5
        const particle: Particle = {
          x: event.x + offsetX,
          y: event.y + offsetY,
          radius: Math.random() * (maxRadius - minRadius) + minRadius,
          // Le particelle seguono la direzione del mouse con una componente casuale più piccola
          vx: directionX * followStrength * maxSpeed + (Math.random() - 0.5) * maxSpeed * randomComponent,
          vy: directionY * followStrength * maxSpeed + (Math.random() - 0.5) * maxSpeed * randomComponent,
          color: colors[Math.floor(Math.random() * colors.length)],
          opacity: initialOpacity,
          createdAt: Date.now(), // Timestamp di creazione
          initialOpacity: initialOpacity,
        }
        particlesRef.current.push(particle)
      }
    }

    // Gestione eventi mouse
    const handleMouseMove = (event: MouseEvent) => {
      isMouseMovingRef.current = true
      
      // Calcola la velocità del mouse in modo più accurato
      const now = Date.now()
      const timeDelta = Math.max(now - lastMouseTimeRef.current, 1) // Minimo 1ms per evitare divisioni per zero
      
      // Calcola la distanza percorsa
      const dx = event.x - lastMouseXRef.current
      const dy = event.y - lastMouseYRef.current
      
      // Calcola la velocità in pixel per frame (normalizzata)
      const mouseVx = (dx / timeDelta) * 16 // 16ms = ~60fps
      const mouseVy = (dy / timeDelta) * 16
      
      // Se è il primo movimento, inizializza i valori
      if (lastMouseXRef.current === 0 && lastMouseYRef.current === 0) {
        lastMouseXRef.current = event.x
        lastMouseYRef.current = event.y
        lastMouseTimeRef.current = now
        mouseXRef.current = event.x
        mouseYRef.current = event.y
        // Genera particelle anche al primo movimento
        generateParticles(event, 0, 0)
        return
      }
      
      // Aggiorna i riferimenti
      lastMouseXRef.current = event.x
      lastMouseYRef.current = event.y
      lastMouseTimeRef.current = now
      mouseXRef.current = event.x
      mouseYRef.current = event.y
      
      // Genera particelle che seguono il movimento del mouse (sempre, anche se il mouse si muove lentamente)
      generateParticles(event, mouseVx, mouseVy)
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

        // Calcola l'età della particella in millisecondi
        const age = Date.now() - particle.createdAt
        const isMouseGenerated = particle.initialOpacity > 0.4

        if (isMouseGenerated) {
          // Particelle generate dal mouse: iniziano a scomparire dopo 3 secondi (3000ms)
          if (age > 3000) {
            // Dopo 3 secondi, inizia il fade out
            const fadeStartTime = 3000
            const fadeDuration = 2000 // 2 secondi per scomparire completamente
            const fadeProgress = Math.min((age - fadeStartTime) / fadeDuration, 1)
            
            // Riduci opacità e dimensione durante il fade
            particle.opacity = particle.initialOpacity * (1 - fadeProgress)
            particle.radius *= 0.998
          } else {
            // Nei primi 3 secondi, mantieni opacità e dimensione stabili
            particle.opacity = particle.initialOpacity
          }
        } else {
          // Particelle base: scompaiono più lentamente
          particle.radius *= 0.999
          particle.opacity *= 0.998
        }

        // Rimuovi particelle troppo piccole, troppo trasparenti o troppo vecchie
        const shouldRemove = 
          particle.radius <= 0.1 || 
          particle.opacity <= 0.05 ||
          (isMouseGenerated && age > 5000) // Rimuovi dopo 5 secondi totali (3s + 2s fade)

        if (shouldRemove) {
          particlesRef.current.splice(i, 1)
          // Mantieni sempre un numero minimo di particelle base
          if (!isMouseGenerated && particlesRef.current.length < maxParticles) {
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


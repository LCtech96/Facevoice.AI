'use client'

import { motion } from 'framer-motion'

export default function LiquidGlass() {
  return (
    <div className="fixed inset-0 pointer-events-none z-[1] overflow-hidden">
      {/* Forma liquida 1 - Centro sinistra */}
      <motion.div
        className="absolute liquid-glass-blob"
        style={{
          top: '20%',
          left: '5%',
          width: '400px',
          height: '500px',
        }}
        animate={{
          y: [0, 40, 0],
          x: [0, 30, 0],
          scale: [1, 1.08, 1],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <svg viewBox="0 0 400 500" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <filter id="liquid-filter-1" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
            </filter>
          </defs>
          <path
            d="M200,80 Q280,120 320,200 T340,320 Q320,400 260,450 T160,470 Q80,440 50,360 T40,220 Q60,130 140,90 Z"
            fill="rgba(255, 255, 255, 0.08)"
            filter="url(#liquid-filter-1)"
            style={{
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            }}
          />
        </svg>
      </motion.div>

      {/* Forma liquida 2 - Centro destra (interconnessa) */}
      <motion.div
        className="absolute liquid-glass-blob"
        style={{
          top: '25%',
          left: '35%',
          width: '450px',
          height: '480px',
        }}
        animate={{
          y: [0, -35, 0],
          x: [0, -25, 0],
          scale: [1, 0.96, 1],
        }}
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 1.5,
        }}
      >
        <svg viewBox="0 0 450 480" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <filter id="liquid-filter-2" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
            </filter>
          </defs>
          <path
            d="M225,70 Q330,100 390,180 T410,300 Q390,380 320,430 T200,440 Q90,410 40,320 T30,180 Q55,90 150,60 Z"
            fill="rgba(255, 255, 255, 0.07)"
            filter="url(#liquid-filter-2)"
            style={{
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            }}
          />
        </svg>
      </motion.div>

      {/* Forma liquida 3 - Destra */}
      <motion.div
        className="absolute liquid-glass-blob"
        style={{
          top: '30%',
          right: '10%',
          width: '380px',
          height: '450px',
        }}
        animate={{
          y: [0, 25, 0],
          x: [0, -20, 0],
          scale: [1, 1.04, 1],
        }}
        transition={{
          duration: 13,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 3,
        }}
      >
        <svg viewBox="0 0 380 450" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <filter id="liquid-filter-3" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
            </filter>
          </defs>
          <path
            d="M190,60 Q270,90 330,160 T350,280 Q330,360 270,410 T160,420 Q70,390 30,300 T20,160 Q45,75 130,50 Z"
            fill="rgba(255, 255, 255, 0.06)"
            filter="url(#liquid-filter-3)"
            style={{
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            }}
          />
        </svg>
      </motion.div>

      {/* Forma liquida 4 - Basso sinistra */}
      <motion.div
        className="absolute liquid-glass-blob"
        style={{
          bottom: '15%',
          left: '15%',
          width: '350px',
          height: '400px',
        }}
        animate={{
          y: [0, -30, 0],
          x: [0, 15, 0],
          scale: [1, 0.98, 1],
        }}
        transition={{
          duration: 11,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 0.8,
        }}
      >
        <svg viewBox="0 0 350 400" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <filter id="liquid-filter-4" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
            </filter>
          </defs>
          <path
            d="M175,50 Q250,80 300,150 T320,270 Q300,350 240,390 T140,380 Q60,350 30,260 T20,140 Q45,60 120,40 Z"
            fill="rgba(255, 255, 255, 0.07)"
            filter="url(#liquid-filter-4)"
            style={{
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            }}
          />
        </svg>
      </motion.div>
    </div>
  )
}


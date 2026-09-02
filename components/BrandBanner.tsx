'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'

const brands = [
  { name: 'Nomadiqe', logo: '/nomadiqe.png', alt: 'Nomadiqe - startup affitti brevi' },
  { name: 'Ottica Focus', logo: '/Otticafocus.png', alt: 'Ottica Focus - ottica Palermo' },
  { name: 'Barinello', logo: '/Barinello.png', alt: 'Barinello' },
  { name: 'Trinacria', logo: '/Trinacria.jpg', alt: 'Trinacria' },
  { name: 'Revera', logo: '/clients/revera.png', alt: 'Revera Estetica Avanzata - centro estetico Carini' },
  { name: 'Seatour Palermo', logo: '/clients/seatourpalermo.png', alt: 'Seatour Palermo - luxury boat experience' },
  { name: 'Trattoria da Piero', logo: '/clients/trattoria-piero.png', alt: 'Trattoria da Piero - ristorante Mondello' },
  { name: 'Bird Terrasini', logo: '/clients/bird-terrasini.png', alt: 'Bird Terrasini - ristorante e pizzeria' },
  { name: 'Sicily by Car', logo: '/clients/sicilybycar.svg', alt: 'Sicily by Car - noleggio auto' },
  { name: 'KrainAI', logo: '/clients/krainai.svg', alt: 'KrainAI - infrastruttura per l\'economia AI' },
  { name: 'Deploy in Produzione', logo: '/clients/deploy-in-produzione.svg', alt: 'Deploy in Produzione' },
]

const logoClassName = 'h-10 md:h-12 w-auto object-contain max-w-[120px] md:max-w-[140px]'

function BrandLogo({ brand }: { brand: (typeof brands)[number] }) {
  if (brand.logo.endsWith('.svg')) {
    return (
      <img
        src={brand.logo}
        alt={brand.alt}
        className={logoClassName}
        loading="lazy"
      />
    )
  }

  return (
    <Image
      src={brand.logo}
      alt={brand.alt}
      width={140}
      height={60}
      className={logoClassName}
    />
  )
}

export default function BrandBanner() {
  return (
    <section className="py-8 md:py-10 bg-[var(--background)] border-y border-[var(--border-color)]">
      <div className="container mx-auto px-4 max-w-6xl">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center text-xs md:text-sm text-[var(--text-secondary)] uppercase tracking-widest mb-6"
        >
          Hanno scelto di collaborare con noi
        </motion.p>
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10 lg:gap-12">
          {brands.map((brand, index) => (
            <motion.div
              key={brand.name}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center justify-center grayscale hover:grayscale-0 opacity-70 hover:opacity-100 transition-all duration-300"
            >
              <BrandLogo brand={brand} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

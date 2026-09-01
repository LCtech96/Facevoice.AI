'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'

const brands = [
  { name: 'Nomadiqe', logo: '/nomadiqe.png', alt: 'Nomadiqe - startup affitti brevi' },
  { name: 'Ottica Focus', logo: '/Otticafocus.png', alt: 'Ottica Focus - ottica Palermo' },
  { name: 'Barinello', logo: '/Barinello.png', alt: 'Barinello' },
  { name: 'Trinacria', logo: '/Trinacria.jpg', alt: 'Trinacria' },
]

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
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14">
          {brands.map((brand, index) => (
            <motion.div
              key={brand.name}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center justify-center grayscale hover:grayscale-0 opacity-70 hover:opacity-100 transition-all duration-300"
            >
              <Image
                src={brand.logo}
                alt={brand.alt}
                width={140}
                height={60}
                className="h-10 md:h-12 w-auto object-contain max-w-[120px] md:max-w-[140px]"
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

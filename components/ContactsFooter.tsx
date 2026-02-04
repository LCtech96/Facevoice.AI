'use client'

import { Mail, Phone, MessageSquare } from 'lucide-react'
import { usePathname } from 'next/navigation'

export default function ContactsFooter() {
  const pathname = usePathname()
  const phone = '+39 3513671340'
  const whatsapp = '+39 3514206353'
  const whatsappLink = `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`
  const email = 'luca@facevoice.ai'

  // Nascondi il footer sulla pagina intrattenimento
  if (pathname?.startsWith('/intrattenimento')) {
    return null
  }

  return (
    <footer className="mt-16 border-t border-[var(--border-color)] bg-[var(--background)]">
      <div className="container mx-auto max-w-6xl px-6 py-10">
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-6">
          Contatti
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href={`tel:${phone.replace(/\\s/g, '')}`}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 hover:bg-[var(--background-secondary)]/80 transition-colors"
            aria-label={`Chiama ${phone}`}
          >
            <Phone className="w-5 h-5 text-[var(--accent-blue)]" />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Telefono</p>
              <p className="text-[var(--text-primary)] font-medium">{phone}</p>
            </div>
          </a>

          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 hover:bg-[var(--background-secondary)]/80 transition-colors"
            aria-label={`Apri WhatsApp ${whatsapp}`}
          >
            <MessageSquare className="w-5 h-5 text-[var(--accent-blue)]" />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">WhatsApp</p>
              <p className="text-[var(--text-primary)] font-medium">{whatsapp}</p>
            </div>
          </a>

          <a
            href={`mailto:${email}`}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 hover:bg-[var(--background-secondary)]/80 transition-colors"
            aria-label={`Scrivi a ${email}`}
          >
            <Mail className="w-5 h-5 text-[var(--accent-blue)]" />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Email</p>
              <p className="text-[var(--text-primary)] font-medium break-all">{email}</p>
            </div>
          </a>
        </div>
      </div>
      {/* Spacing per mobile navbar fissa in basso */}
      <div className="md:hidden h-20" />
    </footer>
  )
}



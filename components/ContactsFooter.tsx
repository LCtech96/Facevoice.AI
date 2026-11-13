'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FilePenLine, Gauge, ListTodo, Mail, Phone, MessageSquare, Users, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { isAdminEmail } from '@/lib/admin-auth'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// Testi del footer: italiano per chi ha il sito in italiano, inglese per tutti gli altri.
const COPY = {
  it: {
    contacts: 'Contatti',
    phone: 'Telefono',
    call: 'Chiama',
    openWhatsapp: 'Apri WhatsApp',
    writeTo: 'Scrivi a',
    platform: 'Piattaforma',
    faq: 'Domande frequenti',
    privacy: 'Informativa Privacy',
    terms: 'Condizioni d’uso',
  },
  en: {
    contacts: 'Contacts',
    phone: 'Phone',
    call: 'Call',
    openWhatsapp: 'Open WhatsApp',
    writeTo: 'Write to',
    platform: 'Platform',
    faq: 'FAQ',
    privacy: 'Privacy Policy',
    terms: 'Terms of use',
  },
}

// Pagine del gestionale a schermo intero (Messaggi, Super chat): un footer sotto
// costringerebbe a scorrere per tornare alla conversazione.
const FULL_SCREEN_ADMIN = ['/admin/inbox', '/admin/assistant']

/** Admin collegato? Stesso controllo del menu in alto; i permessi veri li verifica il server. */
function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    let alive = true
    supabase.auth.getSession().then(({ data }) => alive && setIsAdmin(isAdminEmail(data.session?.user.email)))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setIsAdmin(isAdminEmail(session?.user.email)))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  return isAdmin
}

/** Pulsante del footer per l'admin. */
function AdminButton({ href, label, Icon, active }: { href: string; label: string; Icon: LucideIcon; active?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
          : 'border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  )
}

/** Pulsanti "Utenti" (iscritti alla beta) e "Consumi" (consumi reali): solo per l'admin. */
function AdminButtons({ pathname }: { pathname?: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <AdminButton href="/admin/utenti" label="Utenti" Icon={Users} active={Boolean(pathname?.startsWith('/admin/utenti'))} />
      <AdminButton href="/admin/consumi" label="Consumi" Icon={Gauge} active={Boolean(pathname?.startsWith('/admin/consumi'))} />
      <AdminButton href="/admin/contratti" label="Contratti" Icon={FilePenLine} active={Boolean(pathname?.startsWith('/admin/contratti'))} />
      <AdminButton href="/admin/todo" label="Todo" Icon={ListTodo} active={Boolean(pathname?.startsWith('/admin/todo'))} />
    </div>
  )
}

export default function ContactsFooter() {
  const pathname = usePathname()
  const isAdmin = useIsAdmin()
  const { language } = useTranslation()
  const c = COPY[language === 'it' ? 'it' : 'en']

  // La chat occupa lo schermo intero: un footer sotto costringerebbe a
  // scorrere la pagina per tornare ai messaggi.
  if (pathname?.startsWith('/ai-chat')) return null
  // Pagina del contratto per chi riceve il link: solo il contratto, niente contatti del sito.
  if (pathname?.startsWith('/c/')) return null
  // Todo list condivisa (/todo/…): pagina a sé, niente collegamenti al resto del sito.
  if (pathname?.startsWith('/todo/')) return null

  // Nell'area admin i contatti dell'azienda non servono: per l'admin resta
  // solo una riga con i pulsanti Utenti e Consumi, per gli altri niente footer.
  if (pathname?.startsWith('/admin')) {
    if (!isAdmin || FULL_SCREEN_ADMIN.some((p) => pathname.startsWith(p))) return null
    return (
      <footer className="border-t border-[var(--border-color)] bg-[var(--background)]">
        <div className="container mx-auto max-w-6xl px-4 py-4 flex justify-center sm:justify-end">
          <AdminButtons pathname={pathname} />
        </div>
        {/* Spacing per mobile navbar fissa in basso */}
        <div className="md:hidden h-20" />
      </footer>
    )
  }

  const phone = '+39 3513671340'
  const whatsapp = '+39 3514206353'
  const whatsappLink = `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`
  const email = 'info@facevoice.ai'

  return (
    <footer className={`theme-ember mt-16 border-t border-[var(--border-color)] bg-[var(--background)]`}>
      <div className="container mx-auto max-w-6xl px-6 py-10">
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-6">
          {c.contacts}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href={`tel:${phone.replace(/\\s/g, '')}`}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 hover:bg-[var(--background-secondary)]/80 transition-colors"
            aria-label={`${c.call} ${phone}`}
          >
            <Phone className="w-5 h-5 text-[var(--accent-blue)]" />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">{c.phone}</p>
              <p className="text-[var(--text-primary)] font-medium">{phone}</p>
            </div>
          </a>

          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 hover:bg-[var(--background-secondary)]/80 transition-colors"
            aria-label={`${c.openWhatsapp} ${whatsapp}`}
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
            aria-label={`${c.writeTo} ${email}`}
          >
            <Mail className="w-5 h-5 text-[var(--accent-blue)]" />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Email</p>
              <p className="text-[var(--text-primary)] font-medium break-all">{email}</p>
            </div>
          </a>
        </div>

        <div className="mt-8 pt-6 border-t border-[var(--border-color)]">
          <Link
            href="/piattaforma"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors mr-5"
          >
            {c.platform}
          </Link>
          <Link
            href="/faq"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors mr-5"
          >
            {c.faq}
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
          >
            {c.privacy}
          </Link>
          <Link
            href="/termini"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors ml-5"
          >
            {c.terms}
          </Link>
          {isAdmin && (
            <div className="mt-4">
              <AdminButtons />
            </div>
          )}
        </div>
      </div>
      {/* Spacing per mobile navbar fissa in basso */}
      <div className="md:hidden h-20" />
    </footer>
  )
}



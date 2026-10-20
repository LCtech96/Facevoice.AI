// Pagine del gestionale che l'admin puo' aprire ai dipendenti, con le azioni
// consentite in ognuna. "view" e' sempre la base: senza, la pagina e' chiusa.
// Gestione (utenti, permessi), notifiche push e collegamento Gmail restano
// sempre e solo dell'admin. Condiviso tra server e browser.

export const STAFF_PAGES = {
  inbox: {
    label: 'Messaggi',
    href: '/admin/inbox',
    caps: {
      view: 'Vedere le conversazioni',
      reply: 'Rispondere, approvare ed eliminare',
    },
  },
  leads: {
    label: 'Clienti',
    href: '/admin/leads',
    caps: {
      view: 'Vedere schede e ricerche fatte',
      calls: 'Segnare chiamate, stato e note, scaricare i numeri',
      search: 'Fare nuove ricerche e analisi',
      email: 'Modificare e inviare email',
      assistant: "Usare l'assistente della pagina",
    },
  },
  contacts: {
    label: 'Contatti',
    href: '/admin/contacts',
    caps: {
      view: 'Vedere la rubrica contatti',
      edit: 'Aggiungere e modificare contatti',
    },
  },
  assistant: {
    label: 'Super chat',
    href: '/admin/assistant',
    caps: {
      view: 'Vedere la conversazione',
      use: 'Scrivere alla super chat',
    },
  },
  control: {
    label: 'Canali e AI',
    href: '/admin/control',
    caps: {
      view: 'Vedere memoria, canali e post',
      edit: 'Modificare',
    },
  },
  usage: {
    label: 'Consumi',
    href: '/admin/usage',
    caps: {
      view: 'Vedere i consumi',
    },
  },
} as const

export type StaffPage = keyof typeof STAFF_PAGES
export type StaffPermissions = Partial<Record<StaffPage, string[]>>

export const STAFF_PAGE_IDS = Object.keys(STAFF_PAGES) as StaffPage[]

export const isStaffPage = (value: unknown): value is StaffPage =>
  typeof value === 'string' && (STAFF_PAGE_IDS as string[]).includes(value)

/** Tiene solo pagine e azioni esistenti; una pagina senza "view" non e' aperta. */
export function cleanPermissions(input: unknown): StaffPermissions {
  const out: StaffPermissions = {}
  if (!input || typeof input !== 'object') return out
  for (const [page, caps] of Object.entries(input as Record<string, unknown>)) {
    if (!isStaffPage(page) || !Array.isArray(caps)) continue
    const known = Object.keys(STAFF_PAGES[page].caps)
    const list = [...new Set(caps.filter((c): c is string => typeof c === 'string' && known.includes(c)))]
    if (!list.includes('view')) continue
    out[page] = list
  }
  return out
}

export function hasCap(perms: StaffPermissions | null | undefined, page: StaffPage, cap = 'view') {
  const caps = perms?.[page]
  return Boolean(caps?.includes('view') && caps.includes(cap))
}

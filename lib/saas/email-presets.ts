// Server di posta dei fornitori piu' usati in Italia. Per tutti serve una
// "password per le app" (o la password normale, se il fornitore la accetta via
// IMAP): la pagina di collegamento spiega dove crearla.

export type MailServer = { host: string; port: number }
export type EmailPreset = {
  id: string
  label: string
  domains: string[]
  imap: MailServer
  smtp: MailServer
  /** Il server salva da solo le email inviate nella cartella "Inviata". */
  savesSent: boolean
  /** Come ottenere la password da usare (testo per la pagina). */
  passwordHelp: string
  passwordUrl?: string
}

export const EMAIL_PRESETS: EmailPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 465 },
    savesSent: true,
    passwordHelp:
      'Serve una "password per le app": attiva la verifica in due passaggi sul tuo account Google, poi crea una password per le app e incollala qui (16 lettere).',
    passwordUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'aruba',
    label: 'Aruba',
    domains: ['aruba.it'],
    imap: { host: 'imaps.aruba.it', port: 993 },
    smtp: { host: 'smtps.aruba.it', port: 465 },
    savesSent: false,
    passwordHelp: 'Usa la password della casella email (quella della Webmail Aruba).',
  },
  {
    id: 'libero',
    label: 'Libero',
    domains: ['libero.it', 'inwind.it', 'iol.it', 'blu.it'],
    imap: { host: 'imapmail.libero.it', port: 993 },
    smtp: { host: 'smtp.libero.it', port: 465 },
    savesSent: false,
    passwordHelp: 'Usa la password della casella Libero. Se hai la verifica in due passaggi, crea una password per le app.',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: { host: 'imap.mail.me.com', port: 993 },
    smtp: { host: 'smtp.mail.me.com', port: 587 },
    savesSent: false,
    passwordHelp: 'Serve una "password specifica per le app": creala su account.apple.com, in Accesso e sicurezza.',
    passwordUrl: 'https://account.apple.com',
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.it'],
    imap: { host: 'imap.mail.yahoo.com', port: 993 },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465 },
    savesSent: false,
    passwordHelp: 'Serve una "password per le app": creala nelle impostazioni di sicurezza dell’account Yahoo.',
  },
]

export const presetById = (id: string) => EMAIL_PRESETS.find((p) => p.id === id) || null

export const presetForAddress = (email: string) => {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  return EMAIL_PRESETS.find((p) => p.domains.includes(domain)) || null
}

/** Porte ammesse: solo quelle della posta, mai altre (il server si collega dove dice il cliente). */
export const IMAP_PORTS = [993, 143]
export const SMTP_PORTS = [465, 587]

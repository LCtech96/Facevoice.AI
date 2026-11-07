// Testi e nomi dei contratti senza codice del server: li usano anche le pagine nel browser.

export const CONTRACT_STATUSES = ['bozza', 'inviato', 'modifica_richiesta', 'in_firma', 'firmato', 'annullato'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]
export const STATUS_LABEL: Record<ContractStatus, string> = {
  bozza: 'Bozza',
  inviato: 'Inviato',
  modifica_richiesta: 'Modifica richiesta',
  in_firma: 'In firma',
  firmato: 'Firmato',
  annullato: 'Annullato',
}

export const SHARE_CHANNELS = ['email', 'instagram', 'facebook', 'whatsapp', 'link'] as const
export type ShareChannel = (typeof SHARE_CHANNELS)[number]
export const CHANNEL_LABEL: Record<ShareChannel, string> = { email: 'Email', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', link: 'Solo link' }

/** Avviso sulla firma: solo nell'interfaccia di chi crea i contratti (mai nel PDF o nella pagina del link). */
export const SIGNATURE_NOTE = 'La firma è una firma elettronica semplice: valida per molti accordi privati, non per gli atti che richiedono la firma qualificata o l’atto notarile.'

/** Avviso legale per chi crea (chat e pagina interna del contratto): mai nel PDF o nella pagina del link. */
export const CREATOR_DISCLAIMER = 'Non sono un avvocato: fai controllare il documento da un professionista prima di firmarlo o inviarlo.'

export const PIN_PATTERN = /^[A-Za-z0-9]{4,12}$/

/** Evento del browser: la campanella apre un contratto (detail = id), la sua pagina se aperta si ricarica. */
export const CONTRACT_NOTE_EVENT = 'fv-contract-note'

const firstName = (name: string) => name.split(/\s+/)[0] || name

/** Testo proposto per accompagnare il link (il link e la frase sul PIN li aggiunge il server). */
export function defaultShareText(title: string, recipient: string, creator = 'Facevoice AI') {
  return `Ciao ${firstName(recipient)}, ti mando il contratto «${title}» tra ${creator} e ${recipient}. Dal link puoi leggerlo, chiedere una modifica o firmarlo anche dal telefono.`
}

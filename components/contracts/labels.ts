// Etichette e colori degli stati dei contratti (pagine Contratti dell'area clienti).
export type ContractStatus = 'bozza' | 'inviato' | 'modifica_richiesta' | 'in_firma' | 'firmato' | 'annullato'

export const STATUS_CHIPS: Record<ContractStatus, { label: string; tone: string }> = {
  bozza: { label: 'Bozza', tone: 'bg-[var(--background)] text-[var(--text-secondary)] border border-[var(--border-color)]' },
  inviato: { label: 'Inviato', tone: 'bg-[#0A84FF]/15 text-[#0A84FF]' },
  modifica_richiesta: { label: 'Modifica richiesta', tone: 'bg-[#FF9500]/15 text-[#FF9500]' },
  in_firma: { label: 'In firma', tone: 'bg-[#AF52DE]/15 text-[#BF5AF2]' },
  firmato: { label: 'Firmato', tone: 'bg-[#34C759]/15 text-[#34C759]' },
  annullato: { label: 'Annullato', tone: 'bg-[#FF3B30]/10 text-[#FF453A]' },
}

export const SIGNATURE_NOTE = 'La firma è una firma elettronica semplice: valida per molti accordi privati, non per gli atti che richiedono la firma qualificata o l’atto notarile.'

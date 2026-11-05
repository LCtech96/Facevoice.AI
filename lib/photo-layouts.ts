// Stili delle slide con le foto (usati dal disegno delle slide e dalla scelta nell'anteprima).
// Cambiarli rifa' le slide con gli stessi testi e foto.

export const PHOTO_LAYOUTS = [
  { id: 'classico', label: 'Classico', hint: 'foto a tutto schermo, testo in basso' },
  { id: 'fascia', label: 'Fascia', hint: 'foto in alto, testo su una fascia di colore' },
  { id: 'cornice', label: 'Cornice', hint: 'titolo sopra, foto incorniciata, testo sotto' },
  { id: 'minimal', label: 'Minimal', hint: 'foto quasi intera, solo il titolo' },
  { id: 'diviso', label: 'Diviso', hint: 'metà colore con il testo, metà foto' },
] as const

export type PhotoLayout = (typeof PHOTO_LAYOUTS)[number]['id']

export const asPhotoLayout = (value: unknown): PhotoLayout => (PHOTO_LAYOUTS.some((l) => l.id === value) ? (value as PhotoLayout) : 'classico')

/** Stili dei caroselli di solo testo (senza foto). */
export const TEXT_LAYOUTS = [
  { id: 'titolo', label: 'Grande titolo', hint: 'titolo grande e testo sotto' },
  { id: 'lista', label: 'Lista', hint: 'numero grande su ogni slide (01, 02…)' },
  { id: 'citazione', label: 'Citazione', hint: 'il testo in grande tra virgolette' },
] as const

export type TextLayout = (typeof TEXT_LAYOUTS)[number]['id']

export const asTextLayout = (value: unknown): TextLayout => (TEXT_LAYOUTS.some((l) => l.id === value) ? (value as TextLayout) : 'titolo')

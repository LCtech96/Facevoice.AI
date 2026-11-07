// Modelli tra cui scegliere nella Super chat (file senza dipendenze server:
// lo usano sia l'API sia la pagina).

/** "auto" = Gemini, poi Claude Haiku 5.5 quando Gemini e' al limite. */
export const AI_MODEL_CHOICES = [
  { id: 'auto', label: 'Automatico', hint: 'Gemini, poi Claude Haiku' },
  { id: 'gemini', label: 'Gemini Flash', hint: 'si ferma al limite' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: '$0,10 / $0,50 per milione di token' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: '$2 / $10 per milione di token' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: '$4 / $20 per milione di token' },
] as const
export type AIModelChoice = (typeof AI_MODEL_CHOICES)[number]['id']
/** Scelte salvate con un modello non piu' offerto. */
const LEGACY_CHOICES: Record<string, AIModelChoice> = { 'claude-haiku-4-5': 'claude-haiku-5-5' }
export const asModelChoice = (value: unknown): AIModelChoice =>
  AI_MODEL_CHOICES.some((m) => m.id === value)
    ? (value as AIModelChoice)
    : typeof value === 'string' && LEGACY_CHOICES[value]
      ? LEGACY_CHOICES[value]
      : 'auto'


/** Nome leggibile del modello effettivamente usato (es. "gemini-3.5-flash-lite"). */
export function modelLabel(model: string): string {
  if (model.startsWith('claude-haiku')) return 'Claude Haiku'
  if (model.startsWith('claude-sonnet')) return 'Claude Sonnet'
  if (model.startsWith('claude-opus')) return 'Claude Opus'
  if (model.startsWith('gemini')) return model.includes('lite') ? 'Gemini Flash-Lite' : 'Gemini Flash'
  return model
}

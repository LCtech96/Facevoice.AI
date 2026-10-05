// Riconoscimento leggero della lingua di un messaggio, senza AI: serve proprio
// quando l'AI non e' disponibile (es. limite gratuito raggiunto).

export type DetectedLanguage = 'it' | 'en' | 'fr' | 'es' | 'de' | 'pt' | 'ru' | 'ar' | 'zh'

const WORDS: Record<Exclude<DetectedLanguage, 'ru' | 'ar' | 'zh'>, string[]> = {
  it: ['ciao', 'il', 'che', 'non', 'per', 'sono', 'una', 'questo', 'come', 'grazie', 'della', 'perché', 'anche', 'cosa', 'voglio', 'puoi', 'fare', 'sei', 'mi', 'gli'],
  en: ['the', 'and', 'you', 'is', 'are', 'what', 'this', 'that', 'hello', 'hi', 'please', 'can', 'how', 'thanks', 'with', 'for', 'my', 'have', 'do', 'want'],
  fr: ['le', 'les', 'est', 'et', 'je', 'vous', 'bonjour', 'merci', 'pour', 'pas', 'une', 'des', 'que', 'qui', 'avec', 'mais', 'tu', 'suis', 'comment', 'oui'],
  es: ['el', 'los', 'es', 'y', 'que', 'hola', 'gracias', 'por', 'para', 'una', 'como', 'pero', 'muy', 'esto', 'quiero', 'puedes', 'estoy', 'qué', 'sí', 'tengo'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ich', 'nicht', 'du', 'sie', 'hallo', 'danke', 'mit', 'für', 'ein', 'eine', 'wie', 'was', 'bitte', 'auch', 'haben'],
  pt: ['olá', 'obrigado', 'obrigada', 'não', 'você', 'uma', 'para', 'com', 'que', 'isso', 'como', 'muito', 'estou', 'quero', 'pode', 'tudo', 'bem', 'mas', 'sim', 'é'],
}

/** Lingua piu' probabile del testo; inglese se non si capisce. */
export function detectLanguage(text: string): DetectedLanguage {
  if (/[Ѐ-ӿ]/.test(text)) return 'ru'
  if (/[؀-ۿ]/.test(text)) return 'ar'
  if (/[一-鿿]/.test(text)) return 'zh'
  const tokens = text.toLowerCase().match(/[\p{L}']+/gu) || []
  let best: DetectedLanguage = 'en'
  let bestScore = 0
  for (const [lang, words] of Object.entries(WORDS) as [DetectedLanguage, string[]][]) {
    const score = tokens.filter((t) => words.includes(t)).length
    if (score > bestScore) {
      best = lang
      bestScore = score
    }
  }
  return best
}

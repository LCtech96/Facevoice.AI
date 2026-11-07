// Lingua in cui rispondere a un messaggio o commento, senza chiamate AI: serve
// a dire all'AI in che lingua rispondere (commento in russo → risposta in russo).
// Nel dubbio restituisce null e decide l'AI leggendo il messaggio (a differenza di
// lib/detect-language, che sceglie sempre una lingua tra quelle del sito).

const SCRIPTS: [RegExp, string][] = [
  [/[Ѐ-ӿ]/g, 'russo (o la lingua in alfabeto cirillico in cui è scritto: ucraino, bulgaro, serbo…)'],
  [/[؀-ۿ]/g, 'arabo'],
  [/[֐-׿]/g, 'ebraico'],
  [/[Ͱ-Ͽ]/g, 'greco'],
  [/[぀-ヿ]/g, 'giapponese'],
  [/[가-힯]/g, 'coreano'],
  [/[一-鿿]/g, 'cinese'],
  [/[฀-๿]/g, 'thailandese'],
  [/[ऀ-ॿ]/g, 'hindi'],
]

// Parole comuni (gia' in minuscolo, senza punteggiatura) per le lingue con alfabeto latino.
const WORDS: Record<string, string[]> = {
  italiano: ['il', 'lo', 'gli', 'che', 'di', 'è', 'per', 'con', 'come', 'quanto', 'ciao', 'grazie', 'sono', 'una', 'del', 'della', 'non', 'anche', 'questo', 'vorrei', 'buongiorno', 'salve', 'costa', 'sì', 'si', 'vede', 'bene', 'prego', 'certo', 'perfetto', 'allora', 'però', 'perché', 'cosa', 'dove', 'quando', 'vero', 'tutto', 'molto', 'ancora', 'sempre', 'ho', 'hai', 'ha', 'sei', 'siete', 'abbiamo', 'mi', 'ti', 'ci', 'va', 'grazie', 'bello', 'bellissimo', 'bravi', 'brava', 'bravo', 'fatto', 'niente', 'adesso', 'oggi', 'domani', 'anch', 'chi', 'nel', 'nella', 'sul', 'alla', 'al', 'devo', 'devi', 'deve', 'sapere', 'qualcosa', 'qualcuno', 'necessario', 'necessaria', 'bisogno', 'servono', 'voglio', 'vuoi', 'puoi', 'può', 'quindi', 'capito', 'ecco', 'già', 'più', 'funziona', 'funzionano', 'scusa', 'scusate', 'quale', 'quali', 'fare'],
  inglese: ['the', 'and', 'you', 'is', 'are', 'to', 'of', 'for', 'with', 'what', 'how', 'this', 'that', 'your', 'can', 'do', 'my', 'please', 'hi', 'hello', 'much', 'price', 'thanks', 'want', 'love', 'yes', 'yeah', 'see', 'sounds', 'good', 'great', 'nice', 'sure', 'thank', 'awesome', 'cool', 'me', 'i', 'we', 'am', 'will', 'would', 'like', 'know', 'sorry', 'okay', 'it', 'be', 'have', 'not', 'there', 'who', 'when', 'where', 'why'],
  spagnolo: ['el', 'los', 'las', 'que', 'y', 'es', 'por', 'para', 'como', 'cuánto', 'cuanto', 'hola', 'gracias', 'usted', 'una', 'del', 'muy', 'quiero', 'precio', 'cómo', 'también'],
  francese: ['le', 'les', 'des', 'est', 'et', 'je', 'vous', 'pour', 'avec', 'bonjour', 'merci', 'combien', 'une', 'du', 'c’est', "c'est", 'très', 'nous', 'pas', 'prix'],
  tedesco: ['der', 'die', 'das', 'und', 'ist', 'ich', 'sie', 'nicht', 'mit', 'für', 'wie', 'viel', 'hallo', 'danke', 'ein', 'eine', 'auch', 'was', 'kostet', 'sehr'],
  portoghese: ['os', 'as', 'que', 'é', 'para', 'com', 'como', 'quanto', 'olá', 'obrigado', 'obrigada', 'você', 'uma', 'um', 'do', 'da', 'não', 'muito', 'preço', 'também', 'custa', 'assim', 'isso', 'olhá'],
}

const ACCENTS: [RegExp, string][] = [
  // ì e ò con l'accento grave sono quasi solo italiane.
  [/[ìò]/, 'italiano'],
  [/[ñ¿¡]/, 'spagnolo'],
  [/[ãõ]/, 'portoghese'],
  [/[ßäöü]/, 'tedesco'],
  [/[êâîôûëïç]/, 'francese'],
]

/**
 * Lingua (nome in italiano) e quanto e' sicura: clear = piu' parole tipiche (o un alfabeto
 * diverso), abbastanza per cambiare lingua a meta' conversazione. null se non e' chiaro.
 */
export function detectLanguage(text: string | null | undefined): { language: string; clear: boolean } | null {
  const value = (text || '').replace(/https?:\/\/\S+|@\w+|#\w+/g, ' ').trim()
  if (!value) return null

  const letters = (value.match(/\p{L}/gu) || []).length
  if (!letters) return null
  for (const [re, name] of SCRIPTS) {
    // Basta una parte consistente del testo in quell'alfabeto.
    if ((value.match(re) || []).length >= Math.max(2, letters * 0.3)) return { language: name, clear: true }
  }

  const tokens = value.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  const scores = Object.entries(WORDS).map(([lang, words]) => [lang, tokens.filter((t) => words.includes(t)).length] as [string, number])
  for (const [re, lang] of ACCENTS) if (re.test(value.toLowerCase())) scores.find((s) => s[0] === lang)![1] += 1.5
  scores.sort((a, b) => b[1] - a[1])
  const [best, second] = scores
  if (best[1] >= 1.5 && best[1] > second[1]) return { language: best[0], clear: best[1] >= 3 && best[1] >= 2 * second[1] }
  return null
}

/** Nome della lingua (in italiano) o null se non e' chiaro. */
export function replyLanguage(text: string | null | undefined): string | null {
  return detectLanguage(text)?.language ?? null
}

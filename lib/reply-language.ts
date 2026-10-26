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
  italiano: ['il', 'lo', 'gli', 'che', 'di', 'è', 'per', 'con', 'come', 'quanto', 'ciao', 'grazie', 'sono', 'una', 'del', 'della', 'non', 'anche', 'questo', 'vorrei', 'buongiorno', 'salve', 'costa'],
  inglese: ['the', 'and', 'you', 'is', 'are', 'to', 'of', 'for', 'with', 'what', 'how', 'this', 'that', 'your', 'can', 'do', 'my', 'please', 'hi', 'hello', 'much', 'price', 'thanks', 'want', 'love'],
  spagnolo: ['el', 'los', 'las', 'que', 'y', 'es', 'por', 'para', 'como', 'cuánto', 'cuanto', 'hola', 'gracias', 'usted', 'una', 'del', 'muy', 'quiero', 'precio', 'cómo', 'también'],
  francese: ['le', 'les', 'des', 'est', 'et', 'je', 'vous', 'pour', 'avec', 'bonjour', 'merci', 'combien', 'une', 'du', 'c’est', "c'est", 'très', 'nous', 'pas', 'prix'],
  tedesco: ['der', 'die', 'das', 'und', 'ist', 'ich', 'sie', 'nicht', 'mit', 'für', 'wie', 'viel', 'hallo', 'danke', 'ein', 'eine', 'auch', 'was', 'kostet', 'sehr'],
  portoghese: ['os', 'as', 'que', 'é', 'para', 'com', 'como', 'quanto', 'olá', 'obrigado', 'obrigada', 'você', 'uma', 'um', 'do', 'da', 'não', 'muito', 'preço', 'também', 'custa', 'assim', 'isso', 'olhá'],
}

const ACCENTS: [RegExp, string][] = [
  [/[ñ¿¡]/, 'spagnolo'],
  [/[ãõ]/, 'portoghese'],
  [/[ßäöü]/, 'tedesco'],
  [/[êâîôûëïç]/, 'francese'],
]

/** Nome della lingua (in italiano) o null se non e' chiaro. */
export function replyLanguage(text: string | null | undefined): string | null {
  const value = (text || '').replace(/https?:\/\/\S+|@\w+|#\w+/g, ' ').trim()
  if (!value) return null

  const letters = (value.match(/\p{L}/gu) || []).length
  if (!letters) return null
  for (const [re, name] of SCRIPTS) {
    // Basta una parte consistente del testo in quell'alfabeto.
    if ((value.match(re) || []).length >= Math.max(2, letters * 0.3)) return name
  }

  const tokens = value.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  const scores = Object.entries(WORDS).map(([lang, words]) => [lang, tokens.filter((t) => words.includes(t)).length] as [string, number])
  for (const [re, lang] of ACCENTS) if (re.test(value.toLowerCase())) scores.find((s) => s[0] === lang)![1] += 1.5
  scores.sort((a, b) => b[1] - a[1])
  const [best, second] = scores
  if (best[1] >= 1.5 && best[1] > second[1]) return best[0]
  return null
}

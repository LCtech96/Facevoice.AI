// Instagram accetta al massimo 5 hashtag per post: quelli in piu' si tolgono
// (si tengono i primi 5, nell'ordine in cui compaiono).

export const MAX_HASHTAGS = 5

export function limitHashtags(text: string, max = MAX_HASHTAGS): string {
  let seen = 0
  const out = text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, (match) => (++seen <= max ? match : ''))
  // Spazi e righe vuote rimasti dove c'erano gli hashtag tolti.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

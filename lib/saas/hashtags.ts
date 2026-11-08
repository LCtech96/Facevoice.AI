/** Instagram accetta al massimo 5 hashtag per post: si tengono i primi 5, gli altri si tolgono. */
export function limitHashtags(text: string, max = 5): string {
  let seen = 0
  const out = text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, (match) => (++seen <= max ? match : ''))
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

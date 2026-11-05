import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { callAI, readImages, type ImageInput } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Al massimo 3 screenshot per richiesta: con le immagini gia' ridotte nel
// browser (~1 MB l'una) si resta sotto il limite di 4,5 MB di Vercel.
const MAX_IMAGES = 3

const METHOD_PROMPT = `Ti passo la trascrizione di uno o più screenshot di conversazioni vere (email, chat, Direct) tra Luca e un'altra persona. Luca vuole che l'AI delle controrisposte impari il suo METODO da queste conversazioni.

Scrivi in italiano, solo questo, senza introduzioni:

Conversazione (dagli screenshot):
Lui: <messaggio ricevuto, riassunto fedele se è lungo>
Io: <risposta data da Luca, trascritta fedelmente>
(ripeti nell'ordine giusto per tutti i messaggi; "Io" è sempre chi ha risposto per conto di Luca/dell'azienda, "Lui" l'altra persona)

Metodo ricavato:
- Quando arriva <tipo di messaggio, es. "chiede il prezzo", "dice che ci pensa", "dice che ha già un sito", "non è interessato", "chiede informazioni"> → <come risponde Luca: tono, lunghezza, cosa dice e cosa evita, dove porta il discorso, la domanda con cui chiude>
(da 2 a 8 punti, solo quelli che si vedono davvero nella conversazione)

Regole: niente nomi, email o numeri di telefono della persona (scrivi "Lui"); niente consigli tuoi; se uno screenshot non contiene una conversazione, scrivi solo "Nessuna conversazione leggibile".`

/** Solo l'admin. body: { images: string[] } (data URL JPEG/PNG/WebP). Restituisce l'esempio da aggiungere agli esempi di strategia. */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'leads', 'email')
  if (access instanceof NextResponse) return access
  if (!access.isAdmin) return NextResponse.json({ error: 'Solo l’amministratore può cambiare le risposte automatiche' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const raw: unknown[] = Array.isArray(body?.images) ? body.images : []
  const images: ImageInput[] = raw
    .slice(0, MAX_IMAGES)
    .map((item) => /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof item === 'string' ? item : ''))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ mimeType: m[1], data: m[2] }))
  if (!images.length) return NextResponse.json({ error: 'Carica almeno uno screenshot (JPG, PNG o WebP).' }, { status: 400 })

  try {
    const transcript = await readImages(
      images,
      'Sono screenshot di conversazioni (email, chat o Direct) con un cliente: trascrivi in ordine chi ha scritto cosa, con il testo completo di ogni messaggio.'
    )
    if (!transcript.trim()) return NextResponse.json({ error: 'Non sono riuscito a leggere gli screenshot, riprova.' }, { status: 502 })
    const result = await callAI([{ role: 'user', content: `Trascrizione degli screenshot:\n\n${transcript.slice(0, 15000)}` }], METHOD_PROMPT, {
      temperature: 0.2,
      maxOutputTokens: 2500,
      feature: 'controrisposte_clienti',
    })
    const example = result.message.trim()
    if (!example) return NextResponse.json({ error: 'Non sono riuscito a ricavare il metodo, riprova.' }, { status: 502 })
    return NextResponse.json({ example })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lettura non riuscita, riprova.' }, { status: 500 })
  }
}

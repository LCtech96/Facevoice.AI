import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { generateGeminiImage, geminiErrorInfo, getGeminiApiKey, isGeminiLimitError } from '@/lib/gemini'

// Immagini delle guide in home: generate una sola volta con Gemini, salvate su
// Supabase Storage e poi servite come file statici. Finche' un'immagine manca la
// pagina mostra un segnaposto fisso (public/guides/placeholder.svg).
//
// Niente generazioni a raffica: una visita della pagina puo' avviare al massimo un
// tentativo in background (lucchetto in app_settings), ogni modello si prova al massimo
// una volta per tentativo e, dopo un limite di Gemini, tutti i server aspettano (riposo
// condiviso in app_settings, sempre piu' lungo se il limite si ripete).

const SETTINGS_KEY = 'home_guide_images'
const LOCK_KEY = 'home_guide_images_lock'
const COOLDOWN_KEY = 'home_guide_images_cooldown'
const LOCK_MS = 15 * 60_000
/** Primo riposo dopo un limite: poi raddoppia a ogni limite di fila, fino a un giorno. */
const FIRST_COOLDOWN_MS = 30 * 60_000
const MAX_COOLDOWN_MS = 24 * 60 * 60_000
const BUCKET = 'site-assets'

/** Segnaposto statico mostrato al posto delle immagini che non ci sono ancora. */
export const GUIDE_PLACEHOLDER = '/guides/placeholder.svg'

const STYLE =
  'Photorealistic photograph, natural warm light with orange and amber tones, shallow depth of field, editorial look, vertical 4:5 framing. No text, no letters, no logos, no watermarks.'

export const GUIDE_IMAGE_PROMPTS: Record<string, string> = {
  voce: 'Smiling owner of a small Sicilian trattoria standing at the entrance of the restaurant at golden hour, holding a smartphone, confident and welcoming.',
  'chi-siamo': 'Small creative team of three young professionals working together around a wooden table with laptops, sketches and coffee, in a bright studio in Palermo at sunset.',
  'cosa-facciamo': 'Content creator filming a plate of Sicilian pasta with a smartphone on a gimbal inside a cozy restaurant, warm practical lights in the background.',
  sistemi: 'Designer desk seen from above with a brand moodboard, printed logo sketches, color swatches and a tablet showing a social media grid.',
  riconoscibile: 'Elegant shop front in a historic Sicilian street with a coherent sign, awnings and window graphics, people walking by, late afternoon light.',
  identita: 'Close-up of a designer hands arranging color swatches and typography specimen cards next to a laptop, warm studio light.',
}

type ImageMap = Record<string, string>

/** Riposo condiviso fra tutti i server dopo un limite di Gemini. */
export type GuideCooldown = {
  /** Fino a quando non si prova nessun modello. */
  until: number
  /** Limiti di fila (il riposo raddoppia a ognuno). */
  strikes: number
  /** Modello -> fino a quando non si prova (per chi riparte prima che tutti siano liberi). */
  models: Record<string, number>
}

const EMPTY_COOLDOWN: GuideCooldown = { until: 0, strikes: 0, models: {} }

export function parseCooldown(raw: string | null): GuideCooldown {
  try {
    const data = raw ? JSON.parse(raw) : null
    return {
      until: Number(data?.until) || 0,
      strikes: Math.max(0, Number(data?.strikes) || 0),
      models: data?.models && typeof data.models === 'object' ? data.models : {},
    }
  } catch {
    return { ...EMPTY_COOLDOWN, models: {} }
  }
}

/** Riposo dopo il limite numero `strikes` (1 = primo): 30 min, 1 h, 2 h ... fino a 24 h; quota del giorno: 24 h. */
export function cooldownAfterLimit(strikes: number, daily: boolean): number {
  if (daily) return MAX_COOLDOWN_MS
  return Math.min(MAX_COOLDOWN_MS, FIRST_COOLDOWN_MS * 2 ** Math.max(0, strikes - 1))
}

export async function getGuideImages(): Promise<ImageMap> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as ImageMap) : {}
  } catch {
    return {}
  }
}

export function missingGuideImages(images: ImageMap): string[] {
  return Object.keys(GUIDE_IMAGE_PROMPTS).filter((id) => !images[id])
}

/** Riposo condiviso in corso (nessun tentativo prima di questo istante). */
export async function guideImagesCooling(now = Date.now()): Promise<boolean> {
  const cooldown = parseCooldown((await readSetting(COOLDOWN_KEY).catch(() => ({ value: null }))).value)
  return now < cooldown.until
}

type Lock = { at: number; id: string }

/** Lucchetto salvato: { at, id } (o il numero dei salvataggi di prima). */
function parseLock(raw: string | null): Lock {
  try {
    const data = raw ? JSON.parse(raw) : null
    if (typeof data === 'number') return { at: data, id: '' }
    return { at: Number(data?.at) || 0, id: typeof data?.id === 'string' ? data.id : '' }
  } catch {
    return { at: 0, id: '' }
  }
}

/** Prende il lucchetto in modo atomico (confronto su updated_at): true solo per chi lo ottiene. */
async function acquireLock(id: string, now = Date.now()): Promise<boolean> {
  const held = await updateSetting(LOCK_KEY, parseLock, (current) => (now - current.at < LOCK_MS ? false : { at: now, id }))
  return held.id === id
}

/** Lascia il lucchetto (solo se e' ancora nostro). */
const releaseLock = (id: string) =>
  updateSetting(LOCK_KEY, parseLock, (current) => (current.id === id ? { at: 0, id: '' } : false)).catch(() => undefined)

/**
 * Genera le immagini mancanti, una alla volta, in un solo tentativo: ogni modello si prova al
 * massimo una volta (un modello al limite non si riprova per le immagini successive) e al primo
 * limite ci si ferma e si salva il riposo condiviso. Con il riposo in corso o il lucchetto
 * preso da un altro server non parte nessuna richiesta a Gemini.
 */
export async function ensureGuideImages(): Promise<void> {
  if (!getGeminiApiKey()) return
  if (await guideImagesCooling()) return
  const lockId = randomUUID()
  if (!(await acquireLock(lockId))) return

  try {
    // Il bucket pubblico si crea la prima volta (errore "esiste gia'" ignorato).
    await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => undefined)

    const cooldown = parseCooldown((await readSetting(COOLDOWN_KEY)).value)
    const limited = new Map<string, unknown>()
    const skip = (model: string) => limited.has(model) || Date.now() < (cooldown.models[model] || 0)

    const images = await getGuideImages()
    let made = 0
    let failed = 0
    for (const id of missingGuideImages(images)) {
      let imageUrl: string
      try {
        ;({ imageUrl } = await generateGeminiImage(`${GUIDE_IMAGE_PROMPTS[id]} ${STYLE}`, undefined, {
          skip,
          onLimit: (model, error) => limited.set(model, error),
        }))
      } catch (error) {
        if (limited.size || isGeminiLimitError(error)) break // limite: stop, niente altri tentativi
        failed++
        console.warn(`guide image ${id}:`, error instanceof Error ? error.message : error)
        continue
      }
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) continue
      try {
        const ext = match[1].includes('jpeg') ? 'jpg' : 'png'
        const path = `guides/${id}-${Date.now()}.${ext}`
        const { error } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(path, Buffer.from(match[2], 'base64'), { contentType: match[1], upsert: true })
        if (error) throw error
        images[id] = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
        await supabaseAdmin
          .from('app_settings')
          .upsert({ key: SETTINGS_KEY, value: JSON.stringify(images), updated_at: new Date().toISOString() })
        made++
      } catch (error) {
        failed++
        console.warn(`guide image ${id}: salvataggio non riuscito:`, error instanceof Error ? error.message : error)
      }
    }

    // Limite o immagini non riuscite: riposo condiviso (le visite non riprovano a raffica).
    if (limited.size || failed) {
      const daily = [...limited.values()].some((error) => geminiErrorInfo(error)?.daily)
      const saved = await updateSetting(COOLDOWN_KEY, parseCooldown, (current) => {
        const strikes = current.strikes + 1
        const wait = cooldownAfterLimit(strikes, daily)
        const now = Date.now()
        const models = { ...current.models }
        for (const model of limited.keys()) models[model] = now + wait
        return { until: now + wait, strikes, models }
      })
      console.warn(
        `guide images: ${limited.size ? `Gemini al limite (${[...limited.keys()].join(', ')})` : `${failed} immagini non riuscite`}, nessun nuovo tentativo per ${Math.round((saved.until - Date.now()) / 60_000)} min`
      )
    } else if (made && cooldown.strikes) {
      await updateSetting(COOLDOWN_KEY, parseCooldown, () => ({ ...EMPTY_COOLDOWN, models: {} }))
    }
  } finally {
    await releaseLock(lockId)
  }
}

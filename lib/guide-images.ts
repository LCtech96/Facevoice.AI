import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'

// Immagini delle guide in home: generate una sola volta con Gemini, salvate su
// Supabase Storage e poi servite come file statici. Se la generazione non e'
// possibile (chiave assente, modello immagini non disponibile) le guide restano
// valide anche senza foto.

const SETTINGS_KEY = 'home_guide_images'
const LOCK_KEY = 'home_guide_images_lock'
const LOCK_MS = 15 * 60_000
const BUCKET = 'site-assets'

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

/** Genera le immagini mancanti, una alla volta. Un lucchetto evita generazioni doppie. */
export async function ensureGuideImages(): Promise<void> {
  if (!getGeminiApiKey()) return
  const { data: lock } = await supabaseAdmin.from('app_settings').select('value').eq('key', LOCK_KEY).maybeSingle()
  if (lock?.value && Date.now() - Number(lock.value) < LOCK_MS) return
  await supabaseAdmin.from('app_settings').upsert({ key: LOCK_KEY, value: String(Date.now()), updated_at: new Date().toISOString() })

  // Il bucket pubblico si crea la prima volta (errore "esiste gia'" ignorato).
  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => undefined)

  const images = await getGuideImages()
  for (const id of missingGuideImages(images)) {
    try {
      const { imageUrl } = await generateGeminiImage(`${GUIDE_IMAGE_PROMPTS[id]} ${STYLE}`)
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) continue
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
    } catch (error) {
      console.warn(`guide image ${id}:`, error instanceof Error ? error.message : error)
    }
  }
}

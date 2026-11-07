import { NextResponse, after } from 'next/server'
import { GUIDE_PLACEHOLDER, ensureGuideImages, getGuideImages, guideImagesCooling, missingGuideImages } from '@/lib/guide-images'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Indirizzi delle immagini delle guide in home (file su Supabase Storage) e il segnaposto per
 * quelle che mancano. Se ne mancano e Gemini non e' a riposo, al massimo un tentativo di
 * generazione parte in background (lucchetto e riposo condiviso in lib/guide-images.ts):
 * la pagina non aspetta e non genera mai a raffica.
 */
export async function GET() {
  const images = await getGuideImages().catch(() => ({}))
  const missing = missingGuideImages(images)
  if (missing.length && !(await guideImagesCooling().catch(() => true))) {
    after(() => ensureGuideImages().catch((error) => console.error('guide images:', error)))
  }
  return NextResponse.json(
    { images, placeholder: GUIDE_PLACEHOLDER },
    // Immagini complete: la risposta non cambia, si tiene in cache piu' a lungo.
    { headers: { 'Cache-Control': missing.length ? 'public, s-maxage=300, stale-while-revalidate=3600' : 'public, s-maxage=3600, stale-while-revalidate=86400' } }
  )
}

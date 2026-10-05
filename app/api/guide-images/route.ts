import { NextResponse, after } from 'next/server'
import { ensureGuideImages, getGuideImages, missingGuideImages } from '@/lib/guide-images'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Indirizzi delle immagini delle guide in home. Se ne mancano, le genera in background (una volta sola). */
export async function GET() {
  const images = await getGuideImages().catch(() => ({}))
  if (missingGuideImages(images).length) {
    after(() => ensureGuideImages().catch((error) => console.error('guide images:', error)))
  }
  return NextResponse.json(
    { images },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } }
  )
}

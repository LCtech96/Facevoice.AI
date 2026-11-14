import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { TikTokError, getTikTokCreator } from '@/lib/tiktok'

export const dynamic = 'force-dynamic'

/**
 * Account TikTok che pubblica e cosa puo' fare adesso (visibilita' possibili, commenti, duetti,
 * stitch, durata massima): la pagina lo chiede ogni volta che prepara un post per TikTok.
 */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  try {
    return NextResponse.json({ creator: await getTikTokCreator() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const code = error instanceof TikTokError ? error.code : ''
    return NextResponse.json({ error: error instanceof Error ? error.message : 'TikTok non risponde', code }, { status: code === 'not_connected' ? 404 : 502 })
  }
}

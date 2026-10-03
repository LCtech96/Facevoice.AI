import { NextRequest, NextResponse } from 'next/server'
import { pollGmail } from '@/lib/gmail-poll'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cron Vercel (vedi vercel.json): legge le nuove email ogni minuto. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  return NextResponse.json(await pollGmail())
}

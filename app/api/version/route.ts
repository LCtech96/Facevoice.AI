import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Versione pubblicata (commit del deploy): la web app si aggiorna se cambia. */
export function GET() {
  return NextResponse.json(
    { v: process.env.VERCEL_GIT_COMMIT_SHA || '' },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

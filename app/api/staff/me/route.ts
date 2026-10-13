import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'

export const dynamic = 'force-dynamic'

/** Pagine del gestionale aperte a chi fa la richiesta (per menu e pulsanti). */
export async function GET(req: NextRequest) {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ isAdmin: false, permissions: {} })
  return NextResponse.json({ isAdmin: access.isAdmin, permissions: access.permissions })
}

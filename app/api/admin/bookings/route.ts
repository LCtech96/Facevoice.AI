import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    // Verifica che sia admin (da fare meglio con autenticazione)
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching bookings:', error)
      return NextResponse.json(
        { error: 'Errore nel caricare le prenotazioni' },
        { status: 500 }
      )
    }

    // Filtra per status se specificato
    const filteredData = status === 'all' 
      ? data 
      : data?.filter((booking: any) => booking.status === status) || []

    return NextResponse.json({
      bookings: filteredData,
      total: filteredData.length,
    })
  } catch (error: any) {
    console.error('Error in GET /api/admin/bookings:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}


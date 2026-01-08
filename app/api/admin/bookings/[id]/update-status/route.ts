import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { status } = await req.json()

    if (!status || !['pending', 'contacted', 'completed', 'cancelled'].includes(status)) {
      return NextResponse.json(
        { error: 'Status non valido' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({ status })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating booking status:', error)
      return NextResponse.json(
        { error: 'Errore nell\'aggiornare lo status' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      booking: data,
    })
  } catch (error: any) {
    console.error('Error in POST /api/admin/bookings/[id]/update-status:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}


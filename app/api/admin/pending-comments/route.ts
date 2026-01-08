import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    // Ottieni tutti i commenti non approvati da tool_comments
    const { data: toolComments, error: toolError } = await supabaseAdmin
      .from('tool_comments')
      .select('id, tool_id, user_name, user_email, comment, created_at, is_approved, is_verified')
      .or('is_approved.eq.false,is_verified.eq.false')
      .order('created_at', { ascending: false })

    if (toolError) {
      console.error('Error fetching tool comments:', toolError)
    }

    // Ottieni tutti i commenti non approvati da case_study_comments
    const { data: caseComments, error: caseError } = await supabaseAdmin
      .from('case_study_comments')
      .select('id, case_study_id, user_name, user_email, comment, created_at, is_approved')
      .eq('is_approved', false)
      .order('created_at', { ascending: false })

    if (caseError) {
      console.error('Error fetching case study comments:', caseError)
    }

    return NextResponse.json({
      toolComments: toolComments || [],
      caseComments: caseComments || [],
    })
  } catch (error: any) {
    console.error('Error fetching pending comments:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel recupero dei commenti' },
      { status: 500 }
    )
  }
}


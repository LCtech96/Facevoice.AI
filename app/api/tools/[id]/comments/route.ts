import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabase
      .from('tool_comments')
      .select('id, user_id, user_name, comment, created_at')
      .eq('tool_id', params.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error fetching comments:', error)
      return NextResponse.json({ comments: [] }, { status: 500 })
    }

    return NextResponse.json({ comments: data || [] })
  } catch (error) {
    console.error('Error in GET /api/tools/[id]/comments:', error)
    return NextResponse.json({ comments: [] }, { status: 500 })
  }
}


import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key')

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) throw error

    return NextResponse.json({ posts: data || [] })
  } catch (error: any) {
    console.error('Error fetching posts:', error)
    return NextResponse.json({ posts: [] })
  }
}


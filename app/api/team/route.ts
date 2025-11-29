import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .order('id', { ascending: true })

    if (error) {
      console.error('Error fetching team members:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, role, description, email, linkedin, image_url } = body

    if (!name || !role) {
      return NextResponse.json(
        { error: 'Name and role are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('team_members')
      .insert({
        name,
        role,
        description: description || null,
        email: email || null,
        linkedin: linkedin || null,
        image_url: image_url || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting team member:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

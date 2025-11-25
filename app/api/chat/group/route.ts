import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// Store group chats in Supabase
export async function POST(req: NextRequest) {
  try {
    const { name, creatorId } = await req.json()

    if (!name) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 }
      )
    }

    const groupId = uuidv4()
    const shareLink = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/ai-chat/group/${groupId}`

    // Store in database (you'll need to create a group_chats table)
    // For now, return the link
    const groupChat = {
      id: groupId,
      name,
      shareLink,
      creatorId: creatorId || 'anonymous',
      createdAt: new Date().toISOString(),
    }

    return NextResponse.json({ groupChat })
  } catch (error: any) {
    console.error('Error creating group chat:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create group chat' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const groupId = searchParams.get('id')

  if (!groupId) {
    return NextResponse.json(
      { error: 'Group ID is required' },
      { status: 400 }
    )
  }

  // Fetch group chat from database
  // For now, return basic info
  return NextResponse.json({
    id: groupId,
    exists: true,
  })
}


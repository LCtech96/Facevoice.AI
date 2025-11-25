import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // Lista i file nello storage
    const { data: files, error: listError } = await supabase.storage
      .from('team-photos')
      .list('', {
        limit: 100,
        offset: 0,
      })

    if (listError) {
      return NextResponse.json(
        { error: listError.message },
        { status: 500 }
      )
    }

    const updates: Array<{ memberId: number; imageUrl: string; imagePath: string }> = []

    // Per ogni file/cartella, trova il membro del team corrispondente
    for (const file of files || []) {
      // Se è una cartella (non ha estensione), lista i file dentro
      if (!file.name.includes('.')) {
        const memberId = parseInt(file.name)
        if (isNaN(memberId)) continue

        const { data: folderFiles, error: folderError } = await supabase.storage
          .from('team-photos')
          .list(file.name, {
            limit: 100,
            offset: 0,
          })

        if (folderError) {
          console.error(`Error listing folder ${file.name}:`, folderError)
          continue
        }

        // Prendi il primo file immagine trovato
        const imageFile = folderFiles?.find(f => 
          f.name.toLowerCase().endsWith('.jpg') || 
          f.name.toLowerCase().endsWith('.jpeg') || 
          f.name.toLowerCase().endsWith('.png') ||
          f.name.toLowerCase().endsWith('.webp')
        )

        if (imageFile) {
          const filePath = `${file.name}/${imageFile.name}`
          const { data: { publicUrl } } = supabase.storage
            .from('team-photos')
            .getPublicUrl(filePath)

          updates.push({
            memberId,
            imageUrl: publicUrl,
            imagePath: filePath,
          })
        }
      } else {
        // Se il file è direttamente nella root, prova a estrarre l'ID dal nome
        const match = file.name.match(/^(\d+)[-_]/)
        if (match) {
          const memberId = parseInt(match[1])
          const filePath = file.name
          const { data: { publicUrl } } = supabase.storage
            .from('team-photos')
            .getPublicUrl(filePath)

          updates.push({
            memberId,
            imageUrl: publicUrl,
            imagePath: filePath,
          })
        }
      }
    }

    // Aggiorna il database per ogni immagine trovata
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('team_members')
        .update({
          image_url: update.imageUrl,
          image_path: update.imagePath,
        })
        .eq('id', update.memberId)

      if (updateError) {
        console.error(`Error updating member ${update.memberId}:`, updateError)
      }
    }

    return NextResponse.json({
      success: true,
      updated: updates.length,
      updates,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}


// Script per sincronizzare le immagini dallo storage al database
import { supabase } from '../lib/supabase'

async function syncImages() {
  try {
    // Lista i file nello storage
    const { data: files, error: listError } = await supabase.storage
      .from('team-photos')
      .list('', {
        limit: 100,
        offset: 0,
      })

    if (listError) {
      console.error('Error listing files:', listError)
      return
    }

    console.log('Files found in storage:', files)

    // Per ogni file, trova il membro del team corrispondente e aggiorna
    for (const file of files || []) {
      // I file dovrebbero essere in cartelle con il nome dell'ID (es: "1/foto.jpg")
      // Oppure avere il nome che inizia con l'ID (es: "1-foto.jpg")
      
      // Se è una cartella, lista i file dentro
      if (!file.name.includes('.')) {
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

        for (const folderFile of folderFiles || []) {
          const memberId = parseInt(file.name)
          if (!isNaN(memberId) && folderFile.name) {
            const filePath = `${file.name}/${folderFile.name}`
            const { data: { publicUrl } } = supabase.storage
              .from('team-photos')
              .getPublicUrl(filePath)

            // Aggiorna il database
            const { error: updateError } = await supabase
              .from('team_members')
              .update({
                image_url: publicUrl,
                image_path: filePath,
              })
              .eq('id', memberId)

            if (updateError) {
              console.error(`Error updating member ${memberId}:`, updateError)
            } else {
              console.log(`Updated member ${memberId} with image: ${publicUrl}`)
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Unexpected error:', error)
  }
}

syncImages()


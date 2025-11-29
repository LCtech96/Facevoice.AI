// Script per aggiungere Alessio come Client Success Manager
import { supabase } from '../lib/supabase'

async function addAlessio() {
  try {
    // Verifica se Alessio esiste già
    const { data: existing } = await supabase
      .from('team_members')
      .select('id, name')
      .ilike('name', '%Alessio%')
      .single()

    if (existing) {
      console.log(`Alessio già presente nel database con ID: ${existing.id}`)
      console.log('Aggiornando il ruolo a Client Success Manager...')
      
      // Aggiorna il ruolo
      const { error: updateError } = await supabase
        .from('team_members')
        .update({
          role: 'Client Success Manager',
          image_url: '/team/Alessio professionale fv.png',
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('Errore durante l\'aggiornamento:', updateError)
        return
      }

      console.log(`✅ Alessio aggiornato con successo! ID: ${existing.id}`)
      return
    }

    // Inserisci Alessio come nuovo membro
    const { data, error } = await supabase
      .from('team_members')
      .insert({
        name: 'Alessio',
        role: 'Client Success Manager',
        description: 'Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners',
        email: 'alessio@facevoice.ai',
        linkedin: null,
        image_url: '/team/Alessio professionale fv.png',
      })
      .select()
      .single()

    if (error) {
      console.error('Errore durante l\'inserimento:', error)
      return
    }

    console.log('✅ Alessio aggiunto con successo!')
    console.log('Dettagli:', data)
  } catch (error) {
    console.error('Errore inaspettato:', error)
  }
}

addAlessio()


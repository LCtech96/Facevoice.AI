/**
 * Script per generare slug per tutti i post del blog esistenti
 * Esegui con: npx tsx scripts/generate-blog-slugs.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function generateUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug
  let counter = 1
  
  while (true) {
    let query = supabase
      .from('blog_posts')
      .select('id')
      .eq('slug', slug)
    
    if (excludeId) {
      query = query.neq('id', excludeId)
    }
    
    const { data } = await query.limit(1)
    
    if (!data || data.length === 0) {
      return slug
    }
    
    slug = `${baseSlug}-${counter}`
    counter++
  }
}

async function main() {
  console.log('🔄 Recupero tutti i post del blog...')
  
  const { data: posts, error } = await supabase
    .from('blog_posts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Errore nel recuperare i post:', error)
    process.exit(1)
  }

  if (!posts || posts.length === 0) {
    console.log('ℹ️ Nessun post trovato nel database')
    process.exit(0)
  }

  console.log(`📝 Trovati ${posts.length} post. Generazione slug...\n`)

  let updated = 0
  let skipped = 0

  for (const post of posts) {
    const currentSlug = post.slug
    const generatedSlug = generateSlug(post.title || '')
    
    // Se lo slug esiste ed è corretto, salta
    if (currentSlug === generatedSlug) {
      console.log(`✓ Post "${post.title}" ha già slug corretto: ${currentSlug}`)
      skipped++
      continue
    }

    // Genera slug unico
    const uniqueSlug = await generateUniqueSlug(generatedSlug, post.id)

    console.log(`🔄 Aggiornando post "${post.title}"`)
    console.log(`   Vecchio slug: ${currentSlug || '(nessuno)'}`)
    console.log(`   Nuovo slug: ${uniqueSlug}`)

    const { error: updateError } = await supabase
      .from('blog_posts')
      .update({ slug: uniqueSlug })
      .eq('id', post.id)

    if (updateError) {
      console.error(`❌ Errore nell'aggiornare il post ${post.id}:`, updateError)
      continue
    }

    updated++
    console.log(`✓ Post aggiornato con successo\n`)
  }

  console.log('\n✅ Completato!')
  console.log(`   Post aggiornati: ${updated}`)
  console.log(`   Post saltati: ${skipped}`)
}

main().catch(console.error)

import { supabaseAdmin } from '@/lib/supabase-admin'

export type BlogListItem = {
  id: string
  slug: string | null
  title: string
  content: string
  image_url: string | null
  created_at: string
}

/** Percorso pubblico dell'articolo: lo slug se c'e', altrimenti l'id. */
export const blogPath = (post: { id: string; slug: string | null }) => `/blog/${post.slug || post.id}`

/** Tutti gli articoli, dal piu' recente. In caso di errore lista vuota (la pagina resta su). */
export async function listBlogPosts(limit = 500): Promise<BlogListItem[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .select('id, slug, title, content, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data || []) as BlogListItem[]
  } catch (error) {
    console.error('blog list:', error instanceof Error ? error.message : error)
    return []
  }
}

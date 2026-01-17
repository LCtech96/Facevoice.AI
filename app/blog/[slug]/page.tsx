import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import BlogPostContent from '@/components/blog/BlogPostContent'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Funzione helper per generare slug da titolo
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface BlogPost {
  id: string
  title: string
  content: string
  image_url?: string
  author: string
  created_at: string
  slug?: string
}

// Funzione per generare metadata dinamici per SEO
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params

  try {
    // Cerca il post per slug
    const { data: allPosts } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false })

    const post = allPosts?.find((p: any) => {
      const postSlug = p.slug || generateSlug(p.title)
      return postSlug === slug
    })

    if (!post) {
      return {
        title: 'Post non trovato | Facevoice AI',
        description: 'Il post richiesto non è stato trovato.',
      }
    }

    // Estrai un'anteprima del contenuto per la meta description
    const preview = post.content.substring(0, 160).replace(/\n/g, ' ').trim()

    return {
      title: `${post.title} | Facevoice AI Blog`,
      description: preview || `Leggi l'articolo: ${post.title}`,
      keywords: [
        'Facevoice AI',
        'blog',
        'sviluppo software',
        'Palermo',
        'intelligenza artificiale',
        'marketing digitale',
        'visibilità online',
        'social media',
        ...post.title.toLowerCase().split(/\s+/),
      ],
      openGraph: {
        title: post.title,
        description: preview || `Leggi l'articolo: ${post.title}`,
        url: `https://www.facevoice.ai/blog/${slug}`,
        siteName: 'Facevoice AI',
        locale: 'it_IT',
        type: 'article',
        images: post.image_url
          ? [
              {
                url: post.image_url,
                width: 1200,
                height: 630,
                alt: post.title,
              },
            ]
          : [
              {
                url: 'https://www.facevoice.ai/Facevoice.png',
                width: 1200,
                height: 630,
                alt: 'Facevoice AI - Sviluppo Software e Integrazione AI',
              },
            ],
        publishedTime: post.created_at,
        authors: [post.author],
      },
      twitter: {
        card: 'summary_large_image',
        title: post.title,
        description: preview || `Leggi l'articolo: ${post.title}`,
        images: post.image_url ? [post.image_url] : ['https://www.facevoice.ai/Facevoice.png'],
      },
      alternates: {
        canonical: `https://www.facevoice.ai/blog/${slug}`,
      },
      robots: {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          'max-video-preview': -1,
          'max-image-preview': 'large',
          'max-snippet': -1,
        },
      },
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Blog | Facevoice AI',
      description: 'Articoli su sviluppo software e intelligenza artificiale',
    }
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  try {
    // Cerca il post per slug
    const { data: allPosts, error } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching posts:', error)
      notFound()
    }

    const post = allPosts?.find((p: any) => {
      const postSlug = p.slug || generateSlug(p.title)
      return postSlug === slug
    }) as BlogPost | undefined

    if (!post) {
      notFound()
    }

    return <BlogPostContent post={post} />
  } catch (error) {
    console.error('Error loading post:', error)
    notFound()
  }
}

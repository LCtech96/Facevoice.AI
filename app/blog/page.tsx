import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { blogPath, listBlogPosts } from '@/lib/blog'
import { ORG, SITE_URL } from '@/lib/seo/site'

// Indice del blog: elenca tutti gli articoli (anche per Google, che da qui li trova).
export const revalidate = 600

export const metadata: Metadata = {
  title: `Blog | ${ORG.name}`,
  description:
    'Articoli di Facevoice AI su social media, marketing, siti web, software su misura e intelligenza artificiale per le aziende siciliane.',
  alternates: { canonical: `${SITE_URL}/blog` },
}

const excerpt = (text: string) => {
  const plain = text.replace(/\s+/g, ' ').trim()
  return plain.length > 180 ? `${plain.slice(0, 180)}…` : plain
}

export default async function BlogIndexPage() {
  const posts = await listBlogPosts()

  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">Blog</h1>
        <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
          Idee, consigli e casi pratici su social, siti web, software e intelligenza artificiale per far crescere la tua
          attività.
        </p>

        {posts.length === 0 ? (
          <p className="mt-10 text-[var(--text-secondary)]">Nuovi articoli in arrivo.</p>
        ) : (
          <div className="mt-10 space-y-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={blogPath(post)}
                className="block p-5 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-blue)] transition-colors"
              >
                <h2 className="font-semibold text-[var(--text-primary)]">{post.title}</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {new Date(post.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">{excerpt(post.content)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

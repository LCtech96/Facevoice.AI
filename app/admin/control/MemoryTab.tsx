'use client'

import { useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'

export type KnowledgeItem = {
  id: string
  title: string
  content: string
  category: string | null
  is_active: boolean
  created_at: string
}


// =======================================================================
// Tab: Memoria AI
// =======================================================================

export default function MemoryTab({
  items,
  authFetch,
  onChange,
}: {
  items: KnowledgeItem[]
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onChange: (items: KnowledgeItem[]) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[]

  const filtered = items.filter((item) => {
    const q = search.toLowerCase()
    return (
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    )
  })

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setTitle('')
    setContent('')
    setCategory('')
  }

  const startEdit = (item: KnowledgeItem) => {
    setEditingId(item.id)
    setTitle(item.title)
    setContent(item.content)
    setCategory(item.category || '')
    setShowForm(true)
  }

  const save = async () => {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const res = await authFetch(`/api/admin/ai-knowledge/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, content, category }),
        })
        const data = await res.json()
        if (res.ok) {
          onChange(items.map((i) => (i.id === editingId ? data.item : i)))
        }
      } else {
        const res = await authFetch('/api/admin/ai-knowledge', {
          method: 'POST',
          body: JSON.stringify({ title, content, category }),
        })
        const data = await res.json()
        if (res.ok) {
          onChange([data.item, ...items])
        }
      }
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (item: KnowledgeItem) => {
    const res = await authFetch(`/api/admin/ai-knowledge/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !item.is_active }),
    })
    const data = await res.json()
    if (res.ok) {
      onChange(items.map((i) => (i.id === item.id ? data.item : i)))
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminare questa voce di memoria?')) return
    const res = await authFetch(`/api/admin/ai-knowledge/${id}`, { method: 'DELETE' })
    if (res.ok) {
      onChange(items.filter((i) => i.id !== id))
    }
  }

  return (
    <div>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        Queste informazioni vengono lette dal widget pubblico del sito a ogni
        conversazione. Scrivi qui ciò che l&apos;assistente deve sapere su
        prezzi, servizi, tono di voce, politiche — solo voci attive
        (&ldquo;Attiva&rdquo;) vengono usate.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca per titolo, contenuto o categoria..."
          className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
        />
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" /> Nuova voce
        </button>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setSearch(c)}
              className="px-2.5 py-1 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:border-[var(--accent-blue)] transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <div className="mb-4 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titolo (es. Orari di apertura)"
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Categoria (facoltativa, es. Prezzi, FAQ, Tono di voce)"
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="Contenuto: scrivi l'informazione come la spiegheresti a un nuovo collaboratore."
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] resize-y"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !title.trim() || !content.trim()}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Salvo...' : editingId ? 'Salva modifiche' : 'Crea'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-[var(--text-primary)]">{item.title}</p>
                  {item.category && (
                    <span className="px-2 py-0.5 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)]">
                      {item.category}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      item.is_active
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-[var(--background-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {item.is_active ? 'Attiva' : 'Disattiva'}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">
                  {item.content}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(item)}
                  title={item.is_active ? 'Disattiva' : 'Attiva'}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  {item.is_active ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <X className="w-4 h-4 text-[var(--text-secondary)]" />
                  )}
                </button>
                <button
                  onClick={() => startEdit(item)}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
                <button
                  onClick={() => remove(item.id)}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-center text-[var(--text-secondary)] py-10">
            {items.length === 0
              ? 'Nessuna voce ancora. Aggiungine una per dare contesto all’assistente.'
              : 'Nessun risultato per questa ricerca.'}
          </p>
        )}
      </div>
    </div>
  )
}


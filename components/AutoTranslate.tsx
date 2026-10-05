'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// Traduce TUTTO il testo visibile delle pagine pubbliche nella lingua scelta:
// anche i testi scritti direttamente nei componenti, gli articoli e i contenuti
// che arrivano dopo. Il testo originale resta salvato: tornando all'italiano
// (o cambiando lingua) si riparte sempre dall'originale.
// Escluso: pagine admin e chat interna, campi in cui si scrive, codice, e tutto
// cio' che sta dentro un elemento con translate="no" o data-no-translate.

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'SVG', 'TITLE'])
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const
const BATCH = 100
const CACHE_PREFIX = 'fv_tr_'
const CACHE_MAX = 4000
const HAS_LETTERS = /\p{L}{2,}/u

type Entry = { original: string; applied?: string }

function isPrivatePath(pathname: string | null) {
  return Boolean(pathname && (pathname.startsWith('/admin') || pathname.startsWith('/ai-chat')))
}

function skipped(el: Element | null): boolean {
  for (let node = el; node; node = node.parentElement) {
    if (SKIP_TAGS.has(node.tagName.toUpperCase())) return true
    if (node.getAttribute('translate') === 'no' || node.hasAttribute('data-no-translate')) return true
    if ((node as HTMLElement).isContentEditable) return true
  }
  return false
}

function loadCache(lang: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + lang)
    if (raw) return new Map(JSON.parse(raw) as [string, string][])
  } catch {}
  return new Map()
}

function saveCache(lang: string, cache: Map<string, string>) {
  try {
    const entries = [...cache.entries()].slice(-CACHE_MAX)
    localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify(entries))
  } catch {}
}

export default function AutoTranslate() {
  const { language } = useTranslation()
  const pathname = usePathname()
  const textEntries = useRef(new WeakMap<Text, Entry>())
  const attrEntries = useRef(new WeakMap<Element, Map<string, Entry>>())
  const tracked = useRef(new Set<WeakRef<Node>>())

  useEffect(() => {
    const root = document.documentElement
    root.lang = language
    root.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  useEffect(() => {
    const restoreAll = () => {
      for (const ref of tracked.current) {
        const node = ref.deref()
        if (!node) continue
        if (node.nodeType === Node.TEXT_NODE) {
          const entry = textEntries.current.get(node as Text)
          if (entry && entry.applied !== undefined && node.nodeValue === entry.applied) node.nodeValue = entry.original
          if (entry) entry.applied = undefined
        } else {
          const map = attrEntries.current.get(node as Element)
          map?.forEach((entry, attr) => {
            if (entry.applied !== undefined && (node as Element).getAttribute(attr) === entry.applied) {
              ;(node as Element).setAttribute(attr, entry.original)
            }
            entry.applied = undefined
          })
        }
      }
    }

    if (language === 'it' || isPrivatePath(pathname)) {
      restoreAll()
      return
    }

    const lang = language
    const cache = loadCache(lang)
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    // Raccoglie i testi da tradurre: nodo di testo o attributo → testo originale.
    type Target = { apply: (translated: string) => void; source: string }
    const collect = (scope: Node, out: Target[]) => {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      let node: Node | null = scope
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node as Text
          const value = text.nodeValue || ''
          if (HAS_LETTERS.test(value) && !skipped(text.parentElement)) {
            let entry = textEntries.current.get(text)
            // Testo cambiato da React dopo la nostra traduzione: diventa il nuovo originale.
            if (!entry || (value !== entry.applied && value !== entry.original)) {
              entry = { original: value }
              textEntries.current.set(text, entry)
              tracked.current.add(new WeakRef(text))
            }
            if (value === entry.original) {
              const e = entry
              const core = value.trim()
              const lead = value.slice(0, value.indexOf(core))
              const trail = value.slice(value.indexOf(core) + core.length)
              out.push({
                source: core,
                apply: (t) => {
                  const next = lead + t + trail
                  if (text.nodeValue === e.original && next !== e.original) {
                    e.applied = next
                    text.nodeValue = next
                  }
                },
              })
            }
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element
          if (!skipped(el)) {
            for (const attr of ATTRS) {
              const value = el.getAttribute(attr)
              if (!value || !HAS_LETTERS.test(value)) continue
              let map = attrEntries.current.get(el)
              if (!map) {
                map = new Map()
                attrEntries.current.set(el, map)
                tracked.current.add(new WeakRef(el))
              }
              let entry = map.get(attr)
              if (!entry || (value !== entry.applied && value !== entry.original)) {
                entry = { original: value }
                map.set(attr, entry)
              }
              if (value === entry.original) {
                const e = entry
                out.push({
                  source: value.trim(),
                  apply: (t) => {
                    if (el.getAttribute(attr) === e.original && t !== e.original) {
                      e.applied = t
                      el.setAttribute(attr, t)
                    }
                  },
                })
              }
            }
          }
        }
        node = walker.nextNode()
      }
    }

    const run = async (scopes: Node[]) => {
      const targets: Target[] = []
      for (const scope of scopes) if (scope.isConnected) collect(scope, targets)
      if (!targets.length) return

      // Subito quello che e' gia' in cache, poi il resto dal server.
      const toFetch: string[] = []
      for (const t of targets) {
        const hit = cache.get(t.source)
        if (hit !== undefined) t.apply(hit)
        else if (!pending.has(t.source)) {
          pending.add(t.source)
          toFetch.push(t.source)
        }
      }
      const unique = [...new Set(toFetch)]
      const waiting = targets.filter((t) => !cache.has(t.source))

      for (let i = 0; i < unique.length; i += BATCH) {
        const batch = unique.slice(i, i + BATCH)
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang, texts: batch }),
          })
          const data = res.ok ? await res.json() : null
          const translations: string[] = data?.translations || []
          batch.forEach((source, j) => cache.set(source, translations[j] ?? source))
        } catch {
          batch.forEach((source) => cache.set(source, source))
        } finally {
          batch.forEach((source) => pending.delete(source))
        }
        if (stopped) return
        for (const t of waiting) {
          const hit = cache.get(t.source)
          if (hit !== undefined) t.apply(hit)
        }
      }
      if (unique.length) saveCache(lang, cache)
    }

    // Prima passata su tutta la pagina, poi solo sui pezzi che cambiano.
    restoreAll()
    run([document.body])

    const dirty = new Set<Node>()
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') dirty.add(m.target)
        else if (m.type === 'attributes') dirty.add(m.target)
        else m.addedNodes.forEach((n) => dirty.add(n))
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const scopes = [...dirty]
        dirty.clear()
        run(scopes)
      }, 120)
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS],
    })

    return () => {
      stopped = true
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [language, pathname])

  return null
}

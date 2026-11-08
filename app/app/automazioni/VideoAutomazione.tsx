'use client'

import { Clapperboard, Zap } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { VideoRepliesSection } from '@/components/app/VideoReplies'

// Scheda "Video automazione" di Automazioni: le video risposte (video mandati dall'AI nei
// messaggi diretti quando qualcuno chiede una cosa precisa), create a mano senza la chat
// dell'Assistente. Si vede solo con la Video automazione attiva (la accende Facevoice dal
// suo pannello, per persona), anche senza le email programmate: allora la pagina ha solo
// questa scheda (VideoOnlyBoard).

export default function VideoAutomazione() {
  const { workspace } = useWorkspace()
  return <VideoRepliesSection canEdit={workspace?.role !== 'member'} embedded />
}

/** Pagina Automazioni per chi ha solo la Video automazione (niente email programmate). */
export function VideoOnlyBoard() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold">
          <Zap className="h-6 w-6 text-[var(--accent-blue)]" /> Automazioni
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Video mandati dall’AI nei messaggi, quando qualcuno chiede una cosa precisa.</p>
      </div>
      <div role="tablist" aria-label="Sezioni delle automazioni" className="flex rounded-full border border-[var(--border-color)] bg-[var(--background-secondary)] p-1">
        <span role="tab" aria-selected className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-2 py-2 text-sm font-semibold text-white">
          <Clapperboard className="h-4 w-4" /> Video automazione
        </span>
      </div>
      <VideoAutomazione />
    </div>
  )
}

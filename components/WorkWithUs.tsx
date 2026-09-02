'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckIcon, ArrowRightIcon, Briefcase } from 'lucide-react'

export const CAREER_PARTNERS = [
  { value: 'facevoiceai', label: 'FaceVoiceAI (candidatura diretta)' },
  { value: 'nomadiqe', label: 'Nomadiqe' },
  { value: 'trattoria-piero-mondello', label: 'Trattoria da Piero Mondello' },
  { value: 'lucas-appartaments', label: 'Lucas Appartaments' },
] as const

const steps = [
  { id: 1, field: 'name', label: 'Nome e Cognome', placeholder: 'Il tuo nome completo', type: 'text' as const },
  { id: 2, field: 'email', label: 'Email', placeholder: 'la.tua.email@esempio.com', type: 'email' as const },
  { id: 3, field: 'phone', label: 'Telefono', placeholder: '+39 123 456 7890', type: 'tel' as const },
  { id: 4, field: 'message', label: 'Parlaci di te', placeholder: 'Raccontaci le tue competenze e cosa ti interessa...', type: 'textarea' as const },
]

export default function WorkWithUs() {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [partner, setPartner] = useState<string>(CAREER_PARTNERS[0].value)
  const [isComplete, setIsComplete] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleNext = async () => {
    const field = steps[currentStep].field
    if (!formData[field]?.trim()) return

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      setIsSubmitting(true)
      setSubmitError(null)
      try {
        const response = await fetch('/api/careers/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            message: formData.message || '',
            partner,
          }),
        })
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Errore nell\'invio della candidatura')
        }
        setIsComplete(true)
      } catch (error: unknown) {
        setSubmitError(error instanceof Error ? error.message : 'Errore sconosciuto')
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  const step = steps[currentStep]
  const progress = ((currentStep + 1) / steps.length) * 100

  return (
    <section id="lavora-con-noi" className="py-16 md:py-20 px-4 bg-[var(--background-secondary)]">
      <div className="container mx-auto max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--accent-blue)]/10 mb-4">
            <Briefcase className="w-7 h-7 text-[var(--accent-blue)]" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-3">
            Lavora con noi
          </h2>
          <p className="text-[var(--text-secondary)] max-w-lg mx-auto">
            Cerchiamo talenti appassionati di tecnologia, marketing e innovazione.
            Compila il modulo e ti ricontatteremo al più presto.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-6 md:p-8 shadow-lg"
        >
          {isComplete ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
                <CheckIcon className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                Candidatura inviata!
              </h3>
              <p className="text-[var(--text-secondary)]">
                Grazie per il tuo interesse. Ti contatteremo presto.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6 pb-6 border-b border-[var(--border-color)]">
                <Label htmlFor="partner" className="text-[var(--text-primary)] font-medium mb-2 block">
                  Oppure candidati con uno dei nostri partner
                </Label>
                <select
                  id="partner"
                  value={partner}
                  onChange={(e) => setPartner(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
                >
                  {CAREER_PARTNERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                  <span>Passo {currentStep + 1} di {steps.length}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="h-1.5 bg-[var(--background-secondary)] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[var(--accent-blue)] rounded-full"
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <Label htmlFor={step.field} className="text-[var(--text-primary)] font-medium mb-2 block">
                    {step.label}
                  </Label>
                  {step.type === 'textarea' ? (
                    <textarea
                      id={step.field}
                      placeholder={step.placeholder}
                      value={formData[step.field] || ''}
                      onChange={(e) => setFormData({ ...formData, [step.field]: e.target.value })}
                      rows={4}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] resize-none"
                    />
                  ) : (
                    <Input
                      id={step.field}
                      type={step.type}
                      placeholder={step.placeholder}
                      value={formData[step.field] || ''}
                      onChange={(e) => setFormData({ ...formData, [step.field]: e.target.value })}
                      className="bg-[var(--background)] border-[var(--border-color)] text-[var(--text-primary)]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && formData[step.field]?.trim()) handleNext()
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>

              {submitError && (
                <p className="text-red-500 text-sm mt-4">{submitError}</p>
              )}

              <div className="flex gap-3 mt-6">
                {currentStep > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setCurrentStep(currentStep - 1)}
                    className="flex-1"
                  >
                    Indietro
                  </Button>
                )}
                <Button
                  onClick={handleNext}
                  disabled={!formData[step.field]?.trim() || isSubmitting}
                  className="flex-1 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-light)] text-white"
                >
                  {isSubmitting ? (
                    'Invio in corso...'
                  ) : currentStep === steps.length - 1 ? (
                    'Invia candidatura'
                  ) : (
                    <>
                      Avanti
                      <ArrowRightIcon className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </section>
  )
}

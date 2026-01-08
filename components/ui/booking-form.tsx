"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { CheckIcon, ArrowRightIcon, Phone, MessageSquare, Calendar } from "lucide-react"

type Step = {
  id: number
  label: string
  field: string
  placeholder: string
}

const steps: Step[] = [
  { id: 1, label: "Nome e Cognome", field: "name", placeholder: "Il tuo nome completo" },
  { id: 2, label: "Email", field: "email", placeholder: "la.tua.email@esempio.com" },
  { id: 3, label: "Numero WhatsApp", field: "whatsapp", placeholder: "+39 123 456 7890" },
  { id: 4, label: "Motivo del Booking", field: "service", placeholder: "Descrivi il tipo di servizio interessato o il motivo della prenotazione" },
]

export function BookingForm() {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [isComplete, setIsComplete] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      setIsComplete(true)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value })
  }

  const handleSubmitBooking = async () => {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          whatsapp: formData.whatsapp,
          service: formData.service,
        }),
      })

      if (!response.ok) {
        throw new Error('Errore nel salvare la prenotazione')
      }

      // Apri WhatsApp con il messaggio
      const phoneNumber = '+393514206353'
      const message = `*Nuova Prenotazione da Facevoice AI*\n\n` +
        `*Nome:* ${formData.name}\n` +
        `*Email:* ${formData.email}\n` +
        `*Numero WhatsApp:* ${formData.whatsapp}\n` +
        `*Servizio Richiesto:*\n${formData.service}\n\n` +
        `_Prenotazione inviata il ${new Date().toLocaleString('it-IT')}_`
      
      const encodedMessage = encodeURIComponent(message)
      const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}?text=${encodedMessage}`
      window.open(whatsappUrl, '_blank')
    } catch (error: any) {
      setSubmitError(error.message || 'Errore nel salvare la prenotazione')
    } finally {
      setIsSubmitting(false)
    }
  }

  const currentStepData = steps[currentStep]
  const progress = ((currentStep + 1) / steps.length) * 100

  if (isComplete) {
    return (
      <div className="w-full max-w-md">
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 p-12 backdrop-blur">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.1),transparent_50%)]" />
          <div className="relative flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-700">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-foreground/10 bg-foreground/5">
              <CheckIcon
                className="h-8 w-8 text-foreground animate-in zoom-in duration-500 delay-200"
                strokeWidth={2.5}
              />
            </div>
            <div className="space-y-1 text-center">
              <h2 className="text-xl font-medium tracking-tight text-balance">Prenotazione completata!</h2>
              <p className="text-sm text-muted-foreground/80">La tua prenotazione è stata salvata. Clicca il pulsante per inviare via WhatsApp</p>
            </div>
            {submitError && (
              <div className="w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500">
                {submitError}
              </div>
            )}
            <Button
              onClick={handleSubmitBooking}
              disabled={isSubmitting}
              className="w-full h-12 group relative transition-all duration-300 hover:shadow-lg hover:shadow-foreground/5 mt-4 bg-green-500 hover:bg-green-600 disabled:opacity-50"
            >
              <span className="flex items-center justify-center gap-2 font-medium">
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Invio in corso...
                  </>
                ) : (
                  <>
                    <Phone className="h-5 w-5" />
                    Invia via WhatsApp
                  </>
                )}
              </span>
            </Button>
            <button
              onClick={() => {
                setIsComplete(false)
                setCurrentStep(0)
                setFormData({})
                setSubmitError(null)
              }}
              className="w-full text-center text-sm text-muted-foreground/60 hover:text-foreground/80 transition-all duration-300 mt-2"
            >
              Modifica dati
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-10 flex items-center justify-center gap-3">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            <button
              onClick={() => index <= currentStep && setCurrentStep(index)}
              disabled={index > currentStep}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-700 ease-out",
                "disabled:cursor-not-allowed",
                index < currentStep && "bg-foreground/10 text-foreground/60",
                index === currentStep && "bg-foreground text-background shadow-[0_0_20px_-5px_rgba(0,0,0,0.3)]",
                index > currentStep && "bg-muted/50 text-muted-foreground/40",
              )}
            >
              {index < currentStep ? (
                <CheckIcon className="h-4 w-4 animate-in zoom-in duration-500" strokeWidth={2.5} />
              ) : (
                <span className="text-sm font-medium tabular-nums">{step.id}</span>
              )}
              {index === currentStep && (
                <div className="absolute inset-0 rounded-full bg-foreground/20 blur-md animate-pulse" />
              )}
            </button>
            {index < steps.length - 1 && (
              <div className="relative h-[1.5px] w-12">
                <div className="absolute inset-0 bg-[rgba(207,207,207,0.4)]" />
                <div
                  className="absolute inset-0 bg-foreground/30 transition-all duration-700 ease-out origin-left"
                  style={{
                    transform: `scaleX(${index < currentStep ? 1 : 0})`,
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mb-8 overflow-hidden rounded-full bg-muted/30 h-[2px]">
        <div
          className="h-full bg-gradient-to-r from-foreground/60 to-foreground transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-8">
        <div key={currentStepData.id} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={currentStepData.field} className="text-lg font-medium tracking-tight">
              {currentStepData.label}
            </Label>
            <span className="text-xs font-medium text-muted-foreground/60 tabular-nums">
              {currentStep + 1}/{steps.length}
            </span>
          </div>
          <div className="relative group">
            {currentStepData.field === "service" ? (
              <textarea
                id={currentStepData.field}
                placeholder={currentStepData.placeholder}
                value={formData[currentStepData.field] || ""}
                onChange={(e) => handleInputChange(currentStepData.field, e.target.value)}
                autoFocus
                rows={5}
                className="flex h-auto w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm shadow-black/5 transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            ) : (
              <Input
                id={currentStepData.field}
                type={currentStepData.field === "email" ? "email" : currentStepData.field === "whatsapp" ? "tel" : "text"}
                placeholder={currentStepData.placeholder}
                value={formData[currentStepData.field] || ""}
                onChange={(e) => handleInputChange(currentStepData.field, e.target.value)}
                autoFocus
                className="h-14 text-base transition-all duration-500 border-border/50 focus:border-foreground/20 bg-background/50 backdrop-blur"
              />
            )}
          </div>
        </div>

        <Button
          onClick={handleNext}
          disabled={!formData[currentStepData.field]?.trim()}
          className="w-full h-12 group relative transition-all duration-300 hover:shadow-lg hover:shadow-foreground/5"
        >
          <span className="flex items-center justify-center gap-2 font-medium">
            {currentStep === steps.length - 1 ? "Completa" : "Continua"}
            <ArrowRightIcon
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5 duration-300"
              strokeWidth={2}
            />
          </span>
        </Button>

        {currentStep > 0 && (
          <button
            onClick={() => setCurrentStep(currentStep - 1)}
            className="w-full text-center text-sm text-muted-foreground/60 hover:text-foreground/80 transition-all duration-300"
          >
            Torna indietro
          </button>
        )}
      </div>
    </div>
  )
}


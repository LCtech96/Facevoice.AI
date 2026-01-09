"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { CheckIcon, ArrowRightIcon, Calendar, Clock } from "lucide-react"
import GoogleAddressAutocomplete from "@/components/ui/google-address-autocomplete"

type Step = {
  id: number
  label: string
  field: string
  placeholder: string
  type?: 'text' | 'email' | 'tel' | 'textarea' | 'datetime'
}

const steps: Step[] = [
  { id: 1, label: "Nome e Cognome", field: "name", placeholder: "Il tuo nome completo", type: "text" },
  { id: 2, label: "Email", field: "email", placeholder: "la.tua.email@esempio.com", type: "email" },
  { id: 3, label: "Numero WhatsApp", field: "whatsapp", placeholder: "+39 123 456 7890", type: "tel" },
  { id: 4, label: "Indirizzo (Opzionale)", field: "address", placeholder: "Inserisci il tuo indirizzo", type: "address" },
  { id: 5, label: "Motivo del Booking", field: "service", placeholder: "Descrivi il tipo di servizio interessato o il motivo della prenotazione", type: "textarea" },
  { id: 6, label: "Data e Ora", field: "datetime", placeholder: "Seleziona data e ora preferita", type: "datetime" },
]

interface AddressData {
  street: string
  city: string
  state: string
  postalCode: string
  country: string
  fullAddress: string
}

export function BookingForm() {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [addressData, setAddressData] = useState<AddressData | null>(null)
  const [isComplete, setIsComplete] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      // All'ultimo step, salva e invia
      setIsComplete(true)
      handleSubmitBooking()
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value })
  }

  const handleSubmitBooking = async () => {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      // Prepara i dati datetime
      const datetimeData = formData['datetime-date'] && formData['datetime-time'] 
        ? {
            date: formData['datetime-date'],
            time: formData['datetime-time'],
          }
        : null

      const response = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          whatsapp: formData.whatsapp,
          service: formData.service,
          datetime: datetimeData,
          address: addressData ? {
            street: addressData.street,
            city: addressData.city,
            state: addressData.state,
            postalCode: addressData.postalCode,
            country: addressData.country,
            fullAddress: addressData.fullAddress,
          } : null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Errore nel salvare la prenotazione')
      }

      // La prenotazione è stata salvata e l'email è stata inviata
      // Mostra solo il messaggio di conferma
      setIsSubmitting(false)
    } catch (error: any) {
      setSubmitError(error.message || 'Errore nel salvare la prenotazione')
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
              <h2 className="text-xl font-medium tracking-tight text-balance">
                {isSubmitting ? 'Invio in corso...' : 'Prenotazione completata!'}
              </h2>
              <p className="text-sm text-muted-foreground/80">
                {isSubmitting ? 'Stiamo inviando la tua prenotazione...' : 'La tua prenotazione è stata effettuata'}
              </p>
            </div>
            {submitError && (
              <div className="w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500">
                {submitError}
              </div>
            )}
            {!isSubmitting && !submitError && (
              <button
                onClick={() => {
                  setIsComplete(false)
                  setCurrentStep(0)
                  setFormData({})
                  setSubmitError(null)
                }}
                className="w-full text-center text-sm text-muted-foreground/60 hover:text-foreground/80 transition-all duration-300 mt-4"
              >
                Nuova prenotazione
              </button>
            )}
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
            {currentStepData.type === "textarea" ? (
              <textarea
                id={currentStepData.field}
                placeholder={currentStepData.placeholder}
                value={formData[currentStepData.field] || ""}
                onChange={(e) => handleInputChange(currentStepData.field, e.target.value)}
                autoFocus
                rows={5}
                className="flex h-auto w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm shadow-black/5 transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            ) : currentStepData.type === "address" ? (
              <div>
                <p className="text-xs text-muted-foreground/70 mb-3">
                  Inserisci il tuo indirizzo per migliorare il servizio. Questo campo è opzionale.
                </p>
                <GoogleAddressAutocomplete
                  onAddressChange={(address) => {
                    setAddressData(address)
                    if (address) {
                      handleInputChange(currentStepData.field, address.fullAddress)
                    }
                  }}
                  value={addressData}
                  placeholder={currentStepData.placeholder}
                />
              </div>
            ) : currentStepData.type === "datetime" ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="booking-date" className="text-sm text-muted-foreground/70 mb-2 block">
                    Data
                  </label>
                  <Input
                    id="booking-date"
                    type="date"
                    value={formData['datetime-date'] || ""}
                    onChange={(e) => handleInputChange('datetime-date', e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    autoFocus
                    className="h-14 text-base transition-all duration-500 border-border/50 focus:border-foreground/20 bg-background/50 backdrop-blur"
                  />
                </div>
                <div>
                  <label htmlFor="booking-time" className="text-sm text-muted-foreground/70 mb-2 block">
                    Ora
                  </label>
                  <Input
                    id="booking-time"
                    type="time"
                    value={formData['datetime-time'] || ""}
                    onChange={(e) => handleInputChange('datetime-time', e.target.value)}
                    autoFocus={!!formData['datetime-date']}
                    className="h-14 text-base transition-all duration-500 border-border/50 focus:border-foreground/20 bg-background/50 backdrop-blur"
                  />
                </div>
                {(formData['datetime-date'] && formData['datetime-time']) && (
                  <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <p className="text-sm text-foreground">
                      <Calendar className="w-4 h-4 inline mr-2" />
                      {new Date(`${formData['datetime-date']}T${formData['datetime-time']}`).toLocaleString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <Input
                id={currentStepData.field}
                type={currentStepData.type || "text"}
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
          disabled={
            currentStepData.type === 'datetime' 
              ? !formData['datetime-date'] || !formData['datetime-time']
              : currentStepData.type === 'address'
              ? false // Il campo indirizzo è opzionale
              : !formData[currentStepData.field]?.trim()
          }
          className="w-full h-12 group relative transition-all duration-300 hover:shadow-lg hover:shadow-foreground/5"
        >
          <span className="flex items-center justify-center gap-2 font-medium">
            {currentStep === steps.length - 1 ? "Invia prenotazione" : "Continua"}
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


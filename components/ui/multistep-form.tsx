"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { CheckIcon, ArrowRightIcon } from "lucide-react"

type Step = {
  id: number
  label: string
  field: string
  placeholder: string
}

const steps: Step[] = [
  { id: 1, label: "Name", field: "name", placeholder: "Your full name" },
  { id: 2, label: "Email", field: "email", placeholder: "you@example.com" },
  { id: 3, label: "Goal", field: "goal", placeholder: "What brings you here?" },
]

export function MultiStepForm() {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [isComplete, setIsComplete] = useState(false)

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

  const currentStepData = steps[currentStep]
  const progress = ((currentStep + 1) / steps.length) * 100

  if (isComplete) {
    return (
      <div className="w-full max-w-sm">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border-color)]/50 bg-gradient-to-br from-[var(--background)] via-[var(--background)] to-[var(--background-secondary)]/20 p-12 backdrop-blur">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.1),transparent_50%)]" />
          <div className="relative flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-700">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--text-primary)]/10 bg-[var(--text-primary)]/5">
              <CheckIcon
                className="h-8 w-8 text-[var(--accent-blue)] animate-in zoom-in duration-500 delay-200"
                strokeWidth={2.5}
              />
            </div>
            <div className="space-y-1 text-center">
              <h2 className="text-xl font-medium tracking-tight text-balance text-[var(--text-primary)]">You're all set</h2>
              <p className="text-sm text-[var(--text-secondary)]/80">{formData.name}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-10 flex items-center justify-center gap-3">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            <button
              onClick={() => index < currentStep && setCurrentStep(index)}
              disabled={index > currentStep}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-700 ease-out",
                "disabled:cursor-not-allowed",
                index < currentStep && "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]",
                index === currentStep && "bg-[var(--accent-blue)] text-white shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]",
                index > currentStep && "bg-[var(--background-secondary)] text-[var(--text-secondary)]/40",
              )}
            >
              {index < currentStep ? (
                <CheckIcon className="h-4 w-4 animate-in zoom-in duration-500" strokeWidth={2.5} />
              ) : (
                <span className="text-sm font-medium tabular-nums">{step.id}</span>
              )}
              {index === currentStep && (
                <div className="absolute inset-0 rounded-full bg-[var(--accent-blue)]/20 blur-md animate-pulse" />
              )}
            </button>
            {index < steps.length - 1 && (
              <div className="relative h-[1.5px] w-12">
                <div className="absolute inset-0 bg-[rgba(207,207,207,0.4)]" />
                <div
                  className="absolute inset-0 bg-[var(--accent-blue)]/30 transition-all duration-700 ease-out origin-left"
                  style={{
                    transform: `scaleX(${index < currentStep ? 1 : 0})`,
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mb-8 overflow-hidden rounded-full bg-[var(--background-secondary)]/30 h-[2px]">
        <div
          className="h-full bg-gradient-to-r from-[var(--accent-blue)]/60 to-[var(--accent-blue)] transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-8">
        <div key={currentStepData.id} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={currentStepData.field} className="text-lg font-medium tracking-tight text-[var(--text-primary)]">
              {currentStepData.label}
            </Label>
            <span className="text-xs font-medium text-[var(--text-secondary)]/60 tabular-nums">
              {currentStep + 1}/{steps.length}
            </span>
          </div>
          <div className="relative group">
            <Input
              id={currentStepData.field}
              type={currentStepData.field === "email" ? "email" : "text"}
              placeholder={currentStepData.placeholder}
              value={formData[currentStepData.field] || ""}
              onChange={(e) => handleInputChange(currentStepData.field, e.target.value)}
              autoFocus
              className="h-14 text-base transition-all duration-500 border-[var(--border-color)]/50 focus:border-[var(--accent-blue)]/20 bg-[var(--background)]/50 backdrop-blur text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70"
            />
          </div>
        </div>

        <Button
          onClick={handleNext}
          disabled={!formData[currentStepData.field]?.trim()}
          className="w-full h-12 group relative transition-all duration-300 hover:shadow-lg hover:shadow-[var(--accent-blue)]/5 bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/90"
        >
          <span className="flex items-center justify-center gap-2 font-medium">
            {currentStep === steps.length - 1 ? "Complete" : "Continue"}
            <ArrowRightIcon
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5 duration-300"
              strokeWidth={2}
            />
          </span>
        </Button>

        {currentStep > 0 && (
          <button
            onClick={() => setCurrentStep(currentStep - 1)}
            className="w-full text-center text-sm text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]/80 transition-all duration-300"
          >
            Go back
          </button>
        )}
      </div>
    </div>
  )
}


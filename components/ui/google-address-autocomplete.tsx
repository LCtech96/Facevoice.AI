'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'

// Dichiarazioni di tipo per Google Maps
declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            inputField: HTMLInputElement,
            opts?: {
              types?: string[]
              componentRestrictions?: { country: string }
              fields?: string[]
            }
          ) => {
            addListener: (event: string, callback: () => void) => void
            getPlace: () => {
              address_components?: Array<{
                types: string[]
                long_name: string
                short_name: string
              }>
              formatted_address?: string
              geometry?: {
                location?: {
                  lat: () => number
                  lng: () => number
                }
              }
            }
          }
        }
        event: {
          clearInstanceListeners: (instance: any) => void
        }
      }
    }
  }
}

interface AddressData {
  street: string
  city: string
  state: string
  postalCode: string
  country: string
  fullAddress: string
}

interface GoogleAddressAutocompleteProps {
  onAddressChange: (address: AddressData | null) => void
  value?: AddressData | null
  className?: string
  placeholder?: string
}

const GOOGLE_MAPS_API_KEY = 'AIzaSyATeJUsRkoy6fVRYICbNE4ooniRA_N79gE'

export default function GoogleAddressAutocomplete({
  onAddressChange,
  value,
  className = '',
  placeholder = 'Inserisci il tuo indirizzo'
}: GoogleAddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [addressComponents, setAddressComponents] = useState<AddressData | null>(value || null)

  useEffect(() => {
    // Carica Google Maps API solo quando il componente è montato
    if (!window.google || !window.google.maps || !window.google.maps.places) {
      setIsLoading(true)
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&language=it`
      script.async = true
      script.defer = true
      script.onload = () => {
        setIsLoading(false)
        initializeAutocomplete()
      }
      script.onerror = () => {
        setIsLoading(false)
        console.error('Errore nel caricamento di Google Maps API')
      }
      document.head.appendChild(script)
    } else {
      initializeAutocomplete()
    }

    return () => {
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current)
      }
    }
  }, [])

  const initializeAutocomplete = () => {
    if (!inputRef.current || !window.google?.maps?.places) return

    const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'it' }, // Limita all'Italia
      fields: ['address_components', 'formatted_address', 'geometry']
    })

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      
      if (!place.address_components) {
        onAddressChange(null)
        return
      }

      const addressData: AddressData = {
        street: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
        fullAddress: place.formatted_address || ''
      }

      // Estrae i componenti dell'indirizzo
      place.address_components.forEach((component) => {
        const type = component.types[0]
        const value = component.long_name

        switch (type) {
          case 'street_number':
            addressData.street = `${value} ${addressData.street}`.trim()
            break
          case 'route':
            addressData.street = `${addressData.street} ${value}`.trim()
            break
          case 'locality':
            addressData.city = value
            break
          case 'administrative_area_level_1':
            addressData.state = component.short_name
            break
          case 'postal_code':
            addressData.postalCode = value
            break
          case 'country':
            addressData.country = component.long_name
            break
        }
      })

      setAddressComponents(addressData)
      onAddressChange(addressData)
    })

    autocompleteRef.current = autocomplete
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)] z-10" />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)] animate-spin z-10" />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          defaultValue={value?.fullAddress || ''}
          className="w-full pl-10 pr-10 py-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all h-14 text-base"
          disabled={isLoading}
        />
      </div>

      {addressComponents && (
        <div className="space-y-2 p-4 bg-[var(--background-secondary)] rounded-lg border border-[var(--border-color)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[var(--text-secondary)] block mb-1">Via/Indirizzo</span>
              <span className="text-[var(--text-primary)] font-medium">{addressComponents.street || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)] block mb-1">Città</span>
              <span className="text-[var(--text-primary)] font-medium">{addressComponents.city || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)] block mb-1">Provincia</span>
              <span className="text-[var(--text-primary)] font-medium">{addressComponents.state || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)] block mb-1">CAP</span>
              <span className="text-[var(--text-primary)] font-medium">{addressComponents.postalCode || '-'}</span>
            </div>
            <div className="md:col-span-2">
              <span className="text-[var(--text-secondary)] block mb-1">Indirizzo completo</span>
              <span className="text-[var(--text-primary)] font-medium text-xs">{addressComponents.fullAddress}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



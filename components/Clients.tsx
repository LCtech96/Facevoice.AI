'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Linkedin, Mail, X, Star } from 'lucide-react'

interface Client {
  id: number
  name: string
  email: string
  linkedin: string
  comment: string
  image: string
  rating: number
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([
    // Esempi di clienti possono essere aggiunti qui
  ])
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    linkedin: '',
    comment: '',
    image: '',
    rating: 5,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.name && formData.comment) {
      const newClient: Client = {
        id: Date.now(),
        ...formData,
        image: formData.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%2300BFFF20" width="200" height="200"/%3E%3Ctext fill="%2300BFFF" font-family="Arial" font-size="48" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E' + formData.name.charAt(0).toUpperCase() + '%3C/text%3E%3C/svg%3E',
      }
      setClients([...clients, newClient])
      setFormData({
        name: '',
        email: '',
        linkedin: '',
        comment: '',
        image: '',
        rating: 5,
      })
      setShowForm(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setFormData({ ...formData, image: reader.result as string })
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <section id="clients" className="min-h-screen py-24 px-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto"
      >
        <div className="flex items-center justify-between mb-16">
          <div>
            <h2 className="text-5xl md:text-6xl font-bold mb-4 gradient-text">
              Our Clients
            </h2>
            <p className="text-xl text-coral-red-light max-w-2xl">
              Trusted by businesses worldwide. Share your experience with us.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowForm(true)}
            className="glass-strong px-6 py-3 rounded-lg text-coral-red-light flex items-center gap-2 hover:border-coral-red border-2 border-transparent transition-all"
          >
            <Plus className="w-5 h-5" />
            <span>Add Review</span>
          </motion.button>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowForm(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-strong p-8 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-3xl font-bold text-coral-red-light">
                    Share Your Experience
                  </h3>
                  <button
                    onClick={() => setShowForm(false)}
                    className="p-2 hover:glass rounded-lg transition-all"
                  >
                    <X className="w-6 h-6 text-coral-red" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="block text-coral-red-light mb-2">
                      Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-4 py-3 glass rounded-lg text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent transition-all"
                      placeholder="Your name"
                    />
                  </div>

                  <div>
                    <label className="block text-coral-red-light mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      className="w-full px-4 py-3 glass rounded-lg text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent transition-all"
                      placeholder="your.email@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-coral-red-light mb-2">
                      LinkedIn URL
                    </label>
                    <input
                      type="url"
                      value={formData.linkedin}
                      onChange={(e) =>
                        setFormData({ ...formData, linkedin: e.target.value })
                      }
                      className="w-full px-4 py-3 glass rounded-lg text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent transition-all"
                      placeholder="https://linkedin.com/in/yourprofile"
                    />
                  </div>

                  <div>
                    <label className="block text-coral-red-light mb-2">
                      Photo
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="w-full px-4 py-3 glass rounded-lg text-coral-red file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-coral-red file:bg-coral-red/20 file:cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-coral-red-light mb-2">
                      Rating
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          type="button"
                          onClick={() =>
                            setFormData({ ...formData, rating })
                          }
                          className={`p-2 ${
                            rating <= formData.rating
                              ? 'text-coral-red'
                              : 'text-coral-red/30'
                          }`}
                        >
                          <Star
                            className={`w-6 h-6 ${
                              rating <= formData.rating ? 'fill-current' : ''
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-coral-red-light mb-2">
                      Comment *
                    </label>
                    <textarea
                      required
                      value={formData.comment}
                      onChange={(e) =>
                        setFormData({ ...formData, comment: e.target.value })
                      }
                      rows={4}
                      className="w-full px-4 py-3 glass rounded-lg text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent transition-all resize-none"
                      placeholder="Share your experience with Facevoice AI..."
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 glass-strong rounded-lg text-coral-red-light font-semibold hover:border-coral-red border-2 border-transparent transition-all"
                  >
                    Submit Review
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {clients.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-xl text-coral-red/70 mb-4">
              Be the first to share your experience!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {clients.map((client, index) => (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="glass-strong p-6 rounded-2xl"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden glass border-2 border-coral-red/30">
                    <img
                      src={client.image}
                      alt={client.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-coral-red-light mb-1">
                      {client.name}
                    </h4>
                    <div className="flex gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${
                            star <= client.rating
                              ? 'text-coral-red fill-current'
                              : 'text-coral-red/30'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-coral-red/80 mb-4 leading-relaxed">
                  {client.comment}
                </p>
                <div className="flex gap-3">
                  {client.email && (
                    <a
                      href={`mailto:${client.email}`}
                      className="p-2 glass rounded-lg hover:glass-strong transition-all"
                    >
                      <Mail className="w-4 h-4 text-coral-red" />
                    </a>
                  )}
                  {client.linkedin && (
                    <a
                      href={client.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 glass rounded-lg hover:glass-strong transition-all"
                    >
                      <Linkedin className="w-4 h-4 text-coral-red" />
                    </a>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </section>
  )
}


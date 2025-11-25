'use client'

import { motion } from 'framer-motion'
import { 
  Brain, 
  Link as LinkIcon, 
  Code, 
  MessageSquare, 
  Settings, 
  Bot 
} from 'lucide-react'

const services = [
  {
    id: 1,
    title: 'AI Integration & Solutions',
    icon: Brain,
    description: 'Seamless integration of AI technologies into your existing infrastructure',
  },
  {
    id: 2,
    title: 'Blockchain Development',
    icon: LinkIcon,
    description: 'Building secure and scalable blockchain solutions for your business',
  },
  {
    id: 3,
    title: 'Full-Stack Development',
    icon: Code,
    description: 'End-to-end web and mobile application development',
  },
  {
    id: 4,
    title: 'Technical Consulting',
    icon: MessageSquare,
    description: 'Expert guidance on technology strategy and implementation',
  },
  {
    id: 5,
    title: 'Automation Systems',
    icon: Settings,
    description: 'Streamline your operations with intelligent automation',
  },
  {
    id: 6,
    title: 'AI Agents Development',
    icon: Bot,
    description: 'Custom AI agents tailored to your specific business needs',
  },
]

export default function Services() {
  return (
    <section id="services" className="min-h-screen py-24 px-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto"
      >
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-4 gradient-text">
          Our Services
        </h2>
        <p className="text-xl text-coral-red-light text-center mb-16 max-w-2xl mx-auto">
          Comprehensive solutions to drive your business forward
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => {
            const Icon = service.icon
            return (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                whileHover={{ scale: 1.05, y: -10 }}
                className="glass-strong p-8 rounded-2xl cursor-pointer group"
              >
                <div className="mb-6">
                  <div className="w-16 h-16 glass rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Icon className="w-8 h-8 text-coral-red" />
                  </div>
                  <h3 className="text-2xl font-bold text-coral-red-light mb-3">
                    {service.title}
                  </h3>
                  <p className="text-coral-red/70 leading-relaxed">
                    {service.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </section>
  )
}


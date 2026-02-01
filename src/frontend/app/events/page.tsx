'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

interface Event {
    id: number
    title: string
    description: string
    date_start: string
    date_end: string | null
    price: number
    currency: string
    capacity: number
    sold_count: number
    image_url: string | null
    location_details: string | null
    event_type: 'STANDARD' | 'SEMINAR' | 'CONGRESS'
    output_format: 'TICKET' | 'BADGE'
    stripe_price_id: string | null
    is_active: boolean
    created_at: string
}

interface Ticket {
    id: string
    attendee_name: string
    attendee_phone: string
    attendee_company: string | null
    attendee_role: string | null
    status: 'PAID' | 'USED' | 'CANCELLED' | 'COMPLIMENTARY' | 'PAID_OFFLINE'
    sent_at: string | null
    created_at: string
}

interface CSVRow {
    [key: string]: string
}

interface ColumnMapping {
    name: string
    phone: string
    company: string
    role: string
}

export default function EventsPage() {
    const [loading, setLoading] = useState(true)
    const [events, setEvents] = useState<Event[]>([])
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showImportModal, setShowImportModal] = useState(false)
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
    const [tickets, setTickets] = useState<Ticket[]>([])
    const [status, setStatus] = useState({ type: '', message: '' })
    const [saving, setSaving] = useState(false)

    // Import state
    const [csvData, setCsvData] = useState<CSVRow[]>([])
    const [csvHeaders, setCsvHeaders] = useState<string[]>([])
    const [columnMapping, setColumnMapping] = useState<ColumnMapping>({ name: '', phone: '', company: '', role: '' })
    const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload')
    const [importing, setImporting] = useState(false)
    const [dragActive, setDragActive] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Queue status
    const [queueStatus, setQueueStatus] = useState<{ sent: number, pending: number, total: number } | null>(null)

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        date_start: '',
        date_end: '',
        price: 0,
        capacity: 100,
        image_url: '',
        location_details: '',
        event_type: 'STANDARD' as 'STANDARD' | 'SEMINAR' | 'CONGRESS',
        output_format: 'TICKET' as 'TICKET' | 'BADGE'
    })

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token')
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        })
    }

    useEffect(() => {
        fetchEvents()
    }, [])

    // Poll queue status when event is selected
    useEffect(() => {
        if (selectedEvent) {
            fetchQueueStatus(selectedEvent.id)
            const interval = setInterval(() => fetchQueueStatus(selectedEvent.id), 5000)
            return () => clearInterval(interval)
        }
    }, [selectedEvent?.id])

    const fetchEvents = async () => {
        try {
            const res = await authFetch(`${API_URL}/events`)
            if (res.ok) {
                const data = await res.json()
                setEvents(data)
            }
        } catch (err) {
            console.error('Failed to fetch events')
        } finally {
            setLoading(false)
        }
    }

    const fetchEventDetails = async (eventId: number) => {
        try {
            const res = await authFetch(`${API_URL}/events/${eventId}`)
            if (res.ok) {
                const data = await res.json()
                setSelectedEvent(data)
                setTickets(data.tickets || [])
            }
        } catch (err) {
            console.error('Failed to fetch event details')
        }
    }

    const fetchQueueStatus = async (eventId: number) => {
        try {
            const res = await authFetch(`${API_URL}/events/${eventId}/badge-queue`)
            if (res.ok) {
                const data = await res.json()
                setQueueStatus(data)
            }
        } catch (err) {
            console.error('Failed to fetch queue status')
        }
    }

    const handleEventTypeChange = (type: 'simple' | 'pro') => {
        if (type === 'simple') {
            setFormData({
                ...formData,
                event_type: 'STANDARD',
                output_format: 'TICKET',
                date_end: '',
                location_details: ''
            })
        } else {
            setFormData({
                ...formData,
                event_type: 'SEMINAR',
                output_format: 'BADGE'
            })
        }
    }

    const handleCreateEvent = async () => {
        if (!formData.title || !formData.date_start) {
            setStatus({ type: 'error', message: 'Titre et date requis' })
            return
        }

        setSaving(true)
        try {
            const res = await authFetch(`${API_URL}/events`, {
                method: 'POST',
                body: JSON.stringify(formData)
            })

            if (res.ok) {
                await fetchEvents()
                setShowCreateModal(false)
                setFormData({
                    title: '', description: '', date_start: '', date_end: '',
                    price: 0, capacity: 100, image_url: '', location_details: '',
                    event_type: 'STANDARD', output_format: 'TICKET'
                })
                setStatus({ type: 'success', message: 'Événement créé !' })
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error || 'Erreur' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteEvent = async (eventId: number) => {
        if (!confirm('Supprimer cet événement et tous ses billets ?')) return

        try {
            const res = await authFetch(`${API_URL}/events/${eventId}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                await fetchEvents()
                setSelectedEvent(null)
                setStatus({ type: 'success', message: 'Événement supprimé' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur suppression' })
        }
    }

    const handleCreateTicket = async (eventId: number) => {
        const name = prompt('Nom du participant :')
        if (!name) return

        const phone = prompt('Téléphone (optionnel) :') || ''

        let company = ''
        let role = ''
        if (selectedEvent?.output_format === 'BADGE') {
            company = prompt('Entreprise :') || ''
            role = prompt('Rôle (VIP, Speaker, Visiteur...) :') || 'Participant'
        }

        try {
            const res = await authFetch(`${API_URL}/events/${eventId}/tickets`, {
                method: 'POST',
                body: JSON.stringify({
                    attendee_name: name,
                    attendee_phone: phone,
                    attendee_company: company,
                    attendee_role: role
                })
            })

            if (res.ok) {
                await fetchEventDetails(eventId)
                setStatus({ type: 'success', message: selectedEvent?.output_format === 'BADGE' ? 'Badge créé ! 🪪' : 'Billet créé ! 🎫' })
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error || 'Erreur' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur création document' })
        }
    }

    // ============================================
    // CSV IMPORT FUNCTIONS
    // ============================================

    const parseCSV = (text: string) => {
        const lines = text.trim().split('\n')
        if (lines.length < 2) return { headers: [], data: [] }

        // Detect separator
        const sep = lines[0].includes(';') ? ';' : ','

        const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''))
        const data = lines.slice(1).map(line => {
            const values = line.split(sep).map(v => v.trim().replace(/"/g, ''))
            const row: CSVRow = {}
            headers.forEach((header, i) => {
                row[header] = values[i] || ''
            })
            return row
        }).filter(row => Object.values(row).some(v => v))

        return { headers, data }
    }

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragActive(false)

        const file = e.dataTransfer.files[0]
        if (file && file.type === 'text/csv') {
            processFile(file)
        }
    }, [])

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) processFile(file)
    }

    const processFile = (file: File) => {
        const reader = new FileReader()
        reader.onload = (e) => {
            const text = e.target?.result as string
            const { headers, data } = parseCSV(text)
            setCsvHeaders(headers)
            setCsvData(data)

            // Auto-detect column mapping
            const mapping: ColumnMapping = { name: '', phone: '', company: '', role: '' }
            headers.forEach(h => {
                const lower = h.toLowerCase()
                if (lower.includes('nom') || lower.includes('name') || lower === 'prenom' || lower === 'prénom') mapping.name = h
                if (lower.includes('tel') || lower.includes('phone') || lower.includes('mobile')) mapping.phone = h
                if (lower.includes('entreprise') || lower.includes('company') || lower.includes('société') || lower.includes('societe')) mapping.company = h
                if (lower.includes('role') || lower.includes('rôle') || lower.includes('fonction') || lower.includes('type')) mapping.role = h
            })
            setColumnMapping(mapping)
            setImportStep('mapping')
        }
        reader.readAsText(file)
    }

    const handleImportSubmit = async () => {
        if (!selectedEvent || !columnMapping.name || !columnMapping.phone) {
            setStatus({ type: 'error', message: 'Colonnes Nom et Téléphone requises' })
            return
        }

        setImporting(true)
        try {
            const attendees = csvData.map(row => ({
                name: row[columnMapping.name] || '',
                phone: row[columnMapping.phone] || '',
                company: columnMapping.company ? row[columnMapping.company] : '',
                role: columnMapping.role ? row[columnMapping.role] : ''
            })).filter(a => a.name && a.phone)

            const res = await authFetch(`${API_URL}/events/${selectedEvent.id}/import-attendees`, {
                method: 'POST',
                body: JSON.stringify({ attendees, send_badges: true })
            })

            if (res.ok) {
                const result = await res.json()
                setStatus({
                    type: 'success',
                    message: `✅ ${result.imported} importés, ${result.queued} badges en file d'attente`
                })
                setShowImportModal(false)
                resetImport()
                await fetchEventDetails(selectedEvent.id)
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error || 'Erreur import' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        } finally {
            setImporting(false)
        }
    }

    const resetImport = () => {
        setCsvData([])
        setCsvHeaders([])
        setColumnMapping({ name: '', phone: '', company: '', role: '' })
        setImportStep('upload')
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const isUpcoming = (dateString: string) => new Date(dateString) > new Date()

    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#128C7E]"></div>
                </div>
            </DashboardLayout>
        )
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">🎟️ Événements & Billetterie</h1>
                        <p className="text-gray-500 mt-1">Gérez vos événements, billets et badges professionnels</p>
                    </div>
                    <div className="flex gap-3">
                        <a
                            href="/events/analytics"
                            className="px-4 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 flex items-center gap-2"
                        >
                            📊 Analytics
                        </a>
                        <a
                            href="/events/scan"
                            className="px-4 py-2.5 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 flex items-center gap-2"
                        >
                            📱 Scanner
                        </a>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-4 py-2.5 bg-[#128C7E] text-white font-medium rounded-lg hover:bg-[#0a6b5f] flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Créer un événement
                        </button>
                    </div>
                </div>

                {/* Status */}
                {status.message && (
                    <div className={`p-4 rounded-lg ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        <span>{status.message}</span>
                        <button onClick={() => setStatus({ type: '', message: '' })} className="ml-4 underline">Fermer</button>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Events List */}
                    <div className="lg:col-span-1 space-y-4">
                        <h2 className="font-semibold text-gray-700">Vos événements</h2>

                        {events.length === 0 ? (
                            <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
                                <span className="text-4xl block mb-2">🎪</span>
                                Aucun événement
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {events.map(event => (
                                    <div
                                        key={event.id}
                                        onClick={() => fetchEventDetails(event.id)}
                                        className={`bg-white rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${selectedEvent?.id === event.id ? 'ring-2 ring-[#128C7E]' : ''}`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${isUpcoming(event.date_start) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                        {isUpcoming(event.date_start) ? '🟢 À venir' : '⚪ Passé'}
                                                    </span>
                                                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${event.output_format === 'BADGE' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                        {event.output_format === 'BADGE' ? '🪪 Badge' : '🎫 Ticket'}
                                                    </span>
                                                </div>
                                                <h3 className="font-semibold text-gray-900 mt-2">{event.title}</h3>
                                                <p className="text-sm text-gray-500 mt-1">{formatDate(event.date_start)}</p>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center mt-3 pt-3 border-t">
                                            <div className="flex items-center gap-4">
                                                <span className="text-sm text-gray-600">
                                                    <strong>{event.sold_count}</strong>/{event.capacity}
                                                </span>
                                                {event.price > 0 && (
                                                    <span className="text-sm font-semibold text-[#128C7E]">
                                                        {event.price} {event.currency}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-[#128C7E] transition-all"
                                                    style={{ width: `${(event.sold_count / event.capacity) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Event Details */}
                    <div className="lg:col-span-2">
                        {selectedEvent ? (
                            <div className="bg-white rounded-xl border overflow-hidden">
                                {/* Event Header */}
                                <div className={`p-6 ${selectedEvent.output_format === 'BADGE' ? 'bg-gradient-to-r from-slate-800 to-slate-600' : 'bg-gradient-to-r from-[#128C7E] to-emerald-600'}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className={`px-3 py-1 text-xs font-bold rounded-full ${selectedEvent.output_format === 'BADGE' ? 'bg-purple-500 text-white' : 'bg-white/20 text-white'}`}>
                                                    {selectedEvent.output_format === 'BADGE' ? '🪪 MODE BADGE' : '🎫 MODE TICKET'}
                                                </span>
                                            </div>
                                            <h2 className="text-2xl font-bold text-white">{selectedEvent.title}</h2>
                                            <p className="text-white/80 mt-1">{formatDate(selectedEvent.date_start)}</p>
                                            {selectedEvent.location_details && (
                                                <p className="text-white/70 text-sm mt-2">📍 {selectedEvent.location_details}</p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <div className="text-3xl font-bold text-white">
                                                {selectedEvent.sold_count}/{selectedEvent.capacity}
                                            </div>
                                            <div className="text-white/80 text-sm">participants</div>
                                        </div>
                                    </div>

                                    {/* Queue Status */}
                                    {queueStatus && queueStatus.pending > 0 && (
                                        <div className="mt-4 p-3 bg-white/10 rounded-lg">
                                            <div className="flex items-center gap-2 text-white text-sm">
                                                <div className="animate-pulse w-2 h-2 bg-yellow-400 rounded-full"></div>
                                                <span>{queueStatus.pending} badges en cours d'envoi...</span>
                                                <span className="text-white/60">({queueStatus.sent}/{queueStatus.total} envoyés)</span>
                                            </div>
                                            <div className="mt-2 h-2 bg-white/20 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-green-400 transition-all duration-500"
                                                    style={{ width: `${(queueStatus.sent / queueStatus.total) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="p-4 border-b bg-gray-50 flex gap-3 flex-wrap">
                                    <button
                                        onClick={() => handleCreateTicket(selectedEvent.id)}
                                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg"
                                    >
                                        ➕ Créer {selectedEvent.output_format === 'BADGE' ? 'un badge' : 'un billet'}
                                    </button>

                                    <button
                                        onClick={() => setShowImportModal(true)}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2"
                                    >
                                        📥 Importer une liste (CSV)
                                    </button>

                                    <button
                                        onClick={() => handleDeleteEvent(selectedEvent.id)}
                                        className="px-4 py-2 bg-red-100 text-red-600 font-medium rounded-lg hover:bg-red-200 ml-auto"
                                    >
                                        🗑️ Supprimer
                                    </button>
                                </div>

                                {/* Participants List */}
                                <div className="p-6">
                                    <h3 className="font-semibold text-gray-700 mb-4">
                                        Participants ({tickets.length})
                                    </h3>

                                    {tickets.length === 0 ? (
                                        <div className="text-center text-gray-400 py-8">
                                            <span className="text-4xl block mb-2">👥</span>
                                            Aucun participant pour le moment
                                            <p className="text-sm mt-2">Importez une liste CSV ou créez des badges manuellement</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-96 overflow-y-auto">
                                            {tickets.map(ticket => (
                                                <div key={ticket.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-3 h-3 rounded-full ${ticket.status === 'USED' ? 'bg-green-500' :
                                                            ticket.status === 'CANCELLED' ? 'bg-red-500' :
                                                                'bg-blue-500'
                                                            }`} />
                                                        <div>
                                                            <div className="font-medium text-gray-900">{ticket.attendee_name || 'Anonyme'}</div>
                                                            {ticket.attendee_company && (
                                                                <div className="text-sm text-gray-600">{ticket.attendee_company}</div>
                                                            )}
                                                            <div className="text-sm text-gray-500 flex items-center gap-2">
                                                                {ticket.attendee_role && (
                                                                    <span className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">{ticket.attendee_role}</span>
                                                                )}
                                                                {ticket.attendee_phone}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right flex items-center gap-2">
                                                        {ticket.sent_at ? (
                                                            <span className="text-green-600 text-xs">✅ Envoyé</span>
                                                        ) : (
                                                            <span className="text-yellow-600 text-xs">⏳ En attente</span>
                                                        )}
                                                        <span className={`px-2 py-1 text-xs font-medium rounded ${ticket.status === 'USED' ? 'bg-green-100 text-green-700' :
                                                            ticket.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                                                                ticket.status === 'COMPLIMENTARY' ? 'bg-purple-100 text-purple-700' :
                                                                    'bg-blue-100 text-blue-700'
                                                            }`}>
                                                            {ticket.status === 'USED' ? '✅ Utilisé' :
                                                                ticket.status === 'CANCELLED' ? '❌ Annulé' :
                                                                    ticket.status === 'COMPLIMENTARY' ? '🎁 Invité' :
                                                                        '🎫 Valide'}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                                <span className="text-5xl block mb-4">👈</span>
                                <p>Sélectionnez un événement pour voir les détails</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Create Event Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
                            <div className="p-5 border-b">
                                <h3 className="font-semibold text-gray-900 text-lg">🎉 Créer un événement</h3>
                            </div>

                            {/* Event Type Selector */}
                            <div className="p-5 border-b bg-gray-50">
                                <label className="block text-sm font-semibold text-gray-700 mb-3">Type d'événement</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        type="button"
                                        onClick={() => handleEventTypeChange('simple')}
                                        className={`p-4 rounded-xl border-2 text-left transition-all ${formData.output_format === 'TICKET' ? 'border-[#128C7E] bg-[#128C7E]/5' : 'border-gray-200 hover:border-gray-300'}`}
                                    >
                                        <div className="text-3xl mb-2">🎟️</div>
                                        <div className="font-semibold text-gray-900">Événement Simple</div>
                                        <div className="text-sm text-gray-500 mt-1">Concert, Dîner, Soirée...</div>
                                        <div className="text-xs text-[#128C7E] mt-2 font-medium">→ Génère un TICKET</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleEventTypeChange('pro')}
                                        className={`p-4 rounded-xl border-2 text-left transition-all ${formData.output_format === 'BADGE' ? 'border-purple-600 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}
                                    >
                                        <div className="text-3xl mb-2">🪪</div>
                                        <div className="font-semibold text-gray-900">Événement Pro</div>
                                        <div className="text-sm text-gray-500 mt-1">Congrès, Séminaire, Salon...</div>
                                        <div className="text-xs text-purple-600 mt-2 font-medium">→ Génère un BADGE nominatif</div>
                                    </button>
                                </div>
                            </div>

                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Titre *</label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        placeholder={formData.output_format === 'BADGE' ? 'Ex: Forum Tech 2026' : 'Ex: Concert de Jazz'}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Date début *</label>
                                        <input
                                            type="datetime-local"
                                            value={formData.date_start}
                                            onChange={(e) => setFormData({ ...formData, date_start: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                        />
                                    </div>
                                    {formData.output_format === 'BADGE' && (
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Date fin</label>
                                            <input
                                                type="datetime-local"
                                                value={formData.date_end}
                                                onChange={(e) => setFormData({ ...formData, date_end: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Capacité</label>
                                        <input
                                            type="number"
                                            value={formData.capacity}
                                            onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 100 })}
                                            min="1"
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                        />
                                    </div>
                                </div>

                                {formData.output_format === 'BADGE' && (
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">📍 Lieu complet</label>
                                        <input
                                            type="text"
                                            value={formData.location_details}
                                            onChange={(e) => setFormData({ ...formData, location_details: e.target.value })}
                                            placeholder="Ex: Palais des Congrès, Paris"
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                        />
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Prix (€) - 0 = Gratuit</label>
                                    <input
                                        type="number"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                                        min="0"
                                        step="0.01"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                    />
                                </div>
                            </div>

                            <div className="p-4 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleCreateEvent}
                                    disabled={saving || !formData.title || !formData.date_start}
                                    className={`flex-1 py-2.5 font-medium rounded-lg disabled:opacity-50 ${formData.output_format === 'BADGE' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-[#128C7E] hover:bg-[#0a6b5f] text-white'}`}
                                >
                                    {saving ? 'Création...' : formData.output_format === 'BADGE' ? '🪪 Créer' : '🎟️ Créer'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Import CSV Modal */}
                {showImportModal && selectedEvent && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
                            <div className="p-5 border-b flex justify-between items-center">
                                <h3 className="font-semibold text-gray-900 text-lg">📥 Importer des participants</h3>
                                <button onClick={() => { setShowImportModal(false); resetImport() }} className="text-gray-400 hover:text-gray-600">✕</button>
                            </div>

                            {importStep === 'upload' && (
                                <div className="p-6">
                                    <div
                                        onDrop={handleFileDrop}
                                        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                                        onDragLeave={() => setDragActive(false)}
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".csv"
                                            onChange={handleFileSelect}
                                            className="hidden"
                                        />
                                        <div className="text-5xl mb-4">📄</div>
                                        <div className="text-lg font-medium text-gray-700">Glissez votre fichier CSV ici</div>
                                        <div className="text-sm text-gray-500 mt-2">ou cliquez pour sélectionner</div>
                                        <div className="mt-4 text-xs text-gray-400">
                                            Colonnes attendues : nom, téléphone, entreprise (optionnel), rôle (optionnel)
                                        </div>
                                    </div>
                                </div>
                            )}

                            {importStep === 'mapping' && (
                                <div className="p-6 space-y-6">
                                    <div className="bg-blue-50 p-4 rounded-lg">
                                        <div className="font-medium text-blue-800">📊 {csvData.length} lignes détectées</div>
                                        <div className="text-sm text-blue-600 mt-1">Associez les colonnes de votre fichier aux champs requis</div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Nom * (obligatoire)</label>
                                            <select
                                                value={columnMapping.name}
                                                onChange={(e) => setColumnMapping({ ...columnMapping, name: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg"
                                            >
                                                <option value="">-- Sélectionner --</option>
                                                {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Téléphone * (obligatoire)</label>
                                            <select
                                                value={columnMapping.phone}
                                                onChange={(e) => setColumnMapping({ ...columnMapping, phone: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg"
                                            >
                                                <option value="">-- Sélectionner --</option>
                                                {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Entreprise (optionnel)</label>
                                            <select
                                                value={columnMapping.company}
                                                onChange={(e) => setColumnMapping({ ...columnMapping, company: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg"
                                            >
                                                <option value="">-- Ignorer --</option>
                                                {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Rôle (optionnel)</label>
                                            <select
                                                value={columnMapping.role}
                                                onChange={(e) => setColumnMapping({ ...columnMapping, role: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg"
                                            >
                                                <option value="">-- Ignorer --</option>
                                                {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Preview first rows */}
                                    {columnMapping.name && columnMapping.phone && (
                                        <div>
                                            <h4 className="font-medium text-gray-700 mb-2">Aperçu (3 premières lignes)</h4>
                                            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                                                {csvData.slice(0, 3).map((row, i) => (
                                                    <div key={i} className="flex gap-4">
                                                        <span className="font-medium">{row[columnMapping.name]}</span>
                                                        <span className="text-gray-500">{row[columnMapping.phone]}</span>
                                                        {columnMapping.company && <span className="text-gray-400">{row[columnMapping.company]}</span>}
                                                        {columnMapping.role && <span className="text-purple-600">{row[columnMapping.role]}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="p-4 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => { setShowImportModal(false); resetImport() }}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300"
                                >
                                    Annuler
                                </button>
                                {importStep === 'mapping' && (
                                    <button
                                        onClick={handleImportSubmit}
                                        disabled={importing || !columnMapping.name || !columnMapping.phone}
                                        className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50"
                                    >
                                        {importing ? '⏳ Import en cours...' : `📤 Importer ${csvData.length} participants`}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    )
}

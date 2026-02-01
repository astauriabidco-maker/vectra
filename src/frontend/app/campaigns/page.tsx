'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Template {
    id: string
    name: string
    language: string
    meta_status: string
}

interface Campaign {
    id: string
    name: string
    status: 'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
    total_contacts: number
    total_sent: number
    total_failed: number
    template_name: string | null
    scheduled_at: string | null
    created_at: string
    completed_at: string | null
}

export default function CampaignsPage() {
    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [templates, setTemplates] = useState<Template[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [step, setStep] = useState(1)
    const [newCampaign, setNewCampaign] = useState({ name: '', template_id: '' })
    const [saving, setSaving] = useState(false)
    const [launching, setLaunching] = useState<string | null>(null)
    const [scheduleMode, setScheduleMode] = useState(false)
    const [scheduledDate, setScheduledDate] = useState('')
    const [scheduledTime, setScheduledTime] = useState('')
    const [scheduling, setScheduling] = useState<string | null>(null)
    const [schedulingCampaignId, setSchedulingCampaignId] = useState<string | null>(null)
    const [recurrenceType, setRecurrenceType] = useState('none')

    // Filter states
    const [availableTags, setAvailableTags] = useState<string[]>([])
    const [availableLocations, setAvailableLocations] = useState<string[]>([])
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [selectedLocation, setSelectedLocation] = useState('')
    const [lastInteractionDays, setLastInteractionDays] = useState<number>(0)
    const [previewCount, setPreviewCount] = useState<number | null>(null)

    // A/B Test states
    const [abTestEnabled, setAbTestEnabled] = useState(false)
    const [variantATemplate, setVariantATemplate] = useState('')
    const [variantBTemplate, setVariantBTemplate] = useState('')

    // Analytics Dashboard state
    interface AnalyticsKPIs {
        totalCampaigns: number
        totalContacts: number
        totalSent: number
        totalFailed: number
        totalRead: number
        totalResponses: number
        deliveryRate: number
        openRate: number
        responseRate: number
    }
    const [analytics, setAnalytics] = useState<AnalyticsKPIs | null>(null)
    const [showDashboard, setShowDashboard] = useState(true)

    // Campaign Detail Modal state
    interface CampaignDetail {
        id: string
        name: string
        status: string
        total_contacts: number
        total_sent: number
        total_failed: number
        read_count: number
        response_count: number
        conversion_count: number
        template_name: string
        created_at: string
        completed_at: string | null
        analytics: {
            delivered: number
            deliveryRate: string
            openRate: string
            responseRate: string
            conversionRate: string
        }
        variants?: Array<{
            variant_letter: string
            template_name: string
            sent: number
            failed: number
            delivery_rate: string
            open_rate: string
        }>
        recent_items?: Array<{
            id: string
            phone: string
            status: string
            sent_at: string
            read_at: string | null
            error_message: string | null
        }>
    }
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)


    // Auth fetch helper
    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token')
        return fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...options.headers
            }
        })
    }

    // Load campaigns, templates, and analytics
    const fetchData = async () => {
        try {
            const [campaignsRes, templatesRes, analyticsRes] = await Promise.all([
                authFetch(`${API_URL}/campaigns`),
                authFetch(`${API_URL}/templates`),
                authFetch(`${API_URL}/campaigns/analytics`)
            ])

            if (campaignsRes.ok) {
                setCampaigns(await campaignsRes.json())
            }
            if (templatesRes.ok) {
                const allTemplates = await templatesRes.json()
                // Filter only APPROVED templates
                setTemplates(allTemplates.filter((t: Template) => t.meta_status === 'APPROVED'))
            }
            if (analyticsRes.ok) {
                const data = await analyticsRes.json()
                setAnalytics(data.kpis)
            }
        } catch (err) {
            console.error('Failed to fetch data')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
        // Refresh every 5 seconds to update progress
        const interval = setInterval(fetchData, 5000)
        return () => clearInterval(interval)
    }, [])

    // Fetch filter options (tags and locations)
    const fetchFiltersData = async () => {
        try {
            const [tagsRes, locationsRes] = await Promise.all([
                authFetch(`${API_URL}/contacts/tags`),
                authFetch(`${API_URL}/contacts/locations`)
            ])
            if (tagsRes.ok) setAvailableTags(await tagsRes.json())
            if (locationsRes.ok) setAvailableLocations(await locationsRes.json())
        } catch (err) {
            console.error('Failed to fetch filter options')
        }
    }

    // Preview contacts count based on current filters
    const previewContacts = async () => {
        try {
            const filter: Record<string, unknown> = {}
            if (selectedTags.length > 0) filter.tags = selectedTags
            if (selectedLocation) filter.location = selectedLocation
            if (lastInteractionDays > 0) filter.last_interaction_days = lastInteractionDays

            const res = await authFetch(`${API_URL}/campaigns/preview-contacts`, {
                method: 'POST',
                body: JSON.stringify({ target_filter: filter })
            })
            if (res.ok) {
                const data = await res.json()
                setPreviewCount(data.count)
            }
        } catch (err) {
            console.error('Failed to preview contacts')
        }
    }

    // Fetch campaign details with analytics
    const fetchCampaignDetails = async (campaignId: string) => {
        setLoadingDetail(true)
        setShowDetailModal(true)
        try {
            const res = await authFetch(`${API_URL}/campaigns/${campaignId}`)
            if (res.ok) {
                const data = await res.json()
                setSelectedCampaign(data)
            }
        } catch (err) {
            console.error('Failed to fetch campaign details')
        } finally {
            setLoadingDetail(false)
        }
    }

    // Load filter options when step 3 is opened
    useEffect(() => {
        if (step === 3) {
            fetchFiltersData()
            previewContacts()
        }
    }, [step])

    // Update preview when filters change
    useEffect(() => {
        if (step === 3) {
            previewContacts()
        }
    }, [selectedTags, selectedLocation, lastInteractionDays])


    // Create campaign
    const handleCreate = async () => {
        if (!newCampaign.name) return

        // For A/B test, require both variants; for normal, require single template
        if (abTestEnabled) {
            if (!variantATemplate || !variantBTemplate) {
                alert('Pour un A/B Test, sélectionnez les templates A et B')
                return
            }
        } else {
            if (!newCampaign.template_id) return
        }

        // Build target filter
        const target_filter: Record<string, unknown> = {}
        if (selectedTags.length > 0) target_filter.tags = selectedTags
        if (selectedLocation) target_filter.location = selectedLocation
        if (lastInteractionDays > 0) target_filter.last_interaction_days = lastInteractionDays

        // Build variants array for A/B test
        const variants = abTestEnabled ? [
            { template_id: variantATemplate, split_percent: 50 },
            { template_id: variantBTemplate, split_percent: 50 }
        ] : undefined

        setSaving(true)
        try {
            const res = await authFetch(`${API_URL}/campaigns`, {
                method: 'POST',
                body: JSON.stringify({
                    name: newCampaign.name,
                    template_id: abTestEnabled ? undefined : newCampaign.template_id,
                    target_filter,
                    ab_test_enabled: abTestEnabled,
                    variants
                })
            })
            if (res.ok) {
                const campaign = await res.json()
                setCampaigns([campaign, ...campaigns])
                // Reset all form state
                setNewCampaign({ name: '', template_id: '' })
                setSelectedTags([])
                setSelectedLocation('')
                setLastInteractionDays(0)
                setPreviewCount(null)
                setAbTestEnabled(false)
                setVariantATemplate('')
                setVariantBTemplate('')
                setStep(1)
                setShowModal(false)
            }
        } catch (err) {
            console.error('Failed to create campaign')
        } finally {
            setSaving(false)
        }
    }

    // Launch campaign
    const handleLaunch = async (id: string) => {
        if (!confirm('Lancer cette campagne ? Les messages seront envoyés à tous les contacts.')) return

        setLaunching(id)
        try {
            const res = await authFetch(`${API_URL}/campaigns/${id}/launch`, { method: 'POST', body: JSON.stringify({}) })
            if (res.ok) {
                const data = await res.json()
                alert(`Campagne lancée ! ${data.total_contacts} messages en file d'attente.`)
                fetchData()
            } else {
                const error = await res.json()
                alert(error.error || 'Erreur lors du lancement')
            }
        } catch (err) {
            console.error('Failed to launch campaign')
        } finally {
            setLaunching(null)
        }
    }

    // Schedule campaign for later
    const handleSchedule = async (id: string, date?: string, time?: string) => {
        const useDate = date || scheduledDate
        const useTime = time || scheduledTime

        if (!useDate || !useTime) {
            alert('Veuillez sélectionner une date et une heure')
            return
        }

        const scheduled_at = new Date(`${useDate}T${useTime}`).toISOString()

        setScheduling(id)
        try {
            const res = await authFetch(`${API_URL}/campaigns/${id}/schedule`, {
                method: 'POST',
                body: JSON.stringify({ scheduled_at, recurrence_type: recurrenceType })
            })
            if (res.ok) {
                const data = await res.json()
                alert(data.message)
                fetchData()
                setScheduleMode(false)
                setScheduledDate('')
                setScheduledTime('')
                setRecurrenceType('none')
            } else {
                const error = await res.json()
                alert(error.error || 'Erreur lors de la programmation')
            }
        } catch (err) {
            console.error('Failed to schedule campaign')
        } finally {
            setScheduling(null)
        }
    }

    // Cancel scheduled campaign
    const handleCancelSchedule = async (id: string) => {
        if (!confirm('Annuler la programmation de cette campagne ?')) return

        try {
            const res = await authFetch(`${API_URL}/campaigns/${id}/cancel-schedule`, { method: 'POST' })
            if (res.ok) {
                alert('Programmation annulée')
                fetchData()
            } else {
                const error = await res.json()
                alert(error.error || 'Erreur')
            }
        } catch (err) {
            console.error('Failed to cancel schedule')
        }
    }

    // Status badge
    const getStatusBadge = (status: string, scheduled_at?: string | null) => {
        switch (status) {
            case 'DRAFT':
                return <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">Brouillon</span>
            case 'SCHEDULED':
                return (
                    <span className="px-2 py-1 bg-purple-100 text-purple-600 text-xs font-semibold rounded-full">
                        ⏰ {scheduled_at ? new Date(scheduled_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Programmée'}
                    </span>
                )
            case 'PROCESSING':
                return <span className="px-2 py-1 bg-blue-100 text-blue-600 text-xs font-semibold rounded-full animate-pulse">En cours...</span>
            case 'COMPLETED':
                return <span className="px-2 py-1 bg-green-100 text-green-600 text-xs font-semibold rounded-full">Terminée</span>
            case 'FAILED':
                return <span className="px-2 py-1 bg-red-100 text-red-600 text-xs font-semibold rounded-full">Échouée</span>
            default:
                return null
        }
    }

    // Progress bar
    const getProgress = (campaign: Campaign) => {
        if (campaign.total_contacts === 0) return 0
        return Math.round(((campaign.total_sent + campaign.total_failed) / campaign.total_contacts) * 100)
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">📢 Campagnes</h1>
                        <p className="text-gray-500 mt-1">Envoi de messages en masse</p>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="px-4 py-2 bg-[#128C7E] hover:bg-[#075E54] text-white font-semibold rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Nouvelle Campagne
                    </button>
                </div>

                {/* Analytics Dashboard */}
                {analytics && (
                    <div className="bg-gradient-to-br from-[#128C7E]/10 via-white to-emerald-50 rounded-2xl shadow-sm border border-[#128C7E]/20 overflow-hidden">
                        <div
                            className="flex justify-between items-center px-5 py-3 cursor-pointer hover:bg-[#128C7E]/5 transition-colors"
                            onClick={() => setShowDashboard(!showDashboard)}
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-lg">📊</span>
                                <h2 className="font-semibold text-gray-800">Tableau de bord</h2>
                            </div>
                            <svg
                                className={`w-5 h-5 text-gray-500 transition-transform ${showDashboard ? 'rotate-180' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>

                        {showDashboard && (
                            <div className="px-5 pb-5">
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                    {/* Delivery Rate */}
                                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-2xl">📨</span>
                                            <span className="text-xs font-medium text-gray-500 uppercase">Livraison</span>
                                        </div>
                                        <p className="text-2xl font-bold text-[#128C7E]">{analytics.deliveryRate}%</p>
                                        <p className="text-xs text-gray-400 mt-1">{analytics.totalSent - analytics.totalFailed} / {analytics.totalSent}</p>
                                    </div>

                                    {/* Open Rate */}
                                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-2xl">👁️</span>
                                            <span className="text-xs font-medium text-gray-500 uppercase">Ouverture</span>
                                        </div>
                                        <p className="text-2xl font-bold text-blue-600">{analytics.openRate}%</p>
                                        <p className="text-xs text-gray-400 mt-1">{analytics.totalRead} messages lus</p>
                                    </div>

                                    {/* Response Rate */}
                                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-2xl">💬</span>
                                            <span className="text-xs font-medium text-gray-500 uppercase">Réponses</span>
                                        </div>
                                        <p className="text-2xl font-bold text-purple-600">{analytics.responseRate}%</p>
                                        <p className="text-xs text-gray-400 mt-1">{analytics.totalResponses} réponses</p>
                                    </div>

                                    {/* Total Sent */}
                                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-2xl">✉️</span>
                                            <span className="text-xs font-medium text-gray-500 uppercase">Envoyés</span>
                                        </div>
                                        <p className="text-2xl font-bold text-gray-800">{analytics.totalSent.toLocaleString()}</p>
                                        <p className="text-xs text-gray-400 mt-1">{analytics.totalContacts.toLocaleString()} contacts</p>
                                    </div>

                                    {/* Campaigns */}
                                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-2xl">📢</span>
                                            <span className="text-xs font-medium text-gray-500 uppercase">Campagnes</span>
                                        </div>
                                        <p className="text-2xl font-bold text-amber-600">{analytics.totalCampaigns}</p>
                                        <p className="text-xs text-gray-400 mt-1">{analytics.totalFailed} échecs</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Campaigns List */}
                <div className="space-y-4">
                    {loading ? (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
                            Chargement...
                        </div>
                    ) : campaigns.length === 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
                            Aucune campagne. Créez-en une !
                        </div>
                    ) : (
                        campaigns.map(campaign => (
                            <div key={campaign.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="font-bold text-gray-900 text-lg">{campaign.name}</h3>
                                        <p className="text-gray-500 text-sm">
                                            Template: {campaign.template_name || 'Non défini'} •
                                            Créée le {new Date(campaign.created_at).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {getStatusBadge(campaign.status, campaign.scheduled_at)}
                                        {campaign.status === 'DRAFT' && (
                                            <>
                                                <button
                                                    onClick={() => handleLaunch(campaign.id)}
                                                    disabled={launching === campaign.id}
                                                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                                                >
                                                    {launching === campaign.id ? '⏳' : '🚀'} Lancer
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setSchedulingCampaignId(campaign.id)
                                                        setScheduledDate('')
                                                        setScheduledTime('')
                                                    }}
                                                    className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white font-semibold rounded-lg text-sm transition-colors"
                                                >
                                                    ⏰ Programmer
                                                </button>
                                            </>
                                        )}
                                        {campaign.status === 'SCHEDULED' && (
                                            <button
                                                onClick={() => handleCancelSchedule(campaign.id)}
                                                className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-600 font-semibold rounded-lg text-sm transition-colors"
                                            >
                                                ✕ Annuler
                                            </button>
                                        )}
                                        {(campaign.status === 'PROCESSING' || campaign.status === 'COMPLETED') && (
                                            <button
                                                onClick={() => fetchCampaignDetails(campaign.id)}
                                                className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-600 font-semibold rounded-lg text-sm transition-colors flex items-center gap-1"
                                            >
                                                📊 Stats
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Progress */}
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">
                                            {campaign.total_sent + campaign.total_failed} / {campaign.total_contacts} messages
                                        </span>
                                        <span className="font-semibold text-gray-700">{getProgress(campaign)}%</span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[#128C7E] transition-all duration-500"
                                            style={{ width: `${getProgress(campaign)}%` }}
                                        />
                                    </div>
                                    <div className="flex gap-4 text-xs text-gray-500">
                                        <span>✅ Envoyés: {campaign.total_sent}</span>
                                        <span>❌ Échoués: {campaign.total_failed}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Create Campaign Modal */}
                {showModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
                            {/* Steps Indicator */}
                            <div className="flex items-center justify-center gap-2 mb-6">
                                {[1, 2, 3, 4].map(s => (
                                    <div key={s} className="flex items-center">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= s ? 'bg-[#128C7E] text-white' : 'bg-gray-200 text-gray-500'
                                            }`}>
                                            {s}
                                        </div>
                                        {s < 4 && <div className={`w-8 h-1 mx-1 ${step > s ? 'bg-[#128C7E]' : 'bg-gray-200'}`} />}
                                    </div>
                                ))}
                            </div>

                            {/* Step 1: Name */}
                            {step === 1 && (
                                <div className="space-y-4">
                                    <h2 className="text-xl font-bold text-gray-900 text-center">Nom de la campagne</h2>
                                    <input
                                        type="text"
                                        placeholder="Ex: Promo Janvier 2026"
                                        value={newCampaign.name}
                                        onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent text-center"
                                    />
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setShowModal(false)}
                                            className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg"
                                        >
                                            Annuler
                                        </button>
                                        <button
                                            onClick={() => setStep(2)}
                                            disabled={!newCampaign.name}
                                            className="flex-1 px-4 py-3 bg-[#128C7E] text-white font-semibold rounded-lg disabled:opacity-50"
                                        >
                                            Suivant →
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Step 2: Template / A/B Test */}
                            {step === 2 && (
                                <div className="space-y-4">
                                    <h2 className="text-xl font-bold text-gray-900 text-center">
                                        {abTestEnabled ? '🧪 A/B Test' : 'Choisir un template'}
                                    </h2>

                                    {/* A/B Test Toggle */}
                                    <div className="flex items-center justify-center gap-3 p-3 bg-purple-50 rounded-lg">
                                        <span className="text-sm text-gray-600">Mode normal</span>
                                        <button
                                            onClick={() => setAbTestEnabled(!abTestEnabled)}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${abTestEnabled ? 'bg-purple-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${abTestEnabled ? 'translate-x-7' : 'translate-x-1'
                                                }`} />
                                        </button>
                                        <span className="text-sm font-medium text-purple-600">A/B Test</span>
                                    </div>

                                    {!abTestEnabled ? (
                                        // Single Template Mode
                                        <>
                                            <p className="text-sm text-gray-500 text-center">Seuls les templates approuvés sont affichés</p>
                                            {templates.length === 0 ? (
                                                <p className="text-center text-gray-400 py-4">Aucun template approuvé disponible</p>
                                            ) : (
                                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                                    {templates.map(template => (
                                                        <button
                                                            key={template.id}
                                                            onClick={() => setNewCampaign({ ...newCampaign, template_id: template.id })}
                                                            className={`w-full p-4 rounded-lg border-2 text-left transition-all ${newCampaign.template_id === template.id
                                                                ? 'border-[#128C7E] bg-[#128C7E]/5'
                                                                : 'border-gray-200 hover:border-gray-300'
                                                                }`}
                                                        >
                                                            <p className="font-semibold text-gray-800">{template.name}</p>
                                                            <p className="text-sm text-gray-500">Langue: {template.language}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        // A/B Test Mode - Two Variants
                                        <div className="space-y-4">
                                            <p className="text-sm text-gray-500 text-center">Sélectionnez 2 templates à comparer (50/50)</p>

                                            {/* Variant A */}
                                            <div className="space-y-2">
                                                <label className="block text-sm font-bold text-purple-600">Template A</label>
                                                <div className="space-y-2 max-h-32 overflow-y-auto">
                                                    {templates.map(template => (
                                                        <button
                                                            key={template.id}
                                                            onClick={() => setVariantATemplate(template.id)}
                                                            disabled={variantBTemplate === template.id}
                                                            className={`w-full p-3 rounded-lg border-2 text-left transition-all ${variantATemplate === template.id
                                                                ? 'border-purple-500 bg-purple-50'
                                                                : variantBTemplate === template.id
                                                                    ? 'border-gray-100 bg-gray-50 opacity-50'
                                                                    : 'border-gray-200 hover:border-purple-300'
                                                                }`}
                                                        >
                                                            <p className="font-semibold text-gray-800 text-sm">{template.name}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Variant B */}
                                            <div className="space-y-2">
                                                <label className="block text-sm font-bold text-orange-600">Template B</label>
                                                <div className="space-y-2 max-h-32 overflow-y-auto">
                                                    {templates.map(template => (
                                                        <button
                                                            key={template.id}
                                                            onClick={() => setVariantBTemplate(template.id)}
                                                            disabled={variantATemplate === template.id}
                                                            className={`w-full p-3 rounded-lg border-2 text-left transition-all ${variantBTemplate === template.id
                                                                ? 'border-orange-500 bg-orange-50'
                                                                : variantATemplate === template.id
                                                                    ? 'border-gray-100 bg-gray-50 opacity-50'
                                                                    : 'border-gray-200 hover:border-orange-300'
                                                                }`}
                                                        >
                                                            <p className="font-semibold text-gray-800 text-sm">{template.name}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <button onClick={() => setStep(1)} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg">
                                            ← Retour
                                        </button>
                                        <button
                                            onClick={() => setStep(3)}
                                            disabled={abTestEnabled ? (!variantATemplate || !variantBTemplate) : !newCampaign.template_id}
                                            className="flex-1 px-4 py-3 bg-[#128C7E] text-white font-semibold rounded-lg disabled:opacity-50"
                                        >
                                            Suivant →
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Step 3: Filters */}
                            {step === 3 && (
                                <div className="space-y-4">
                                    <h2 className="text-xl font-bold text-gray-900 text-center">🎯 Ciblage</h2>
                                    <p className="text-sm text-gray-500 text-center">Filtrez les contacts à cibler (optionnel)</p>

                                    {/* Tags */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                                        <div className="flex flex-wrap gap-2">
                                            {availableTags.length === 0 ? (
                                                <span className="text-gray-400 text-sm">Aucun tag disponible</span>
                                            ) : (
                                                availableTags.map(tag => (
                                                    <button
                                                        key={tag}
                                                        onClick={() => {
                                                            if (selectedTags.includes(tag)) {
                                                                setSelectedTags(selectedTags.filter(t => t !== tag))
                                                            } else {
                                                                setSelectedTags([...selectedTags, tag])
                                                            }
                                                        }}
                                                        className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${selectedTags.includes(tag)
                                                            ? 'bg-[#128C7E] text-white'
                                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                            }`}
                                                    >
                                                        {tag}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    {/* Location */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Localisation</label>
                                        <select
                                            value={selectedLocation}
                                            onChange={(e) => setSelectedLocation(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E]"
                                        >
                                            <option value="">Toutes les localisations</option>
                                            {availableLocations.map(loc => (
                                                <option key={loc} value={loc}>{loc}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Last Interaction */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Interaction récente (derniers X jours)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="365"
                                            value={lastInteractionDays || ''}
                                            onChange={(e) => setLastInteractionDays(parseInt(e.target.value) || 0)}
                                            placeholder="Ex: 30 (laisser vide = tous)"
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E]"
                                        />
                                    </div>

                                    {/* Preview Count */}
                                    <div className="bg-purple-50 rounded-lg p-4 text-center">
                                        <p className="text-2xl font-bold text-purple-600">
                                            {previewCount !== null ? previewCount : '...'}
                                        </p>
                                        <p className="text-sm text-purple-500">contacts ciblés</p>
                                    </div>

                                    <div className="flex gap-3">
                                        <button onClick={() => setStep(2)} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg">
                                            ← Retour
                                        </button>
                                        <button
                                            onClick={() => setStep(4)}
                                            className="flex-1 px-4 py-3 bg-[#128C7E] text-white font-semibold rounded-lg"
                                        >
                                            Suivant →
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Step 4: Confirm */}
                            {step === 4 && (
                                <div className="space-y-4">
                                    <h2 className="text-xl font-bold text-gray-900 text-center">🚀 Confirmer la campagne</h2>

                                    <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                                        <p><span className="font-semibold">Nom:</span> {newCampaign.name}</p>
                                        <p><span className="font-semibold">Template:</span> {templates.find(t => t.id === newCampaign.template_id)?.name}</p>
                                        <p><span className="font-semibold">Contacts ciblés:</span> {previewCount !== null ? previewCount : 'Tous'}</p>
                                        {selectedTags.length > 0 && (
                                            <p><span className="font-semibold">Tags:</span> {selectedTags.join(', ')}</p>
                                        )}
                                        {selectedLocation && (
                                            <p><span className="font-semibold">Localisation:</span> {selectedLocation}</p>
                                        )}
                                    </div>

                                    <p className="text-sm text-gray-500 text-center">
                                        La campagne sera créée en brouillon. Vous pourrez la lancer depuis la liste.
                                    </p>

                                    <div className="flex gap-3">
                                        <button onClick={() => setStep(3)} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg">
                                            ← Retour
                                        </button>
                                        <button
                                            onClick={handleCreate}
                                            disabled={saving}
                                            className="flex-1 px-4 py-3 bg-[#128C7E] text-white font-semibold rounded-lg disabled:opacity-50"
                                        >
                                            {saving ? 'Création...' : 'Créer la campagne'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Schedule Campaign Modal */}
            {schedulingCampaignId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-900 text-center mb-6">⏰ Programmer la campagne</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                                <input
                                    type="date"
                                    value={scheduledDate}
                                    onChange={(e) => setScheduledDate(e.target.value)}
                                    min={new Date().toISOString().split('T')[0]}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Heure</label>
                                <input
                                    type="time"
                                    value={scheduledTime}
                                    onChange={(e) => setScheduledTime(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Récurrence</label>
                                <select
                                    value={recurrenceType}
                                    onChange={(e) => setRecurrenceType(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                                >
                                    <option value="none">📋 Une seule fois</option>
                                    <option value="daily">🔄 Tous les jours</option>
                                    <option value="weekly">📆 Toutes les semaines</option>
                                    <option value="monthly">🗓️ Tous les mois</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setSchedulingCampaignId(null)}
                                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg"
                            >
                                Annuler
                            </button>
                            <button
                                onClick={() => {
                                    if (schedulingCampaignId && scheduledDate && scheduledTime) {
                                        handleSchedule(schedulingCampaignId, scheduledDate, scheduledTime)
                                        setSchedulingCampaignId(null)
                                    }
                                }}
                                disabled={!scheduledDate || !scheduledTime || scheduling !== null}
                                className="flex-1 px-4 py-3 bg-purple-500 text-white font-semibold rounded-lg disabled:opacity-50"
                            >
                                {scheduling ? 'Programmation...' : 'Confirmer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Campaign Detail Modal with Analytics */}
            {showDetailModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="p-5 border-b bg-gradient-to-r from-[#128C7E] to-emerald-600">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                        <span className="text-xl">📊</span>
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-white text-lg">
                                            {loadingDetail ? 'Chargement...' : selectedCampaign?.name}
                                        </h3>
                                        <p className="text-white/80 text-sm">
                                            Statistiques détaillées de la campagne
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setShowDetailModal(false); setSelectedCampaign(null) }}
                                    className="text-white/80 hover:text-white"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
                            {loadingDetail ? (
                                <div className="text-center py-8 text-gray-400">Chargement des statistiques...</div>
                            ) : selectedCampaign ? (
                                <>
                                    {/* KPI Cards */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-gradient-to-br from-[#128C7E]/10 to-emerald-50 rounded-xl p-4 border border-[#128C7E]/20">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-lg">📨</span>
                                                <span className="text-xs font-medium text-gray-500">Livraison</span>
                                            </div>
                                            <p className="text-2xl font-bold text-[#128C7E]">{selectedCampaign.analytics.deliveryRate}%</p>
                                            <p className="text-xs text-gray-400">{selectedCampaign.analytics.delivered} / {selectedCampaign.total_sent}</p>
                                        </div>

                                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-lg">👁️</span>
                                                <span className="text-xs font-medium text-gray-500">Ouverture</span>
                                            </div>
                                            <p className="text-2xl font-bold text-blue-600">{selectedCampaign.analytics.openRate}%</p>
                                            <p className="text-xs text-gray-400">{selectedCampaign.read_count || 0} lus</p>
                                        </div>

                                        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-200">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-lg">💬</span>
                                                <span className="text-xs font-medium text-gray-500">Réponses</span>
                                            </div>
                                            <p className="text-2xl font-bold text-purple-600">{selectedCampaign.analytics.responseRate}%</p>
                                            <p className="text-xs text-gray-400">{selectedCampaign.response_count || 0} réponses</p>
                                        </div>

                                        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-lg">🎯</span>
                                                <span className="text-xs font-medium text-gray-500">Conversion</span>
                                            </div>
                                            <p className="text-2xl font-bold text-amber-600">{selectedCampaign.analytics.conversionRate}%</p>
                                            <p className="text-xs text-gray-400">{selectedCampaign.conversion_count || 0} conversions</p>
                                        </div>
                                    </div>

                                    {/* Summary Stats */}
                                    <div className="bg-gray-50 rounded-xl p-4">
                                        <h4 className="font-semibold text-gray-800 mb-3">📋 Résumé</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div>
                                                <p className="text-gray-500">Contacts ciblés</p>
                                                <p className="font-bold text-gray-800">{selectedCampaign.total_contacts}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500">Messages envoyés</p>
                                                <p className="font-bold text-green-600">{selectedCampaign.total_sent}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500">Échecs</p>
                                                <p className="font-bold text-red-600">{selectedCampaign.total_failed}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500">Créée le</p>
                                                <p className="font-bold text-gray-800">{new Date(selectedCampaign.created_at).toLocaleDateString('fr-FR')}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* A/B Variants if available */}
                                    {selectedCampaign.variants && selectedCampaign.variants.length > 0 && (
                                        <div className="bg-gray-50 rounded-xl p-4">
                                            <h4 className="font-semibold text-gray-800 mb-3">🧪 Performance A/B</h4>
                                            <div className="space-y-3">
                                                {selectedCampaign.variants.map(v => (
                                                    <div key={v.variant_letter} className="flex items-center justify-between bg-white rounded-lg p-3 border">
                                                        <div className="flex items-center gap-3">
                                                            <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${v.variant_letter === 'A' ? 'bg-blue-500' : 'bg-purple-500'}`}>
                                                                {v.variant_letter}
                                                            </span>
                                                            <div>
                                                                <p className="font-medium text-gray-800">{v.template_name}</p>
                                                                <p className="text-xs text-gray-500">{v.sent} envoyés • {v.failed} échecs</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="font-bold text-[#128C7E]">{v.delivery_rate}%</p>
                                                            <p className="text-xs text-gray-500">Livraison</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Recent Items */}
                                    {selectedCampaign.recent_items && selectedCampaign.recent_items.length > 0 && (
                                        <div className="bg-gray-50 rounded-xl p-4">
                                            <h4 className="font-semibold text-gray-800 mb-3">📱 Derniers envois</h4>
                                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                                {selectedCampaign.recent_items.slice(0, 10).map(item => (
                                                    <div key={item.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border text-sm">
                                                        <span className="font-mono text-gray-600">{item.phone}</span>
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.status === 'SENT' ? 'bg-green-100 text-green-700' :
                                                            item.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                                                                item.status === 'READ' ? 'bg-blue-100 text-blue-700' :
                                                                    'bg-gray-100 text-gray-600'
                                                            }`}>
                                                            {item.status}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : null}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t bg-gray-50">
                            <button
                                onClick={() => { setShowDetailModal(false); setSelectedCampaign(null) }}
                                className="w-full py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
                            >
                                Fermer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    )
}

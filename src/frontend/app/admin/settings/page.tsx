'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface EnvVariable {
    value: string
    masked: boolean
}

interface EnvData {
    variables: Record<string, EnvVariable>
    last_modified: string
}

// Configuration categories
const CONFIG_SECTIONS = [
    {
        id: 'general',
        title: '⚙️ Général',
        icon: '⚙️',
        keys: ['PORT', 'NODE_ENV', 'API_URL']
    },
    {
        id: 'database',
        title: '🗄️ Base de Données',
        icon: '🗄️',
        danger: true,
        keys: ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DATABASE_URL']
    },
    {
        id: 'whatsapp',
        title: '📱 Facebook / WhatsApp',
        icon: '📱',
        keys: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_CONFIG_ID', 'META_VERIFY_TOKEN', 'META_ACCESS_TOKEN', 'META_PHONE_ID', 'META_WABA_ID']
    },
    {
        id: 'payment',
        title: '💳 Paiement',
        icon: '💳',
        keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY']
    },
    {
        id: 'ai',
        title: '🤖 Intelligence Artificielle',
        icon: '🤖',
        keys: ['OPENAI_API_KEY', 'GEMINI_API_KEY']
    },
    {
        id: 'other',
        title: '📦 Autres',
        icon: '📦',
        keys: [] // Will contain uncategorized keys
    }
]

export default function SettingsPage() {
    const [envData, setEnvData] = useState<EnvData | null>(null)
    const [editedValues, setEditedValues] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState('whatsapp')
    const [showSuccess, setShowSuccess] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token')
        return fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        })
    }

    const fetchEnv = async () => {
        setLoading(true)
        try {
            const res = await authFetch(`${API_URL}/admin/env`)
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to fetch configuration')
            }
            const data = await res.json()
            setEnvData(data)

            // Initialize edited values
            const initial: Record<string, string> = {}
            for (const [key, val] of Object.entries(data.variables)) {
                initial[key] = (val as EnvVariable).value
            }
            setEditedValues(initial)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchEnv()
    }, [])

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        setShowSuccess(false)

        try {
            // Filter only changed values (and non-masked)
            const updates: Record<string, string> = {}
            for (const [key, value] of Object.entries(editedValues)) {
                if (!value.includes('****') && envData?.variables[key]?.value !== value) {
                    updates[key] = value
                }
            }

            if (Object.keys(updates).length === 0) {
                setError('Aucune modification à sauvegarder')
                setSaving(false)
                return
            }

            const res = await authFetch(`${API_URL}/admin/env`, {
                method: 'POST',
                body: JSON.stringify(updates)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to save configuration')
            }

            setShowSuccess(true)
            setTimeout(() => setShowSuccess(false), 10000)

            // Reload env data
            fetchEnv()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    const toggleReveal = async (key: string) => {
        if (revealedKeys.has(key)) {
            setRevealedKeys(prev => {
                const next = new Set(prev)
                next.delete(key)
                return next
            })
        } else {
            // Fetch revealed value
            try {
                const res = await authFetch(`${API_URL}/admin/env?reveal=true`)
                if (res.ok) {
                    const data = await res.json()
                    setEditedValues(prev => ({
                        ...prev,
                        [key]: data.variables[key]?.value || prev[key]
                    }))
                    setRevealedKeys(prev => new Set([...prev, key]))
                }
            } catch {
                // Ignore
            }
        }
    }

    const getKeysForSection = (section: typeof CONFIG_SECTIONS[0]) => {
        if (section.id === 'other') {
            // All keys not in other sections
            const allCategorizedKeys = CONFIG_SECTIONS
                .filter(s => s.id !== 'other')
                .flatMap(s => s.keys)
            return Object.keys(editedValues).filter(k => !allCategorizedKeys.includes(k))
        }
        return section.keys.filter(k => k in editedValues)
    }

    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#128C7E]"></div>
                </div>
            </DashboardLayout>
        )
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">⚙️ Configuration Système</h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Gérer les variables d'environnement du serveur
                        </p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`px-6 py-2.5 rounded-lg text-white font-medium flex items-center gap-2 transition-all ${saving ? 'bg-gray-400' : 'bg-[#128C7E] hover:bg-[#075E54]'
                            }`}
                    >
                        {saving ? (
                            <>
                                <span className="animate-spin">⏳</span>
                                Sauvegarde...
                            </>
                        ) : (
                            <>
                                💾 Sauvegarder
                            </>
                        )}
                    </button>
                </div>

                {/* Success Banner */}
                {showSuccess && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
                        <span className="text-2xl">⚠️</span>
                        <div>
                            <p className="font-medium text-amber-800">Configuration sauvegardée</p>
                            <p className="text-sm text-amber-600">
                                Les modifications nécessitent un <strong>redémarrage du serveur</strong> pour prendre effet.
                            </p>
                        </div>
                    </div>
                )}

                {/* Error Banner */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
                        <span className="text-2xl">❌</span>
                        <p className="text-red-700">{error}</p>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-2 flex-wrap border-b border-gray-200 pb-2">
                    {CONFIG_SECTIONS.map(section => {
                        const keys = getKeysForSection(section)
                        if (keys.length === 0 && section.id !== 'other') return null

                        return (
                            <button
                                key={section.id}
                                onClick={() => setActiveTab(section.id)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === section.id
                                        ? 'bg-[#128C7E] text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    } ${section.danger ? 'border-2 border-red-200' : ''}`}
                            >
                                {section.title}
                                <span className="ml-2 text-xs opacity-70">({keys.length})</span>
                            </button>
                        )
                    })}
                </div>

                {/* Active Section Content */}
                {CONFIG_SECTIONS.map(section => {
                    if (section.id !== activeTab) return null
                    const keys = getKeysForSection(section)

                    return (
                        <div key={section.id} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="text-3xl">{section.icon}</span>
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
                                    {section.danger && (
                                        <p className="text-xs text-red-600">⚠️ Zone sensible - Modifier avec précaution</p>
                                    )}
                                </div>
                            </div>

                            {keys.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">Aucune variable dans cette catégorie</p>
                            ) : (
                                <div className="space-y-4">
                                    {keys.map(key => {
                                        const isMasked = envData?.variables[key]?.masked && !revealedKeys.has(key)

                                        return (
                                            <div key={key} className="flex items-center gap-4">
                                                <label className="w-1/3 text-sm font-mono text-gray-700 truncate" title={key}>
                                                    {key}
                                                </label>
                                                <div className="flex-1 flex gap-2">
                                                    <input
                                                        type={isMasked ? 'password' : 'text'}
                                                        value={editedValues[key] || ''}
                                                        onChange={(e) => setEditedValues(prev => ({
                                                            ...prev,
                                                            [key]: e.target.value
                                                        }))}
                                                        placeholder="(non défini)"
                                                        className={`flex-1 px-4 py-2 border rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#128C7E]/20 focus:border-[#128C7E] ${section.danger ? 'border-red-200' : 'border-gray-200'
                                                            }`}
                                                    />
                                                    {envData?.variables[key]?.masked && (
                                                        <button
                                                            onClick={() => toggleReveal(key)}
                                                            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 bg-gray-100 rounded-lg"
                                                            title={isMasked ? 'Afficher' : 'Masquer'}
                                                        >
                                                            {isMasked ? '👁️' : '🔒'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Add new variable */}
                            {section.id === 'other' && (
                                <div className="mt-6 pt-6 border-t border-gray-100">
                                    <p className="text-xs text-gray-400 mb-2">
                                        💡 Pour ajouter une nouvelle variable, modifiez directement le fichier .env
                                    </p>
                                </div>
                            )}
                        </div>
                    )
                })}

                {/* Last Modified Info */}
                {envData?.last_modified && (
                    <p className="text-xs text-gray-400 text-right">
                        Dernière modification : {new Date(envData.last_modified).toLocaleString('fr-FR')}
                    </p>
                )}
            </div>
        </DashboardLayout>
    )
}

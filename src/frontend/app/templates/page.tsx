'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// ============================================
// TYPES
// ============================================
interface Template {
    id: string
    name: string
    language: string
    meta_status: string
    body_text: string
    variables_count: number
    wa_template_id?: string
}

// ============================================
// API URL
// ============================================
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

// ============================================
// MAIN COMPONENT
// ============================================
export default function TemplatesPage() {
    const router = useRouter()
    const [templates, setTemplates] = useState<Template[]>([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [syncMessage, setSyncMessage] = useState<string | null>(null)

    // ============================================
    // AUTH CHECK
    // ============================================
    useEffect(() => {
        const token = localStorage.getItem('token')
        if (!token) {
            router.push('/login')
        }
    }, [router])

    // Helper for authenticated requests
    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token')
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
            },
        })
    }

    // ============================================
    // FETCH TEMPLATES
    // ============================================
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const res = await authFetch(`${API_URL}/templates`)
                if (res.ok) {
                    const data = await res.json()
                    setTemplates(data)
                }
            } catch (err) {
                console.error('Failed to fetch templates:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchTemplates()
    }, [])

    // ============================================
    // SYNC TEMPLATES
    // ============================================
    const handleSync = async () => {
        setSyncing(true)
        setSyncMessage(null)
        try {
            const res = await authFetch(`${API_URL}/templates/sync`, {
                method: 'POST',
            })

            if (res.ok) {
                const data = await res.json()
                setTemplates(data.templates)
                setSyncMessage(data.message)
            } else {
                const error = await res.json()
                setSyncMessage(`Erreur: ${error.error}`)
            }
        } catch (err) {
            console.error('Failed to sync templates:', err)
            setSyncMessage('Erreur de connexion')
        } finally {
            setSyncing(false)
        }
    }

    // ============================================
    // GET STATUS BADGE
    // ============================================
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'APPROVED':
                return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Approuvé</span>
            case 'REJECTED':
                return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Rejeté</span>
            case 'PENDING':
                return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">En attente</span>
            case 'IN_APPEAL':
                return <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">En appel</span>
            default:
                return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">{status}</span>
        }
    }

    // ============================================
    // RENDER
    // ============================================
    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <header className="bg-gradient-to-r from-[#075E54] to-[#128C7E] text-white shadow-lg">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.push('/')}
                                className="text-white/80 hover:text-white transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                </svg>
                            </button>
                            <h1 className="text-xl font-bold">📋 Gestion des Templates</h1>
                        </div>
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${syncing
                                    ? 'bg-white/20 cursor-not-allowed'
                                    : 'bg-white/20 hover:bg-white/30'
                                }`}
                        >
                            <svg
                                className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {syncing ? 'Synchronisation...' : 'Synchroniser depuis Meta'}
                        </button>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-7xl mx-auto px-4 py-6">
                {/* Sync Message */}
                {syncMessage && (
                    <div className={`mb-4 p-4 rounded-lg text-sm ${syncMessage.startsWith('Erreur')
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-green-50 text-green-700 border border-green-200'
                        }`}>
                        {syncMessage}
                    </div>
                )}

                {/* Loading State */}
                {loading ? (
                    <div className="text-center py-12">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#128C7E]"></div>
                        <p className="mt-2 text-gray-500">Chargement des templates...</p>
                    </div>
                ) : templates.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                        <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h3 className="text-lg font-medium text-gray-700">Aucun template</h3>
                        <p className="text-gray-500 mt-1">Cliquez sur "Synchroniser depuis Meta" pour importer vos templates WhatsApp.</p>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {templates.map(tpl => (
                            <div
                                key={tpl.id}
                                className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 hover:shadow-md transition-shadow"
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <h3 className="font-semibold text-gray-800">{tpl.name}</h3>
                                        <p className="text-xs text-gray-400 mt-0.5">{tpl.language}</p>
                                    </div>
                                    {getStatusBadge(tpl.meta_status)}
                                </div>

                                {/* Body Preview */}
                                <div className="bg-gray-50 rounded-lg p-3 mb-3 min-h-[80px]">
                                    <p className="text-sm text-gray-600 leading-relaxed">
                                        {tpl.body_text || <span className="italic text-gray-400">Pas de contenu</span>}
                                    </p>
                                </div>

                                {/* Footer */}
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                    <div className="flex items-center gap-2">
                                        {tpl.variables_count > 0 && (
                                            <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                                                {tpl.variables_count} variable{tpl.variables_count > 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                    {tpl.wa_template_id && (
                                        <span className="font-mono text-[10px] text-gray-400">
                                            ID: {tpl.wa_template_id.slice(0, 8)}...
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Stats Footer */}
                {!loading && templates.length > 0 && (
                    <div className="mt-6 flex items-center justify-center gap-6 text-sm text-gray-500">
                        <span>
                            ✅ {templates.filter(t => t.meta_status === 'APPROVED').length} Approuvés
                        </span>
                        <span>
                            ⏳ {templates.filter(t => t.meta_status === 'PENDING').length} En attente
                        </span>
                        <span>
                            ❌ {templates.filter(t => t.meta_status === 'REJECTED').length} Rejetés
                        </span>
                    </div>
                )}
            </main>
        </div>
    )
}

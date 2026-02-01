'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

interface AutomationRule {
    id: string
    trigger_keyword: string
    response_text: string
    is_active: boolean
    created_at: string
}

export default function AutomationsPage() {
    const [rules, setRules] = useState<AutomationRule[]>([])
    const [loading, setLoading] = useState(true)
    const [triggerKeyword, setTriggerKeyword] = useState('')
    const [responseText, setResponseText] = useState('')
    const [status, setStatus] = useState({ type: '', message: '' })
    const [submitting, setSubmitting] = useState(false)

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

    useEffect(() => {
        fetchRules()
    }, [])

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

    const fetchRules = async () => {
        try {
            const res = await authFetch(`${API_URL}/automations`)
            if (res.ok) {
                const data = await res.json()
                setRules(data)
            }
        } catch (err) {
            console.error('Failed to fetch rules')
        } finally {
            setLoading(false)
        }
    }

    const handleCreateRule = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!triggerKeyword.trim() || !responseText.trim()) return

        setSubmitting(true)
        setStatus({ type: 'loading', message: 'Création de la règle...' })

        try {
            const res = await authFetch(`${API_URL}/automations`, {
                method: 'POST',
                body: JSON.stringify({
                    trigger_keyword: triggerKeyword.trim(),
                    response_text: responseText.trim()
                })
            })

            if (res.ok) {
                setStatus({ type: 'success', message: 'Règle créée avec succès !' })
                setTriggerKeyword('')
                setResponseText('')
                fetchRules()
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        } finally {
            setSubmitting(false)
        }
    }

    const handleDeleteRule = async (id: string) => {
        if (!confirm('Supprimer cette règle ?')) return

        try {
            const res = await authFetch(`${API_URL}/automations/${id}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                setStatus({ type: 'success', message: 'Règle supprimée' })
                fetchRules()
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        }
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Page Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">🤖 Automatisations</h1>
                    <p className="text-gray-500 mt-1">Créez des réponses automatiques basées sur des mots-clés</p>
                </div>

                {/* Status Bar */}
                {status.message && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                            status.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                                'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                        <div className="flex-1 text-sm font-medium">{status.message}</div>
                        <button onClick={() => setStatus({ type: '', message: '' })} className="hover:opacity-75">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" /></svg>
                        </button>
                    </div>
                )}

                {/* Create Form */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-[#128C7E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Nouvelle Règle
                    </h2>
                    <form onSubmit={handleCreateRule} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                                    Si le message contient...
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ex: menu, prix, horaires"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                    value={triggerKeyword}
                                    onChange={(e) => setTriggerKeyword(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                                    Répondre automatiquement...
                                </label>
                                <textarea
                                    required
                                    placeholder="Ex: Voici notre menu du jour..."
                                    rows={1}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm resize-none"
                                    value={responseText}
                                    onChange={(e) => setResponseText(e.target.value)}
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-all active:scale-[0.98]"
                        >
                            {submitting ? 'Création...' : 'Ajouter la règle'}
                        </button>
                    </form>
                </div>

                {/* Rules List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                        <h2 className="font-bold text-gray-700 flex items-center gap-2">
                            <svg className="w-5 h-5 text-[#128C7E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            Règles Actives
                        </h2>
                        <span className="text-xs font-bold bg-[#128C7E] text-white px-2 py-1 rounded-full">
                            {rules.length} règle{rules.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-widest font-bold">
                                    <th className="px-6 py-4">Mot-clé</th>
                                    <th className="px-6 py-4">Réponse</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {loading ? (
                                    <tr><td colSpan={3} className="p-8 text-center text-gray-400">Chargement...</td></tr>
                                ) : rules.length === 0 ? (
                                    <tr><td colSpan={3} className="p-8 text-center text-gray-400">Aucune règle d'automatisation</td></tr>
                                ) : (
                                    rules.map(rule => (
                                        <tr key={rule.id} className="hover:bg-blue-50/50 transition-colors group">
                                            <td className="px-6 py-4">
                                                <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-mono text-xs">
                                                    {rule.trigger_keyword}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-600 max-w-md truncate">
                                                {rule.response_text}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => handleDeleteRule(rule.id)}
                                                    className="text-red-400 hover:text-red-600 transition-colors p-2"
                                                    title="Supprimer"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    )
}

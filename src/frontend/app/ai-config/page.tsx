'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

interface AIConfig {
    id?: string
    is_active: boolean
    system_prompt: string | null
    system_instructions: string | null
    persona_style: 'PROFESSIONAL' | 'FRIENDLY' | 'EMPATHETIC' | 'FUNNY'
    emoji_usage: boolean
    creativity_level: number
    provider: 'GEMINI' | 'OPENAI'
    model: string
    has_api_key: boolean
}

interface KnowledgeDoc {
    id: number
    source_name: string
    content: string
    type?: 'TEXT' | 'WEB' | 'VIDEO'
    is_active: boolean
    created_at: string
}

const PROVIDER_OPTIONS = [
    { value: 'GEMINI', label: 'Google Gemini (Recommandé)', models: ['gemini-2.0-flash', 'gemini-pro'] },
    { value: 'OPENAI', label: 'OpenAI (GPT-3.5/4)', models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'] }
]

const PERSONA_STYLES = [
    { value: 'PROFESSIONAL', emoji: '👔', label: 'Professionnel', desc: 'Vouvoiement, formel et précis' },
    { value: 'FRIENDLY', emoji: '🤝', label: 'Amical', desc: 'Tutoiement respectueux, chaleureux' },
    { value: 'EMPATHETIC', emoji: '🥰', label: 'Empathique', desc: 'Service client, rassurant' },
    { value: 'FUNNY', emoji: '🤪', label: 'Décalé', desc: 'Humour léger, fun' }
]

export default function AIConfigPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [config, setConfig] = useState<AIConfig>({
        is_active: false,
        system_prompt: '',
        system_instructions: '',
        persona_style: 'FRIENDLY',
        emoji_usage: true,
        creativity_level: 0.7,
        provider: 'GEMINI',
        model: 'gemini-2.0-flash',
        has_api_key: false
    })
    const [apiKey, setApiKey] = useState('')
    const [status, setStatus] = useState({ type: '', message: '' })

    // Knowledge Base state
    const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([])
    const [showAddModal, setShowAddModal] = useState(false)
    const [newDocName, setNewDocName] = useState('')
    const [newDocContent, setNewDocContent] = useState('')
    const [savingDoc, setSavingDoc] = useState(false)
    const [editingDoc, setEditingDoc] = useState<KnowledgeDoc | null>(null)

    // Import modals state
    const [showWebImportModal, setShowWebImportModal] = useState(false)
    const [showYoutubeImportModal, setShowYoutubeImportModal] = useState(false)
    const [importUrl, setImportUrl] = useState('')
    const [importing, setImporting] = useState(false)

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
        fetchConfig()
        fetchKnowledgeDocs()
    }, [])

    const fetchConfig = async () => {
        try {
            const res = await authFetch(`${API_URL}/ai-config`)
            if (res.ok) {
                const data = await res.json()
                setConfig(data)
            }
        } catch (err) {
            console.error('Failed to fetch AI config')
        } finally {
            setLoading(false)
        }
    }

    const fetchKnowledgeDocs = async () => {
        try {
            const res = await authFetch(`${API_URL}/ai/knowledge`)
            if (res.ok) {
                const data = await res.json()
                setKnowledgeDocs(data)
            }
        } catch (err) {
            console.error('Failed to fetch knowledge docs')
        }
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        setStatus({ type: 'loading', message: 'Sauvegarde en cours...' })

        try {
            const res = await authFetch(`${API_URL}/ai-config`, {
                method: 'POST',
                body: JSON.stringify({
                    is_active: config.is_active,
                    system_prompt: config.system_prompt,
                    system_instructions: config.system_instructions,
                    persona_style: config.persona_style,
                    emoji_usage: config.emoji_usage,
                    creativity_level: config.creativity_level,
                    provider: config.provider,
                    model: config.model,
                    api_key: apiKey || undefined
                })
            })

            if (res.ok) {
                const data = await res.json()
                setConfig(data)
                setApiKey('')
                setStatus({ type: 'success', message: 'Configuration IA sauvegardée !' })
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

    const handleAddDoc = async () => {
        if (!newDocContent.trim()) return
        setSavingDoc(true)

        try {
            const res = await authFetch(`${API_URL}/ai/knowledge`, {
                method: 'POST',
                body: JSON.stringify({
                    source_name: newDocName || 'Document',
                    content: newDocContent
                })
            })

            if (res.ok) {
                await fetchKnowledgeDocs()
                setNewDocName('')
                setNewDocContent('')
                setShowAddModal(false)
                setStatus({ type: 'success', message: 'Source ajoutée au cerveau !' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur ajout source' })
        } finally {
            setSavingDoc(false)
        }
    }

    const handleImportWeb = async () => {
        if (!importUrl.trim()) return
        setImporting(true)
        setStatus({ type: 'loading', message: '🌐 Extraction du contenu web...' })

        try {
            const res = await authFetch(`${API_URL}/ai/knowledge/import-web`, {
                method: 'POST',
                body: JSON.stringify({ url: importUrl })
            })

            if (res.ok) {
                await fetchKnowledgeDocs()
                setImportUrl('')
                setShowWebImportModal(false)
                setStatus({ type: 'success', message: '✅ Page web importée dans le cerveau !' })
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error || 'Erreur import web' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        } finally {
            setImporting(false)
        }
    }

    const handleImportYoutube = async () => {
        if (!importUrl.trim()) return
        setImporting(true)
        setStatus({ type: 'loading', message: '🎬 Extraction des sous-titres YouTube...' })

        try {
            const res = await authFetch(`${API_URL}/ai/knowledge/import-youtube`, {
                method: 'POST',
                body: JSON.stringify({ url: importUrl })
            })

            if (res.ok) {
                await fetchKnowledgeDocs()
                setImportUrl('')
                setShowYoutubeImportModal(false)
                setStatus({ type: 'success', message: '✅ Transcription YouTube importée !' })
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error || 'Erreur import YouTube' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        } finally {
            setImporting(false)
        }
    }

    const handleDeleteDoc = async (id: number) => {
        if (!confirm('Supprimer cette source ?')) return

        try {
            const res = await authFetch(`${API_URL}/ai/knowledge/${id}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                await fetchKnowledgeDocs()
                setStatus({ type: 'success', message: 'Source supprimée' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur suppression' })
        }
    }

    const handleToggleDoc = async (doc: KnowledgeDoc) => {
        try {
            const res = await authFetch(`${API_URL}/ai/knowledge/${doc.id}`, {
                method: 'PUT',
                body: JSON.stringify({ is_active: !doc.is_active })
            })

            if (res.ok) {
                await fetchKnowledgeDocs()
            }
        } catch (err) {
            console.error('Failed to toggle doc')
        }
    }

    const handleUpdateDoc = async () => {
        if (!editingDoc) return
        setSavingDoc(true)

        try {
            const res = await authFetch(`${API_URL}/ai/knowledge/${editingDoc.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    source_name: editingDoc.source_name,
                    content: editingDoc.content
                })
            })

            if (res.ok) {
                await fetchKnowledgeDocs()
                setEditingDoc(null)
                setStatus({ type: 'success', message: 'Source mise à jour !' })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur mise à jour' })
        } finally {
            setSavingDoc(false)
        }
    }

    const getDocTypeIcon = (type?: string) => {
        switch (type) {
            case 'WEB': return '🌐'
            case 'VIDEO': return '🎬'
            default: return '📄'
        }
    }

    const selectedProvider = PROVIDER_OPTIONS.find(p => p.value === config.provider)

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
                {/* Page Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">🧠 Entraînement IA</h1>
                    <p className="text-gray-500 mt-1">Personnalisez et entraînez votre assistant avec vos données métier</p>
                </div>

                {/* Status Bar */}
                {status.message && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                        status.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                            'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                        <span className="flex-1 text-sm font-medium">{status.message}</span>
                        <button onClick={() => setStatus({ type: '', message: '' })} className="hover:opacity-75">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Two Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* LEFT COLUMN: Personality & Settings */}
                    <div className="space-y-6">
                        <form onSubmit={handleSave} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-5 border-b bg-gradient-to-r from-purple-500 to-indigo-600">
                                <h2 className="font-semibold text-white flex items-center gap-2">
                                    <span className="text-xl">🎭</span> Personnalité du Bot
                                </h2>
                                <p className="text-white/80 text-sm mt-1">Définissez le caractère et le ton de votre assistant</p>
                            </div>

                            <div className="p-5 space-y-5">
                                {/* Active Toggle */}
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                    <div>
                                        <h3 className="font-semibold text-gray-800">Activer l'IA</h3>
                                        <p className="text-sm text-gray-500">Réponses automatiques intelligentes</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setConfig({ ...config, is_active: !config.is_active })}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.is_active ? 'bg-purple-600' : 'bg-gray-300'
                                            }`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.is_active ? 'translate-x-6' : 'translate-x-1'
                                            }`} />
                                    </button>
                                </div>

                                {/* Persona Style Selector */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-3">Style de communication</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {PERSONA_STYLES.map(style => (
                                            <button
                                                key={style.value}
                                                type="button"
                                                onClick={() => setConfig({ ...config, persona_style: style.value as any })}
                                                className={`p-3 rounded-lg border-2 text-left transition-all ${config.persona_style === style.value
                                                        ? 'border-purple-500 bg-purple-50'
                                                        : 'border-gray-200 hover:border-gray-300 bg-white'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xl">{style.emoji}</span>
                                                    <span className="font-semibold text-gray-800">{style.label}</span>
                                                </div>
                                                <p className="text-xs text-gray-500">{style.desc}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Emoji Toggle */}
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl">🍕</span>
                                        <div>
                                            <h3 className="font-semibold text-gray-800">Utiliser des émojis</h3>
                                            <p className="text-sm text-gray-500">Rend les réponses plus vivantes</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setConfig({ ...config, emoji_usage: !config.emoji_usage })}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.emoji_usage ? 'bg-purple-600' : 'bg-gray-300'
                                            }`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.emoji_usage ? 'translate-x-6' : 'translate-x-1'
                                            }`} />
                                    </button>
                                </div>

                                {/* Creativity Slider */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-sm font-semibold text-gray-700">Créativité</label>
                                        <span className="text-sm text-gray-500">{Math.round(config.creativity_level * 100)}%</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm text-gray-400">🤖 Rigide</span>
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.1"
                                            value={config.creativity_level}
                                            onChange={(e) => setConfig({ ...config, creativity_level: parseFloat(e.target.value) })}
                                            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                                        />
                                        <span className="text-sm text-gray-400">🎨 Créatif</span>
                                    </div>
                                </div>

                                {/* System Prompt */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Rôle du Bot</label>
                                    <textarea
                                        value={config.system_prompt || ''}
                                        onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
                                        rows={2}
                                        placeholder="Ex: Tu es l'assistant du Restaurant Le Gourmet..."
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-sm"
                                    />
                                </div>

                                {/* Provider & Model */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Modèle IA</label>
                                        <select
                                            value={config.provider}
                                            onChange={(e) => {
                                                const provider = e.target.value as 'GEMINI' | 'OPENAI'
                                                const defaultModel = PROVIDER_OPTIONS.find(p => p.value === provider)?.models[0] || ''
                                                setConfig({ ...config, provider, model: defaultModel })
                                            }}
                                            className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                        >
                                            {PROVIDER_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.value}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Version</label>
                                        <select
                                            value={config.model}
                                            onChange={(e) => setConfig({ ...config, model: e.target.value })}
                                            className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                        >
                                            {selectedProvider?.models.map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* API Key */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Clé API {config.provider}
                                        {config.has_api_key && <span className="ml-2 text-green-600 text-xs">✓ Configurée</span>}
                                    </label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder={config.has_api_key ? '••••••••' : 'Entrez votre clé API'}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>

                                {/* Save Button */}
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className={`w-full py-3 rounded-lg font-bold text-white transition-all ${saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 active:scale-[0.98]'
                                        }`}
                                >
                                    {saving ? 'Sauvegarde...' : '💾 Sauvegarder la personnalité'}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* RIGHT COLUMN: Knowledge Base */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-5 border-b bg-gradient-to-r from-[#128C7E] to-emerald-600">
                            <h2 className="font-semibold text-white flex items-center gap-2">
                                <span className="text-xl">📚</span> Base de Connaissance
                            </h2>
                            <p className="text-white/80 text-sm mt-1">Le "cerveau" de votre bot - ajoutez vos infos métier</p>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Info Banner */}
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                                <p className="text-sm text-emerald-800">
                                    <strong>💡 Plus vous donnez d'infos ici, plus le bot sera intelligent !</strong><br />
                                    Ajoutez menus, tarifs, horaires, FAQ, conditions... L'IA les utilisera pour répondre précisément.
                                </p>
                            </div>

                            {/* Import Actions */}
                            <div className="grid grid-cols-3 gap-3">
                                {/* Add Text Source */}
                                <button
                                    onClick={() => setShowAddModal(true)}
                                    className="py-3 px-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-[#128C7E] hover:text-[#128C7E] transition-colors flex flex-col items-center gap-1"
                                >
                                    <span className="text-xl">📝</span>
                                    <span className="text-xs font-medium">Texte</span>
                                </button>

                                {/* Import Web */}
                                <button
                                    onClick={() => setShowWebImportModal(true)}
                                    className="py-3 px-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors flex flex-col items-center gap-1"
                                >
                                    <span className="text-xl">🌐</span>
                                    <span className="text-xs font-medium">URL Web</span>
                                </button>

                                {/* Import YouTube */}
                                <button
                                    onClick={() => setShowYoutubeImportModal(true)}
                                    className="py-3 px-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-red-500 hover:text-red-600 transition-colors flex flex-col items-center gap-1"
                                >
                                    <span className="text-xl">🎬</span>
                                    <span className="text-xs font-medium">YouTube</span>
                                </button>
                            </div>

                            {/* Knowledge Docs List */}
                            <div className="space-y-3 max-h-[350px] overflow-y-auto">
                                {knowledgeDocs.length === 0 ? (
                                    <div className="text-center py-8 text-gray-400">
                                        <span className="text-4xl block mb-2">📭</span>
                                        Aucune source ajoutée
                                    </div>
                                ) : (
                                    knowledgeDocs.map(doc => (
                                        <div key={doc.id} className={`border rounded-lg p-4 transition-all ${doc.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg">{getDocTypeIcon(doc.type)}</span>
                                                    <h4 className="font-semibold text-gray-800 truncate max-w-[180px]">{doc.source_name}</h4>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {/* Toggle Active */}
                                                    <button
                                                        onClick={() => handleToggleDoc(doc)}
                                                        className={`px-2 py-1 text-xs rounded ${doc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                                                    >
                                                        {doc.is_active ? 'Actif' : 'Inactif'}
                                                    </button>
                                                    {/* Edit */}
                                                    <button
                                                        onClick={() => setEditingDoc(doc)}
                                                        className="p-1 text-gray-400 hover:text-blue-600"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                        </svg>
                                                    </button>
                                                    {/* Delete */}
                                                    <button
                                                        onClick={() => handleDeleteDoc(doc.id)}
                                                        className="p-1 text-gray-400 hover:text-red-600"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-500 line-clamp-2">{doc.content}</p>
                                            <p className="text-xs text-gray-400 mt-2">
                                                Ajouté le {new Date(doc.created_at).toLocaleDateString('fr-FR')}
                                            </p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Add Text Source Modal */}
                {showAddModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                            <div className="p-5 border-b">
                                <h3 className="font-semibold text-gray-900 text-lg">📝 Ajouter une source texte</h3>
                                <p className="text-gray-500 text-sm mt-1">Copiez-collez vos informations métier</p>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Nom de la source</label>
                                    <input
                                        type="text"
                                        value={newDocName}
                                        onChange={(e) => setNewDocName(e.target.value)}
                                        placeholder="Ex: Menu, Tarifs, Horaires, FAQ..."
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Contenu</label>
                                    <textarea
                                        value={newDocContent}
                                        onChange={(e) => setNewDocContent(e.target.value)}
                                        rows={8}
                                        placeholder="Collez ici votre menu, vos tarifs..."
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] resize-none"
                                    />
                                </div>
                            </div>
                            <div className="p-4 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => { setShowAddModal(false); setNewDocName(''); setNewDocContent('') }}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleAddDoc}
                                    disabled={!newDocContent.trim() || savingDoc}
                                    className="flex-1 py-2.5 bg-[#128C7E] text-white font-medium rounded-lg hover:bg-[#0a6b5f] disabled:opacity-50"
                                >
                                    {savingDoc ? 'Ajout...' : '✓ Ajouter'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Import Web Modal */}
                {showWebImportModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                            <div className="p-5 border-b">
                                <h3 className="font-semibold text-gray-900 text-lg">🌐 Importer une page web</h3>
                                <p className="text-gray-500 text-sm mt-1">L'IA extraira automatiquement le contenu textuel</p>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">URL de la page</label>
                                    <input
                                        type="url"
                                        value={importUrl}
                                        onChange={(e) => setImportUrl(e.target.value)}
                                        placeholder="https://exemple.com/page-a-importer"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                    <p className="text-xs text-blue-700">
                                        💡 Fonctionne avec la plupart des pages web publiques. Le texte sera automatiquement nettoyé et formaté.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => { setShowWebImportModal(false); setImportUrl('') }}
                                    disabled={importing}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleImportWeb}
                                    disabled={!importUrl.trim() || importing}
                                    className="flex-1 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {importing ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                            Extraction...
                                        </>
                                    ) : '🌐 Importer'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Import YouTube Modal */}
                {showYoutubeImportModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                            <div className="p-5 border-b">
                                <h3 className="font-semibold text-gray-900 text-lg">🎬 Importer une vidéo YouTube</h3>
                                <p className="text-gray-500 text-sm mt-1">L'IA apprendra le contenu parlé de la vidéo</p>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">URL YouTube</label>
                                    <input
                                        type="url"
                                        value={importUrl}
                                        onChange={(e) => setImportUrl(e.target.value)}
                                        placeholder="https://www.youtube.com/watch?v=..."
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                </div>
                                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                    <p className="text-xs text-red-700">
                                        ⚠️ La vidéo doit avoir des sous-titres (automatiques ou manuels) pour que l'import fonctionne.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => { setShowYoutubeImportModal(false); setImportUrl('') }}
                                    disabled={importing}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleImportYoutube}
                                    disabled={!importUrl.trim() || importing}
                                    className="flex-1 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {importing ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                            Extraction...
                                        </>
                                    ) : '🎬 Importer'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Edit Source Modal */}
                {editingDoc && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                            <div className="p-5 border-b">
                                <h3 className="font-semibold text-gray-900 text-lg">✏️ Modifier la source</h3>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Nom</label>
                                    <input
                                        type="text"
                                        value={editingDoc.source_name}
                                        onChange={(e) => setEditingDoc({ ...editingDoc, source_name: e.target.value })}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Contenu</label>
                                    <textarea
                                        value={editingDoc.content}
                                        onChange={(e) => setEditingDoc({ ...editingDoc, content: e.target.value })}
                                        rows={10}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] resize-none"
                                    />
                                </div>
                            </div>
                            <div className="p-4 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => setEditingDoc(null)}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleUpdateDoc}
                                    disabled={savingDoc}
                                    className="flex-1 py-2.5 bg-[#128C7E] text-white font-medium rounded-lg hover:bg-[#0a6b5f] disabled:opacity-50"
                                >
                                    {savingDoc ? 'Sauvegarde...' : '✓ Sauvegarder'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    )
}

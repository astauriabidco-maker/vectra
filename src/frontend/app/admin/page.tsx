'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/Layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'

interface Tenant {
    id: string
    name: string
    created_at: string
}

export default function AdminPage() {
    const router = useRouter()
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [loading, setLoading] = useState(true)
    const [authLoading, setAuthLoading] = useState(true)

    // Forms state
    const [newTenantName, setNewTenantName] = useState('')
    const [newUserEmail, setNewUserEmail] = useState('')
    const [newUserPassword, setNewUserPassword] = useState('')
    const [newUserRole, setNewUserRole] = useState('AGENT')
    const [newUserTenantId, setNewUserTenantId] = useState('')

    // AI Config state
    const [selectedTenantForAi, setSelectedTenantForAi] = useState('')
    const [geminiApiKey, setGeminiApiKey] = useState('')
    const [aiConfigured, setAiConfigured] = useState(false)
    const [savingAiKey, setSavingAiKey] = useState(false)

    const [status, setStatus] = useState({ type: '', message: '' })

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

    // ============================================
    // AUTH CHECK
    // ============================================
    useEffect(() => {
        const token = localStorage.getItem('token')
        const role = localStorage.getItem('role')

        if (!token || role !== 'SUPER_ADMIN') {
            router.push('/')
            return
        }
        setAuthLoading(false)
        fetchTenants()
    }, [router])

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

    const fetchTenants = async () => {
        try {
            const res = await authFetch(`${API_URL}/admin/tenants`)
            if (res.ok) {
                const data = await res.json()
                setTenants(data)
                if (data.length > 0) setNewUserTenantId(data[0].id)
            }
        } catch (err) {
            console.error('Failed to fetch tenants')
        } finally {
            setLoading(false)
        }
    }

    const handleCreateTenant = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus({ type: 'loading', message: 'Création du tenant...' })
        try {
            const res = await authFetch(`${API_URL}/admin/tenants`, {
                method: 'POST',
                body: JSON.stringify({ name: newTenantName })
            })
            if (res.ok) {
                setStatus({ type: 'success', message: 'Tenant créé avec succès !' })
                setNewTenantName('')
                fetchTenants()
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        }
    }

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus({ type: 'loading', message: 'Création de l\'utilisateur...' })
        try {
            const res = await authFetch(`${API_URL}/admin/users`, {
                method: 'POST',
                body: JSON.stringify({
                    email: newUserEmail,
                    password: newUserPassword,
                    role: newUserRole,
                    tenant_id: newUserTenantId
                })
            })
            if (res.ok) {
                setStatus({ type: 'success', message: 'Utilisateur créé avec succès !' })
                setNewUserEmail('')
                setNewUserPassword('')
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        }
    }

    // Fetch tenant AI settings when a tenant is selected
    const fetchTenantSettings = async (tenantId: string) => {
        if (!tenantId) return
        setSelectedTenantForAi(tenantId)
        setGeminiApiKey('')
        try {
            const res = await authFetch(`${API_URL}/admin/tenants/${tenantId}/settings`)
            if (res.ok) {
                const data = await res.json()
                setAiConfigured(data.gemini_api_key_configured)
            }
        } catch (err) {
            console.error('Failed to fetch tenant settings')
        }
    }

    // Save Gemini API key
    const handleSaveAiKey = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedTenantForAi) return
        setSavingAiKey(true)
        setStatus({ type: 'loading', message: 'Sauvegarde de la clé API...' })
        try {
            const res = await authFetch(`${API_URL}/admin/tenants/${selectedTenantForAi}/settings`, {
                method: 'PATCH',
                body: JSON.stringify({ gemini_api_key: geminiApiKey })
            })
            if (res.ok) {
                setStatus({ type: 'success', message: 'Clé API Gemini sauvegardée !' })
                setGeminiApiKey('')
                setAiConfigured(true)
            } else {
                const data = await res.json()
                setStatus({ type: 'error', message: data.error })
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Erreur réseau' })
        } finally {
            setSavingAiKey(false)
        }
    }

    if (authLoading) return null

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Page Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">⚙️ Super Admin Dashboard</h1>
                    <p className="text-gray-500 mt-1">Gestion globale des clients et accès</p>
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

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                                <h2 className="font-bold text-gray-700 flex items-center gap-2">
                                    <svg className="w-5 h-5 text-[#128C7E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                    </svg>
                                    Liste des Clients (Tenants)
                                </h2>
                                <span className="text-xs font-bold bg-[#128C7E] text-white px-2 py-1 rounded-full">{tenants.length} total</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-widest font-bold">
                                            <th className="px-6 py-4">Nom de l'entreprise</th>
                                            <th className="px-6 py-4">ID</th>
                                            <th className="px-6 py-4">Date de création</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {loading ? (
                                            <tr><td colSpan={3} className="p-8 text-center text-gray-400">Chargement...</td></tr>
                                        ) : tenants.length === 0 ? (
                                            <tr><td colSpan={3} className="p-8 text-center text-gray-400">Aucun tenant trouvé</td></tr>
                                        ) : (
                                            tenants.map(t => (
                                                <tr key={t.id} className="hover:bg-blue-50/50 transition-colors group">
                                                    <td className="px-6 py-4 font-semibold text-gray-800">{t.name}</td>
                                                    <td className="px-6 py-4 font-mono text-xs text-gray-400">{t.id}</td>
                                                    <td className="px-6 py-4 text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Section Formulaires */}
                    <div className="space-y-8">
                        {/* Form Tenant */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                </div>
                                Nouveau Client (Entreprise)
                            </h3>
                            <form onSubmit={handleCreateTenant} className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Nom de l'entreprise</label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                        placeholder="Ex: Acme Inc"
                                        value={newTenantName}
                                        onChange={(e) => setNewTenantName(e.target.value)}
                                    />
                                </div>
                                <button className="w-full bg-[#128C7E] hover:bg-[#075E54] text-white font-bold py-3 rounded-lg shadow-md transition-all active:scale-[0.98]">
                                    Créer le Tenant
                                </button>
                            </form>
                        </div>

                        {/* Form User */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                                </div>
                                Nouvel Utilisateur
                            </h3>
                            <form onSubmit={handleCreateUser} className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Email</label>
                                    <input
                                        type="email"
                                        required
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                        placeholder="admin@client.com"
                                        value={newUserEmail}
                                        onChange={(e) => setNewUserEmail(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Mot de passe</label>
                                    <input
                                        type="password"
                                        required
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                        placeholder="••••••••"
                                        value={newUserPassword}
                                        onChange={(e) => setNewUserPassword(e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Rôle</label>
                                        <select
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                            value={newUserRole}
                                            onChange={(e) => setNewUserRole(e.target.value)}
                                        >
                                            <option value="AGENT">Agent</option>
                                            <option value="ADMIN">Admin</option>
                                            <option value="SUPER_ADMIN">Super Admin</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Entreprise</label>
                                        <select
                                            required
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                            value={newUserTenantId}
                                            onChange={(e) => setNewUserTenantId(e.target.value)}
                                        >
                                            {tenants.map(t => (
                                                <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <button className="w-full bg-[#128C7E] hover:bg-[#075E54] text-white font-bold py-3 rounded-lg shadow-md transition-all active:scale-[0.98]">
                                    Créer l'Utilisateur
                                </button>
                            </form>
                        </div>

                        {/* Form AI Config */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                </div>
                                Configuration IA (Gemini)
                            </h3>
                            <form onSubmit={handleSaveAiKey} className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Entreprise</label>
                                    <select
                                        required
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                        value={selectedTenantForAi}
                                        onChange={(e) => fetchTenantSettings(e.target.value)}
                                    >
                                        <option value="">Sélectionner une entreprise</option>
                                        {tenants.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                                {selectedTenantForAi && (
                                    <>
                                        <div className={`text-xs px-3 py-2 rounded-lg ${aiConfigured ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                                            {aiConfigured ? '✓ Clé API configurée' : '⚠ Aucune clé API configurée'}
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">
                                                {aiConfigured ? 'Nouvelle clé API Gemini' : 'Clé API Gemini'}
                                            </label>
                                            <input
                                                type="password"
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#128C7E] transition-all text-sm"
                                                placeholder="AIza..."
                                                value={geminiApiKey}
                                                onChange={(e) => setGeminiApiKey(e.target.value)}
                                            />
                                            <p className="text-[10px] text-gray-400 mt-1 ml-1">
                                                Obtenir une clé: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">aistudio.google.com</a>
                                            </p>
                                        </div>
                                        <button
                                            disabled={!geminiApiKey.trim() || savingAiKey}
                                            className={`w-full font-bold py-3 rounded-lg shadow-md transition-all active:scale-[0.98] ${!geminiApiKey.trim() || savingAiKey ? 'bg-gray-300 cursor-not-allowed text-gray-500' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
                                        >
                                            {savingAiKey ? 'Sauvegarde...' : 'Sauvegarder la clé API'}
                                        </button>
                                    </>
                                )}
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    )
}

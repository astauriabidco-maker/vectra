'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Contact {
    id: string
    phone: string
    name: string | null
    email: string | null
    tags: string[]
    opted_out: boolean
    created_at: string
}

export default function ContactsPage() {
    const [contacts, setContacts] = useState<Contact[]>([])
    const [loading, setLoading] = useState(true)
    const [total, setTotal] = useState(0)
    const [search, setSearch] = useState('')
    const [showModal, setShowModal] = useState(false)
    const [newContact, setNewContact] = useState({ phone: '', name: '' })
    const [saving, setSaving] = useState(false)
    const [importing, setImporting] = useState(false)

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

    // Load contacts
    const fetchContacts = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (search) params.append('search', search)

            const res = await authFetch(`${API_URL}/contacts?${params.toString()}`)
            if (res.ok) {
                const data = await res.json()
                setContacts(data.contacts || [])
                setTotal(data.total || 0)
            }
        } catch (err) {
            console.error('Failed to fetch contacts')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchContacts() }, [])

    useEffect(() => {
        const timer = setTimeout(fetchContacts, 300)
        return () => clearTimeout(timer)
    }, [search])

    // Import from conversations
    const handleImport = async () => {
        setImporting(true)
        try {
            const res = await authFetch(`${API_URL}/contacts/import`, { method: 'POST' })
            const data = await res.json()
            if (res.ok) {
                alert(`✅ ${data.message}`)
                fetchContacts()
            } else {
                alert(`❌ ${data.error}`)
            }
        } catch (err) {
            alert('❌ Erreur lors de l\'importation')
        } finally {
            setImporting(false)
        }
    }

    // Add contact
    const handleAddContact = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newContact.phone) return

        setSaving(true)
        try {
            const res = await authFetch(`${API_URL}/contacts`, {
                method: 'POST',
                body: JSON.stringify(newContact)
            })
            if (res.ok) {
                fetchContacts()
                setNewContact({ phone: '', name: '' })
                setShowModal(false)
            }
        } catch (err) {
            console.error('Failed to add contact')
        } finally {
            setSaving(false)
        }
    }

    // Delete contact
    const handleDelete = async (id: string) => {
        if (!confirm('Supprimer ce contact ?')) return

        try {
            const res = await authFetch(`${API_URL}/contacts/${id}`, {
                method: 'DELETE'
            })
            if (res.ok) fetchContacts()
        } catch (err) {
            console.error('Failed to delete contact')
        }
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">📇 Contacts CRM</h1>
                        <p className="text-gray-500 mt-1">{total} contact(s) dans votre base</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={handleImport}
                            disabled={importing}
                            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-lg flex items-center gap-2 transition-colors hover:bg-gray-50 disabled:opacity-50"
                        >
                            {importing ? (
                                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            ) : (
                                <span>📥</span>
                            )}
                            Importer depuis discussions
                        </button>
                        <button
                            onClick={() => setShowModal(true)}
                            className="px-4 py-2 bg-[#128C7E] hover:bg-[#075E54] text-white font-semibold rounded-lg flex items-center gap-2 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Ajouter Contact
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center gap-4">
                        <input
                            type="text"
                            placeholder="🔍 Rechercher par nom ou téléphone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                        />
                        <div className="flex items-center gap-2">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                                <span className="text-xl">👥</span>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-gray-900">{total}</p>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Contacts Table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-widest font-bold">
                                <th className="px-6 py-4">Téléphone</th>
                                <th className="px-6 py-4">Nom</th>
                                <th className="px-6 py-4">Ajouté le</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Chargement...</td></tr>
                            ) : contacts.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Aucun contact. Ajoutez-en un !</td></tr>
                            ) : (
                                contacts.map(contact => (
                                    <tr key={contact.id} className="hover:bg-blue-50/50 transition-colors">
                                        <td className="px-6 py-4 font-mono text-gray-800">{contact.phone}</td>
                                        <td className="px-6 py-4 text-gray-600">{contact.name || '—'}</td>
                                        <td className="px-6 py-4 text-gray-500">{new Date(contact.created_at).toLocaleDateString()}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => handleDelete(contact.id)}
                                                className="text-red-500 hover:text-red-700 transition-colors"
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

                {/* Add Contact Modal */}
                {showModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">Ajouter un contact</h2>
                            <form onSubmit={handleAddContact} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Numéro de téléphone *</label>
                                    <input
                                        type="tel"
                                        required
                                        placeholder="+237 6XX XXX XXX"
                                        value={newContact.phone}
                                        onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom (optionnel)</label>
                                    <input
                                        type="text"
                                        placeholder="Jean Dupont"
                                        value={newContact.name}
                                        onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="flex-1 px-4 py-3 bg-[#128C7E] text-white font-semibold rounded-lg hover:bg-[#075E54] transition-colors disabled:opacity-50"
                                    >
                                        {saving ? 'Ajout...' : 'Ajouter'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    )
}

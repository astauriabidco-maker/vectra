'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface ComplianceStatus {
    phone: {
        status: string
        connected: boolean
        quality_rating: string
        display_phone: string | null
        verified_name: string | null
    }
    identity: {
        status: string
        name_status: string
        current_name: string | null
        rejection_reason: string | null
    }
    business: {
        status: string
        verified: boolean
        name: string | null
        waba_id: string | null
    }
    messaging: {
        limit_tier: string
        limit_value: number
        can_send_marketing: boolean
    }
    errors: string[]
    fetched_at: string
}

export default function CompliancePage() {
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState<ComplianceStatus | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Modals
    const [showSmsModal, setShowSmsModal] = useState(false)
    const [showNameModal, setShowNameModal] = useState(false)

    // Form states
    const [smsCode, setSmsCode] = useState('')
    const [newName, setNewName] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [codeSent, setCodeSent] = useState(false)

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

    const fetchStatus = async () => {
        setLoading(true)
        try {
            const res = await authFetch(`${API_URL}/compliance/status`)
            if (!res.ok) throw new Error('Failed to fetch status')
            const data = await res.json()
            setStatus(data)
            setError(null)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchStatus()
    }, [])

    const handleRequestSms = async () => {
        setSubmitting(true)
        try {
            const res = await authFetch(`${API_URL}/compliance/trigger-sms`, {
                method: 'POST',
                body: JSON.stringify({ method: 'SMS' })
            })
            const data = await res.json()
            if (res.ok) {
                setCodeSent(true)
                alert('✅ Code envoyé par SMS')
            } else {
                alert(`❌ ${data.error}`)
            }
        } catch (err) {
            alert('❌ Erreur lors de l\'envoi')
        } finally {
            setSubmitting(false)
        }
    }

    const handleVerifyCode = async () => {
        if (!smsCode) return
        setSubmitting(true)
        try {
            const res = await authFetch(`${API_URL}/compliance/verify-code`, {
                method: 'POST',
                body: JSON.stringify({ code: smsCode })
            })
            const data = await res.json()
            if (res.ok) {
                alert('✅ Numéro vérifié avec succès !')
                setShowSmsModal(false)
                setSmsCode('')
                setCodeSent(false)
                fetchStatus()
            } else {
                alert(`❌ ${data.error}`)
            }
        } catch (err) {
            alert('❌ Erreur de vérification')
        } finally {
            setSubmitting(false)
        }
    }

    const handleUpdateName = async () => {
        if (!newName.trim()) return
        setSubmitting(true)
        try {
            const res = await authFetch(`${API_URL}/compliance/update-profile`, {
                method: 'POST',
                body: JSON.stringify({ display_name: newName })
            })
            const data = await res.json()
            if (res.ok) {
                alert('✅ ' + data.message)
                setShowNameModal(false)
                setNewName('')
                fetchStatus()
            } else {
                alert(`❌ ${data.error}`)
            }
        } catch (err) {
            alert('❌ Erreur lors de la mise à jour')
        } finally {
            setSubmitting(false)
        }
    }

    const getStepStatus = (step: number) => {
        if (!status) return { complete: false, color: 'gray' }

        switch (step) {
            case 1: // Phone
                return {
                    complete: status.phone.connected,
                    color: status.phone.connected ? 'green' : 'red'
                }
            case 2: // Identity
                return {
                    complete: status.identity.status === 'APPROVED',
                    color: status.identity.status === 'APPROVED' ? 'green' :
                        status.identity.status === 'PENDING' ? 'yellow' : 'red'
                }
            case 3: // Business
                return {
                    complete: status.business.verified,
                    color: status.business.verified ? 'green' : 'orange'
                }
            default:
                return { complete: false, color: 'gray' }
        }
    }

    const getTierLabel = (tier: string) => {
        const labels: { [key: string]: string } = {
            'TIER_50': '50/jour',
            'TIER_250': '250/jour',
            'TIER_1K': '1 000/jour',
            'TIER_10K': '10 000/jour',
            'TIER_100K': '100 000/jour',
            'TIER_UNLIMITED': 'Illimité'
        }
        return labels[tier] || tier
    }

    const allStepsComplete = status &&
        status.phone.connected &&
        status.identity.status === 'APPROVED' &&
        status.business.verified

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                            🚀 Assistant de Conformité
                        </h1>
                        <p className="text-gray-500 mt-1">
                            Configurez votre compte WhatsApp avant de lancer vos campagnes
                        </p>
                    </div>
                    <button
                        onClick={fetchStatus}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-[#128C7E] text-white rounded-lg hover:bg-[#0d7568] transition-colors disabled:opacity-50"
                    >
                        <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Actualiser
                    </button>
                </div>

                {/* Success Banner */}
                {allStepsComplete && (
                    <div className="mb-8 p-6 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl text-white shadow-lg">
                        <div className="flex items-center gap-4">
                            <span className="text-5xl">✅</span>
                            <div>
                                <h2 className="text-xl font-bold">Compte prêt pour les campagnes !</h2>
                                <p className="opacity-90">
                                    Toutes les étapes sont validées. Vous pouvez envoyer jusqu'à {getTierLabel(status?.messaging.limit_tier || '')} conversations.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                        ❌ {error}
                    </div>
                )}

                {loading && !status ? (
                    <div className="flex items-center justify-center py-20">
                        <svg className="w-12 h-12 animate-spin text-[#128C7E]" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                    </div>
                ) : status && (
                    <div className="space-y-6">

                        {/* Step 1: Phone Number */}
                        <div className={`bg-white rounded-2xl shadow-sm border-2 transition-colors ${getStepStatus(1).color === 'green' ? 'border-green-200' : 'border-red-200'
                            }`}>
                            <div className="p-6">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${getStepStatus(1).complete
                                                ? 'bg-green-100 text-green-600'
                                                : 'bg-red-100 text-red-600'
                                            }`}>
                                            {getStepStatus(1).complete ? '✓' : '1'}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800">
                                                📱 Étape 1 : Le Numéro
                                            </h3>
                                            <p className="text-gray-500 text-sm mt-1">
                                                Connexion technique avec Meta
                                            </p>

                                            <div className="mt-4 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${status.phone.connected
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-red-100 text-red-700'
                                                        }`}>
                                                        {status.phone.connected ? '🟢 CONNECTÉ' : '🔴 DÉCONNECTÉ'}
                                                    </span>
                                                </div>
                                                {status.phone.display_phone && (
                                                    <p className="text-sm text-gray-600">
                                                        📞 {status.phone.display_phone}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {!status.phone.connected && (
                                        <button
                                            onClick={() => setShowSmsModal(true)}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                                        >
                                            Reconnecter
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Step 2: Identity / Display Name */}
                        <div className={`bg-white rounded-2xl shadow-sm border-2 transition-colors ${getStepStatus(2).color === 'green' ? 'border-green-200' :
                                getStepStatus(2).color === 'yellow' ? 'border-yellow-200' : 'border-red-200'
                            }`}>
                            <div className="p-6">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${getStepStatus(2).complete
                                                ? 'bg-green-100 text-green-600'
                                                : getStepStatus(2).color === 'yellow'
                                                    ? 'bg-yellow-100 text-yellow-600'
                                                    : 'bg-red-100 text-red-600'
                                            }`}>
                                            {getStepStatus(2).complete ? '✓' : '2'}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800">
                                                🏷️ Étape 2 : L'Identité
                                            </h3>
                                            <p className="text-gray-500 text-sm mt-1">
                                                Nom d'affichage WhatsApp Business
                                            </p>

                                            <div className="mt-4 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${status.identity.status === 'APPROVED'
                                                            ? 'bg-green-100 text-green-700'
                                                            : status.identity.status === 'PENDING'
                                                                ? 'bg-yellow-100 text-yellow-700'
                                                                : 'bg-red-100 text-red-700'
                                                        }`}>
                                                        {status.identity.status === 'APPROVED' ? '✅ APPROUVÉ' :
                                                            status.identity.status === 'PENDING' ? '⏳ EN ATTENTE' : '❌ REJETÉ'}
                                                    </span>
                                                </div>
                                                {status.identity.current_name && (
                                                    <p className="text-sm text-gray-600">
                                                        Nom actuel : <strong>{status.identity.current_name}</strong>
                                                    </p>
                                                )}
                                                {status.identity.status === 'REJECTED' && status.identity.rejection_reason && (
                                                    <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                                                        ⚠️ Raison : {status.identity.rejection_reason}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {status.identity.status !== 'APPROVED' && (
                                        <button
                                            onClick={() => setShowNameModal(true)}
                                            className={`px-4 py-2 ${status.identity.status === 'PENDING'
                                                    ? 'bg-yellow-500 hover:bg-yellow-600'
                                                    : 'bg-blue-600 hover:bg-blue-700'
                                                } text-white rounded-lg transition-colors font-medium`}
                                        >
                                            {status.identity.status === 'PENDING' ? 'Modifier' : 'Changer le nom'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Step 3: Business Verification */}
                        <div className={`bg-white rounded-2xl shadow-sm border-2 transition-colors ${getStepStatus(3).complete ? 'border-green-200' : 'border-orange-200'
                            }`}>
                            <div className="p-6">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${getStepStatus(3).complete
                                                ? 'bg-green-100 text-green-600'
                                                : 'bg-orange-100 text-orange-600'
                                            }`}>
                                            {getStepStatus(3).complete ? '✓' : '3'}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800">
                                                🏢 Étape 3 : L'Entreprise
                                            </h3>
                                            <p className="text-gray-500 text-sm mt-1">
                                                Vérification légale auprès de Meta
                                            </p>

                                            <div className="mt-4 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${status.business.verified
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-orange-100 text-orange-700'
                                                        }`}>
                                                        {status.business.verified ? '✅ VÉRIFIÉ' : '🟠 NON VÉRIFIÉ'}
                                                    </span>
                                                </div>
                                                {status.business.name && (
                                                    <p className="text-sm text-gray-600">
                                                        Entreprise : <strong>{status.business.name}</strong>
                                                    </p>
                                                )}
                                                {!status.business.verified && (
                                                    <div className="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-200 text-sm text-orange-700">
                                                        <p className="font-medium mb-1">📋 Pourquoi vérifier ?</p>
                                                        <ul className="list-disc list-inside space-y-1 text-xs">
                                                            <li>Augmenter vos limites d'envoi (1000+ / jour)</li>
                                                            <li>Afficher un badge vérifié</li>
                                                            <li>Accéder aux fonctionnalités avancées</li>
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {!status.business.verified && (
                                        <a
                                            href={`https://business.facebook.com/settings/security${status.business.waba_id ? `?business_id=${status.business.waba_id}` : ''}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                            Vérifier
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Current Limits */}
                        <div className="bg-gradient-to-r from-slate-50 to-gray-100 rounded-2xl p-6 border border-gray-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-gray-800">📊 Limite actuelle</h3>
                                    <p className="text-2xl font-bold text-[#128C7E] mt-1">
                                        {getTierLabel(status.messaging.limit_tier)}
                                    </p>
                                </div>
                                <div className={`px-4 py-2 rounded-full font-semibold ${status.messaging.can_send_marketing
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-200 text-gray-600'
                                    }`}>
                                    {status.messaging.can_send_marketing ? '✅ Marketing autorisé' : '🔒 Marketing bloqué'}
                                </div>
                            </div>
                        </div>

                        {/* Errors */}
                        {status.errors.length > 0 && (
                            <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
                                <h4 className="font-medium text-orange-800 mb-2">⚠️ Avertissements</h4>
                                <ul className="space-y-1 text-sm text-orange-700">
                                    {status.errors.map((err, idx) => (
                                        <li key={idx}>• {err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {/* SMS Verification Modal */}
                {showSmsModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                            <div className="p-5 border-b bg-gradient-to-r from-red-500 to-red-600">
                                <h3 className="text-lg font-bold text-white">📱 Reconnecter le numéro</h3>
                            </div>
                            <div className="p-6">
                                {!codeSent ? (
                                    <>
                                        <p className="text-gray-600 mb-6">
                                            Un code de vérification sera envoyé par SMS au numéro enregistré.
                                        </p>
                                        <button
                                            onClick={handleRequestSms}
                                            disabled={submitting}
                                            className="w-full py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
                                        >
                                            {submitting ? 'Envoi en cours...' : 'Envoyer le code SMS'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-gray-600 mb-4">
                                            Entrez le code reçu par SMS :
                                        </p>
                                        <input
                                            type="text"
                                            value={smsCode}
                                            onChange={(e) => setSmsCode(e.target.value)}
                                            placeholder="123456"
                                            className="w-full p-3 border rounded-lg text-center text-2xl tracking-widest mb-4"
                                            maxLength={6}
                                        />
                                        <button
                                            onClick={handleVerifyCode}
                                            disabled={submitting || smsCode.length < 6}
                                            className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
                                        >
                                            {submitting ? 'Vérification...' : 'Vérifier le code'}
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="p-4 border-t bg-gray-50">
                                <button
                                    onClick={() => {
                                        setShowSmsModal(false)
                                        setSmsCode('')
                                        setCodeSent(false)
                                    }}
                                    className="w-full py-2 text-gray-600 hover:text-gray-800"
                                >
                                    Annuler
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Name Update Modal */}
                {showNameModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                            <div className="p-5 border-b bg-gradient-to-r from-blue-500 to-blue-600">
                                <h3 className="text-lg font-bold text-white">🏷️ Modifier le nom d'affichage</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-600 mb-4">
                                    Entrez le nouveau nom pour votre compte WhatsApp Business :
                                </p>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Nom de votre entreprise"
                                    className="w-full p-3 border rounded-lg mb-4"
                                />
                                <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 mb-4">
                                    💡 <strong>Conseil :</strong> Utilisez le nom officiel de votre entreprise. Les noms fantaisistes ou trompeurs sont rejetés.
                                </div>
                                <button
                                    onClick={handleUpdateName}
                                    disabled={submitting || !newName.trim()}
                                    className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                                >
                                    {submitting ? 'Envoi...' : 'Soumettre pour validation'}
                                </button>
                            </div>
                            <div className="p-4 border-t bg-gray-50">
                                <button
                                    onClick={() => {
                                        setShowNameModal(false)
                                        setNewName('')
                                    }}
                                    className="w-full py-2 text-gray-600 hover:text-gray-800"
                                >
                                    Annuler
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    )
}

'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

interface KPIs {
    totalCampaigns: number
    totalContacts: number
    totalSent: number
    totalFailed: number
    totalRead: number
    totalResponses: number
    totalConversions: number
    deliveryRate: number
    openRate: number
    responseRate: number
    conversionRate: number
}

interface CampaignStats {
    id: string
    name: string
    status: string
    total_sent: number
    read_count: number
    response_count: number
    openRate: string
    responseRate: string
    created_at: string
}

interface AnalyticsData {
    kpis: KPIs
    recentCampaigns: CampaignStats[]
    timeline: { date: string; sent: number; read_count: number; responses: number }[]
    variantPerformance: { variant_letter: string; total_sent: number; total_read: number }[]
}

export default function AnalyticsPage() {
    const [data, setData] = useState<AnalyticsData | null>(null)
    const [loading, setLoading] = useState(true)

    const authFetch = async (url: string) => {
        const token = localStorage.getItem('token')
        return fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        })
    }

    useEffect(() => {
        const fetchAnalytics = async () => {
            try {
                const res = await authFetch(`${API_URL}/campaigns/analytics`)
                if (res.ok) {
                    setData(await res.json())
                }
            } catch (err) {
                console.error('Failed to fetch analytics')
            } finally {
                setLoading(false)
            }
        }
        fetchAnalytics()
    }, [])

    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#128C7E] border-t-transparent"></div>
                </div>
            </DashboardLayout>
        )
    }

    const kpis = data?.kpis || {} as KPIs

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">📊 Analytics</h1>
                        <p className="text-gray-500">Performance de vos campagnes marketing</p>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-3xl mb-1">📨</div>
                        <div className="text-2xl font-bold text-gray-900">{kpis.totalSent || 0}</div>
                        <div className="text-sm text-gray-500">Messages envoyés</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-3xl mb-1">✅</div>
                        <div className="text-2xl font-bold text-green-600">{kpis.deliveryRate || 0}%</div>
                        <div className="text-sm text-gray-500">Taux de livraison</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-3xl mb-1">👁️</div>
                        <div className="text-2xl font-bold text-blue-600">{kpis.openRate || 0}%</div>
                        <div className="text-sm text-gray-500">Taux d'ouverture</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-3xl mb-1">💬</div>
                        <div className="text-2xl font-bold text-purple-600">{kpis.responseRate || 0}%</div>
                        <div className="text-sm text-gray-500">Taux de réponse</div>
                    </div>
                </div>

                {/* Secondary KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-r from-[#128C7E] to-[#075E54] rounded-xl p-5 text-white">
                        <div className="text-sm opacity-80">Total Campagnes</div>
                        <div className="text-3xl font-bold">{kpis.totalCampaigns || 0}</div>
                    </div>
                    <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-5 text-white">
                        <div className="text-sm opacity-80">Ouvertures</div>
                        <div className="text-3xl font-bold">{kpis.totalRead || 0}</div>
                    </div>
                    <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl p-5 text-white">
                        <div className="text-sm opacity-80">Réponses</div>
                        <div className="text-3xl font-bold">{kpis.totalResponses || 0}</div>
                    </div>
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl p-5 text-white">
                        <div className="text-sm opacity-80">Conversions</div>
                        <div className="text-3xl font-bold">{kpis.totalConversions || 0}</div>
                    </div>
                </div>

                {/* A/B Test Performance */}
                {data?.variantPerformance && data.variantPerformance.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                        <h2 className="text-lg font-bold text-gray-900 mb-4">🧪 Performance A/B Tests</h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {data.variantPerformance.map(v => (
                                <div key={v.variant_letter} className="bg-gray-50 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${v.variant_letter === 'A' ? 'bg-purple-500' :
                                            v.variant_letter === 'B' ? 'bg-orange-500' : 'bg-blue-500'
                                            }`}>
                                            {v.variant_letter}
                                        </span>
                                        <span className="font-semibold">Variant {v.variant_letter}</span>
                                    </div>
                                    <div className="text-sm text-gray-600">
                                        <div>Envoyés: {v.total_sent || 0}</div>
                                        <div>Lus: {v.total_read || 0}</div>
                                        <div className="font-medium text-gray-800">
                                            Taux: {v.total_sent > 0 ? ((v.total_read / v.total_sent) * 100).toFixed(1) : 0}%
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recent Campaigns Table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-100">
                        <h2 className="text-lg font-bold text-gray-900">📋 Campagnes récentes</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campagne</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Envoyés</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ouvertures</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Réponses</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {data?.recentCampaigns?.map(campaign => (
                                    <tr key={campaign.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-gray-900">{campaign.name}</div>
                                            <div className="text-xs text-gray-500">
                                                {new Date(campaign.created_at).toLocaleDateString('fr-FR')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${campaign.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                                                campaign.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                                                    campaign.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                                                        'bg-gray-100 text-gray-700'
                                                }`}>
                                                {campaign.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-gray-900">{campaign.total_sent}</td>
                                        <td className="px-6 py-4">
                                            <span className="text-blue-600 font-medium">{campaign.openRate}%</span>
                                            <span className="text-gray-400 text-xs ml-1">({campaign.read_count})</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-purple-600 font-medium">{campaign.responseRate}%</span>
                                            <span className="text-gray-400 text-xs ml-1">({campaign.response_count})</span>
                                        </td>
                                    </tr>
                                ))}
                                {(!data?.recentCampaigns || data.recentCampaigns.length === 0) && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                                            Aucune campagne pour le moment
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    )
}

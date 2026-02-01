'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface HealthData {
    quality_rating: string
    limit_tier: string
    limit_value: number
    business_verified: boolean
    can_send_marketing: boolean
}

export default function ComplianceHealthWidget() {
    const [health, setHealth] = useState<HealthData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchHealth = async () => {
            try {
                const token = localStorage.getItem('token')
                const res = await fetch(`${API_URL}/compliance/status`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                if (res.ok) {
                    const data = await res.json()
                    setHealth({
                        quality_rating: data.phone?.quality_rating || 'UNKNOWN',
                        limit_tier: data.messaging?.limit_tier || 'TIER_50',
                        limit_value: data.messaging?.limit_value || 50,
                        business_verified: data.business?.verified || false,
                        can_send_marketing: data.messaging?.can_send_marketing || false
                    })
                }
            } catch (err) {
                console.error('Failed to fetch compliance health')
            } finally {
                setLoading(false)
            }
        }
        fetchHealth()
        // Refresh every 5 minutes
        const interval = setInterval(fetchHealth, 300000)
        return () => clearInterval(interval)
    }, [])

    if (loading) {
        return (
            <div className="bg-gray-50 rounded-lg px-3 py-2 animate-pulse">
                <div className="h-4 w-32 bg-gray-200 rounded"></div>
            </div>
        )
    }

    if (!health) return null

    // Determine quality color and text
    const qualityConfig = {
        GREEN: { color: 'bg-green-500', text: 'Excellente', icon: '✅' },
        YELLOW: { color: 'bg-yellow-500', text: 'Attention', icon: '⚠️' },
        RED: { color: 'bg-red-500', text: 'Critique', icon: '🚨' },
        UNKNOWN: { color: 'bg-gray-400', text: 'Inconnu', icon: '❓' }
    }
    const quality = qualityConfig[health.quality_rating as keyof typeof qualityConfig] || qualityConfig.UNKNOWN

    // Is this sandbox mode?
    const isSandbox = health.limit_tier === 'TIER_50' || health.limit_value <= 50

    return (
        <Link href="/compliance" className="block">
            <div className={`rounded-xl border transition-all hover:shadow-md cursor-pointer ${health.quality_rating === 'RED'
                    ? 'bg-red-50 border-red-200'
                    : health.quality_rating === 'YELLOW'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-green-50 border-green-200'
                }`}>
                <div className="px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                        {/* Quality Rating */}
                        <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${quality.color} ${health.quality_rating === 'RED' ? 'animate-pulse' : ''}`}></div>
                            <div>
                                <p className="text-xs text-gray-500 font-medium">Qualité du Compte</p>
                                <p className={`text-sm font-bold ${health.quality_rating === 'RED' ? 'text-red-700' :
                                        health.quality_rating === 'YELLOW' ? 'text-amber-700' : 'text-green-700'
                                    }`}>
                                    {quality.icon} {quality.text}
                                </p>
                            </div>
                        </div>

                        {/* Messaging Limit */}
                        <div className="text-right">
                            <p className="text-xs text-gray-500 font-medium">Limite 24h</p>
                            <p className="text-sm font-bold text-gray-700">
                                {health.limit_value.toLocaleString()} msg/jour
                            </p>
                            {isSandbox && (
                                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                    Mode Test
                                </span>
                            )}
                        </div>

                        {/* Business Status */}
                        <div className="text-center">
                            <p className="text-xs text-gray-500 font-medium">Business</p>
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${health.business_verified
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                {health.business_verified ? '✓ Vérifié' : 'Non vérifié'}
                            </span>
                        </div>

                        {/* Action Arrow */}
                        <div className="text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </div>
                    </div>

                    {/* Critical Warning */}
                    {health.quality_rating === 'RED' && (
                        <div className="mt-2 pt-2 border-t border-red-200 text-xs text-red-600 font-medium flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Arrêtez les campagnes immédiatement ! Cliquez pour plus de détails.
                        </div>
                    )}
                </div>
            </div>
        </Link>
    )
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/Layout/DashboardLayout';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface AnalyticsData {
    overview: {
        total_events: number;
        upcoming_events: number;
        total_tickets: number;
        paid_tickets: number;
        free_tickets: number;
        checked_in: number;
        cancelled: number;
        total_revenue: number;
    };
    conversion: {
        total_registrations: number;
        pending_payment: number;
        completed: number;
        abandoned: number;
    };
    sources: Array<{ source: string; count: number; percentage: number }>;
    heatmap: Array<{ day_of_week: number; hour: number; count: number }>;
    daily_trend: Array<{ date: string; registrations: number; paid: number }>;
    top_events: Array<{ id: number; title: string; total_tickets: number; fill_rate: number }>;
    utm_campaigns: Array<{ campaign: string; source: string; registrations: number; converted: number }>;
}

export default function EventsAnalyticsPage() {
    const router = useRouter();
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            router.push('/login');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/events/analytics/dashboard`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await res.json();
            setData(result);
        } catch (err) {
            console.error('Failed to fetch analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    const getHeatmapColor = (count: number, maxCount: number) => {
        if (count === 0) return 'bg-gray-100';
        const intensity = count / maxCount;
        if (intensity > 0.75) return 'bg-purple-600';
        if (intensity > 0.5) return 'bg-purple-400';
        if (intensity > 0.25) return 'bg-purple-300';
        return 'bg-purple-200';
    };

    const buildHeatmapGrid = (): { grid: number[][]; maxCount: number } => {
        const emptyGrid: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
        if (!data?.heatmap) return { grid: emptyGrid, maxCount: 1 };
        const grid: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
        let maxCount = 1;

        data.heatmap.forEach(item => {
            const day = Math.floor(item.day_of_week);
            const hour = Math.floor(item.hour);
            if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
                grid[day][hour] = item.count;
                maxCount = Math.max(maxCount, item.count);
            }
        });

        return { grid, maxCount };
    };

    if (loading) {
        return (
            <DashboardLayout>
                <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
                </div>
            </DashboardLayout>
        );
    }

    if (!data) {
        return (
            <DashboardLayout>
                <div className="min-h-screen bg-gray-50 p-8">
                    <div className="text-center text-gray-500">Aucune donnée disponible</div>
                </div>
            </DashboardLayout>
        );
    }

    const heatmapData = buildHeatmapGrid();
    const conversionRate = data.conversion.total_registrations > 0
        ? Math.round((data.conversion.completed / data.conversion.total_registrations) * 100)
        : 0;

    return (
        <DashboardLayout>
            <div className="min-h-screen bg-gray-50 p-6">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <button
                            onClick={() => router.push('/events')}
                            className="text-gray-500 hover:text-gray-700"
                        >
                            ← Retour
                        </button>
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">📊 Analytics Événements</h1>
                    <p className="text-gray-500">Vue d'ensemble des performances de vos événements</p>
                </div>

                {/* KPIs Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-sm text-gray-500 mb-1">Événements</div>
                        <div className="text-2xl font-bold text-gray-900">{data.overview.total_events}</div>
                        <div className="text-xs text-green-600">{data.overview.upcoming_events} à venir</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-sm text-gray-500 mb-1">Inscriptions</div>
                        <div className="text-2xl font-bold text-purple-600">{data.overview.total_tickets}</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-sm text-gray-500 mb-1">Payants</div>
                        <div className="text-2xl font-bold text-green-600">{data.overview.paid_tickets}</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-sm text-gray-500 mb-1">Gratuits</div>
                        <div className="text-2xl font-bold text-blue-600">{data.overview.free_tickets}</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-sm text-gray-500 mb-1">Check-ins</div>
                        <div className="text-2xl font-bold text-orange-600">{data.overview.checked_in}</div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="text-sm text-gray-500 mb-1">Revenu</div>
                        <div className="text-2xl font-bold text-emerald-600">{parseFloat(data.overview.total_revenue?.toString() || '0').toFixed(0)}€</div>
                    </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-6 mb-8">
                    {/* Conversion Funnel */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">🎯 Taux de Conversion</h3>
                        <div className="flex items-center gap-6">
                            <div className="relative w-32 h-32">
                                <svg className="w-32 h-32 transform -rotate-90">
                                    <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="12" fill="none" />
                                    <circle
                                        cx="64" cy="64" r="56"
                                        stroke="#8b5cf6"
                                        strokeWidth="12"
                                        fill="none"
                                        strokeDasharray={`${conversionRate * 3.52} 352`}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-3xl font-bold text-purple-600">{conversionRate}%</span>
                                </div>
                            </div>
                            <div className="flex-1 space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-500">Total inscriptions</span>
                                    <span className="font-semibold">{data.conversion.total_registrations}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-500">✅ Complétées</span>
                                    <span className="font-semibold text-green-600">{data.conversion.completed}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-500">⏳ En attente de paiement</span>
                                    <span className="font-semibold text-yellow-600">{data.conversion.pending_payment}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-500">❌ Abandonnées</span>
                                    <span className="font-semibold text-red-600">{data.conversion.abandoned}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Source Breakdown */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">📍 Provenance des Inscriptions</h3>
                        <div className="space-y-3">
                            {data.sources.length > 0 ? data.sources.map((source, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <div className="w-24 text-sm font-medium text-gray-700 capitalize">{source.source}</div>
                                    <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all"
                                            style={{ width: `${source.percentage}%` }}
                                        ></div>
                                    </div>
                                    <div className="w-16 text-right text-sm">
                                        <span className="font-semibold">{source.count}</span>
                                        <span className="text-gray-400 ml-1">({source.percentage}%)</span>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center text-gray-400 py-4">Aucune donnée</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Heatmap */}
                <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">🔥 Heatmap des Inscriptions</h3>
                    <p className="text-sm text-gray-500 mb-4">Quand vos participants s'inscrivent-ils le plus ?</p>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr>
                                    <th className="w-12"></th>
                                    {[...Array(24)].map((_, h) => (
                                        <th key={h} className="text-xs text-gray-400 font-normal px-0.5">
                                            {h.toString().padStart(2, '0')}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {dayNames.map((day, dayIndex) => (
                                    <tr key={day}>
                                        <td className="text-xs text-gray-500 font-medium pr-2">{day}</td>
                                        {[...Array(24)].map((_, hour) => {
                                            const count = heatmapData.grid?.[dayIndex]?.[hour] || 0;
                                            return (
                                                <td key={hour} className="p-0.5">
                                                    <div
                                                        className={`w-4 h-4 rounded-sm ${getHeatmapColor(count, heatmapData.maxCount || 1)} cursor-pointer transition-transform hover:scale-125`}
                                                        title={`${day} ${hour}h: ${count} inscriptions`}
                                                    ></div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4 text-xs text-gray-500">
                        <span>Moins</span>
                        <div className="w-3 h-3 bg-gray-100 rounded"></div>
                        <div className="w-3 h-3 bg-purple-200 rounded"></div>
                        <div className="w-3 h-3 bg-purple-400 rounded"></div>
                        <div className="w-3 h-3 bg-purple-600 rounded"></div>
                        <span>Plus</span>
                    </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Top Events */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">🏆 Top Événements</h3>
                        <div className="space-y-3">
                            {data.top_events.length > 0 ? data.top_events.map((event, i) => (
                                <div
                                    key={event.id}
                                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                                    onClick={() => router.push(`/events?id=${event.id}`)}
                                >
                                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-bold">
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-900 truncate">{event.title}</div>
                                        <div className="text-sm text-gray-500">{event.total_tickets} inscrits</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-semibold text-purple-600">{event.fill_rate || 0}%</div>
                                        <div className="text-xs text-gray-400">remplissage</div>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center text-gray-400 py-4">Aucun événement</div>
                            )}
                        </div>
                    </div>

                    {/* UTM Campaigns */}
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">📢 Performance Campagnes UTM</h3>
                        {data.utm_campaigns.length > 0 ? (
                            <div className="space-y-3">
                                {data.utm_campaigns.map((campaign, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <div>
                                            <div className="font-medium text-gray-900">{campaign.campaign}</div>
                                            <div className="text-xs text-gray-500">via {campaign.source}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-semibold text-gray-900">{campaign.registrations}</div>
                                            <div className="text-xs text-green-600">{campaign.converted} convertis</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center text-gray-400 py-8">
                                <div className="text-4xl mb-2">📊</div>
                                <p>Aucune campagne UTM détectée</p>
                                <p className="text-xs mt-2">Ajoutez <code>?utm_source=...</code> à vos liens</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

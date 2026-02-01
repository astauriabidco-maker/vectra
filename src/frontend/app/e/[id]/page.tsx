'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Tier {
    id: number;
    name: string;
    description: string;
    price: string;
    capacity: number;
    sold_count: number;
    available_spots: number;
    available_from: string | null;
    available_until: string | null;
    perks: string[];
    status: 'available' | 'sold_out' | 'expired' | 'upcoming';
}

interface EventData {
    id: number;
    title: string;
    description: string | null;
    date_start: string;
    date_end: string | null;
    price: string;
    currency: string;
    capacity: number;
    sold_count: number;
    image_url: string | null;
    location_details: string | null;
    event_type: string;
    output_format: string;
    available_spots: number;
    requires_company_info: boolean;
    has_tiers: boolean;
    tiers: Tier[];
    min_price: number;
    max_price: number;
}

export default function PublicEventPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const eventId = params.id as string;

    const [event, setEvent] = useState<EventData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        company: '',
        role: ''
    });

    const cancelled = searchParams.get('cancelled') === 'true';

    useEffect(() => {
        fetchEvent();
    }, [eventId]);

    const fetchEvent = async () => {
        try {
            const res = await fetch(`${API_URL}/public/events/${eventId}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Événement non trouvé');
            }
            const data = await res.json();
            setEvent(data);
            // Auto-select first available tier if exists
            if (data.has_tiers && data.tiers.length > 0) {
                const availableTier = data.tiers.find((t: Tier) => t.status === 'available');
                if (availableTier) setSelectedTier(availableTier);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!event) return;

        setSubmitting(true);
        try {
            const res = await fetch(`${API_URL}/public/events/${eventId}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    tier_id: selectedTier?.id || null
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Erreur inscription');
            }

            if (data.checkout_url) {
                window.location.href = data.checkout_url;
            } else if (data.status === 'COMPLIMENTARY') {
                alert(data.message);
                setShowForm(false);
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return new Intl.DateTimeFormat('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    const getCurrentPrice = () => {
        if (selectedTier) return parseFloat(selectedTier.price);
        if (event) return parseFloat(event.price);
        return 0;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            </div>
        );
    }

    if (error || !event) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 text-center">
                    <div className="text-6xl mb-4">😔</div>
                    <h1 className="text-2xl font-bold text-white mb-2">Événement non trouvé</h1>
                    <p className="text-white/70">{error || "Cet événement n'existe pas ou n'est plus disponible."}</p>
                </div>
            </div>
        );
    }

    const isFree = getCurrentPrice() === 0;
    const isSoldOut = event.available_spots <= 0;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
            {/* Hero Section */}
            <div className="relative h-[50vh] overflow-hidden">
                {event.image_url ? (
                    <img
                        src={event.image_url}
                        alt={event.title}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-600 to-indigo-700"></div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent"></div>

                {/* Event Type Badge */}
                <div className="absolute top-6 left-6">
                    <span className={`px-4 py-2 rounded-full text-sm font-semibold backdrop-blur-lg ${event.output_format === 'BADGE'
                        ? 'bg-purple-500/30 text-purple-200 border border-purple-400/30'
                        : 'bg-blue-500/30 text-blue-200 border border-blue-400/30'
                        }`}>
                        {event.event_type === 'SEMINAR' && '🎓 Séminaire'}
                        {event.event_type === 'CONGRESS' && '🏛️ Congrès'}
                        {event.event_type === 'STANDARD' && '🎉 Événement'}
                    </span>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-6 -mt-32 relative z-10 pb-20">
                {/* Main Card */}
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 overflow-hidden shadow-2xl">
                    <div className="p-8 md:p-12">
                        {/* Cancelled Banner */}
                        {cancelled && (
                            <div className="mb-6 p-4 bg-red-500/20 border border-red-400/30 rounded-xl text-red-200 text-center">
                                ⚠️ Paiement annulé. Vous pouvez réessayer ci-dessous.
                            </div>
                        )}

                        {/* Title */}
                        <h1 className="text-4xl md:text-5xl font-bold text-white mb-6">
                            {event.title}
                        </h1>

                        {/* Meta Info */}
                        <div className="grid md:grid-cols-2 gap-4 mb-8">
                            <div className="flex items-center gap-3 text-white/80">
                                <span className="text-2xl">📅</span>
                                <div>
                                    <div className="text-sm text-white/50">Date</div>
                                    <div className="font-medium">{formatDate(event.date_start)}</div>
                                </div>
                            </div>
                            {event.location_details && (
                                <div className="flex items-center gap-3 text-white/80">
                                    <span className="text-2xl">📍</span>
                                    <div>
                                        <div className="text-sm text-white/50">Lieu</div>
                                        <div className="font-medium">{event.location_details}</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Description */}
                        {event.description && (
                            <div className="prose prose-invert max-w-none mb-8">
                                <p className="text-white/70 text-lg leading-relaxed whitespace-pre-wrap">
                                    {event.description}
                                </p>
                            </div>
                        )}

                        {/* Tier Selection - NEW */}
                        {event.has_tiers && event.tiers.length > 0 && !showForm && (
                            <div className="mb-8">
                                <h3 className="text-xl font-bold text-white mb-4">🎫 Choisissez votre formule</h3>
                                <div className="grid gap-4">
                                    {event.tiers.map((tier) => {
                                        const isAvailable = tier.status === 'available';
                                        const isSelected = selectedTier?.id === tier.id;

                                        return (
                                            <div
                                                key={tier.id}
                                                onClick={() => isAvailable && setSelectedTier(tier)}
                                                className={`relative p-5 rounded-2xl border-2 transition-all cursor-pointer ${isSelected
                                                        ? 'border-purple-500 bg-purple-500/20'
                                                        : isAvailable
                                                            ? 'border-white/20 bg-white/5 hover:border-white/40'
                                                            : 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'
                                                    }`}
                                            >
                                                {/* Best Value Badge for VIP */}
                                                {tier.name === 'VIP' && (
                                                    <div className="absolute -top-3 right-4">
                                                        <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full">
                                                            ⭐ PREMIUM
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Early Bird Badge */}
                                                {tier.name.toLowerCase().includes('early') && tier.available_until && (
                                                    <div className="absolute -top-3 right-4">
                                                        <span className="px-3 py-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-bold rounded-full">
                                                            ⏰ OFFRE LIMITÉE
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-purple-500 bg-purple-500' : 'border-white/40'
                                                                }`}>
                                                                {isSelected && <span className="text-white text-xs">✓</span>}
                                                            </div>
                                                            <h4 className="text-lg font-bold text-white">{tier.name}</h4>
                                                        </div>
                                                        <p className="text-white/60 text-sm mb-3 ml-8">{tier.description}</p>

                                                        {/* Perks */}
                                                        {tier.perks && tier.perks.length > 0 && (
                                                            <div className="flex flex-wrap gap-2 ml-8">
                                                                {tier.perks.map((perk, idx) => (
                                                                    <span key={idx} className="px-2 py-1 bg-white/10 text-white/70 text-xs rounded-full">
                                                                        ✓ {perk}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Availability */}
                                                        <div className="mt-3 ml-8 text-sm">
                                                            {tier.status === 'sold_out' && (
                                                                <span className="text-red-400">Complet</span>
                                                            )}
                                                            {tier.status === 'expired' && (
                                                                <span className="text-orange-400">Expiré</span>
                                                            )}
                                                            {tier.status === 'upcoming' && (
                                                                <span className="text-blue-400">Bientôt disponible</span>
                                                            )}
                                                            {tier.status === 'available' && tier.capacity && (
                                                                <span className="text-green-400">
                                                                    {tier.available_spots} places restantes
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="text-right">
                                                        <div className="text-3xl font-bold text-white">
                                                            {parseFloat(tier.price) === 0 ? 'Gratuit' : `${tier.price}€`}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Availability */}
                        <div className="flex items-center gap-4 mb-8 p-4 bg-white/5 rounded-2xl">
                            <div className="flex-1">
                                <div className="text-sm text-white/50 mb-1">Places disponibles</div>
                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all"
                                        style={{ width: `${(event.available_spots / event.capacity) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-bold text-white">{event.available_spots}</div>
                                <div className="text-sm text-white/50">/ {event.capacity}</div>
                            </div>
                        </div>

                        {/* CTA Button */}
                        {!showForm && !isSoldOut && (
                            <button
                                onClick={() => setShowForm(true)}
                                disabled={event.has_tiers && !selectedTier}
                                className="w-full py-5 px-8 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xl font-bold rounded-2xl transition-all transform hover:scale-[1.02] shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                            >
                                {event.has_tiers && selectedTier ? (
                                    isFree ? `✨ Réserver - ${selectedTier.name} (Gratuit)` : `🎟️ Réserver - ${selectedTier.name} (${selectedTier.price}€)`
                                ) : event.has_tiers ? (
                                    'Sélectionnez une formule ci-dessus'
                                ) : (
                                    isFree ? '✨ Réserver ma place (Gratuit)' : `🎟️ Réserver ma place (${event.price}€)`
                                )}
                            </button>
                        )}

                        {isSoldOut && (
                            <div className="w-full py-5 px-8 bg-gray-600/50 text-white/70 text-xl font-bold rounded-2xl text-center">
                                😔 Complet
                            </div>
                        )}

                        {/* Registration Form */}
                        {showForm && !isSoldOut && (
                            <form onSubmit={handleSubmit} className="space-y-5 bg-white/5 rounded-2xl p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xl font-bold text-white">📝 Vos informations</h3>
                                    {selectedTier && (
                                        <span className="px-4 py-2 bg-purple-500/20 text-purple-200 rounded-full text-sm font-medium">
                                            {selectedTier.name} - {parseFloat(selectedTier.price) === 0 ? 'Gratuit' : `${selectedTier.price}€`}
                                        </span>
                                    )}
                                </div>

                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2">Nom complet *</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            placeholder="Jean Dupont"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2">Email</label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            placeholder="jean@entreprise.com"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm text-white/60 mb-2">Téléphone WhatsApp *</label>
                                    <input
                                        type="tel"
                                        required
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        placeholder="06 12 34 56 78"
                                    />
                                    <p className="text-xs text-white/40 mt-1">Vous recevrez votre {event.output_format === 'BADGE' ? 'badge' : 'ticket'} par WhatsApp</p>
                                </div>

                                {/* B2B Fields - Conditional */}
                                {event.requires_company_info && (
                                    <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-white/10">
                                        <div>
                                            <label className="block text-sm text-white/60 mb-2">Entreprise *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.company}
                                                onChange={e => setFormData({ ...formData, company: e.target.value })}
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                placeholder="Acme Corp"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-white/60 mb-2">Fonction *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.role}
                                                onChange={e => setFormData({ ...formData, role: e.target.value })}
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                placeholder="Directeur Marketing"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowForm(false)}
                                        className="flex-1 py-4 px-6 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="flex-[2] py-4 px-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <span className="animate-spin">⏳</span> Traitement...
                                            </span>
                                        ) : (
                                            isFree ? '✅ Confirmer mon inscription' : `💳 Payer ${getCurrentPrice()}€`
                                        )}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center mt-8 text-white/40 text-sm">
                    Propulsé par <span className="font-semibold text-white/60">Vectra</span> 🚀
                </div>
            </div>
        </div>
    );
}

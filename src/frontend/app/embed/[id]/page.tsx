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
    perks: string[];
    status: 'available' | 'sold_out' | 'expired' | 'upcoming';
}

interface EventData {
    id: number;
    title: string;
    description: string;
    date_start: string;
    price: number;
    location_details: string | null;
    image_url: string | null;
    event_type: string;
    requires_company_info: boolean;
    available_spots: number;
    has_tiers: boolean;
    tiers: Tier[];
}

export default function EmbedPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const eventId = params.id as string;

    const [event, setEvent] = useState<EventData | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');
    const [selectedTier, setSelectedTier] = useState<Tier | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [company, setCompany] = useState('');
    const [role, setRole] = useState('');

    // Theme from query params
    const theme = searchParams.get('theme') || 'light';
    const accentColor = searchParams.get('accent') || '#8b5cf6';

    useEffect(() => {
        fetchEvent();
    }, [eventId]);

    const fetchEvent = async () => {
        try {
            const res = await fetch(`${API_URL}/public/events/${eventId}`);
            if (!res.ok) throw new Error('Event not found');
            const data = await res.json();
            setEvent(data);
            // Auto-select first available tier
            if (data.has_tiers && data.tiers.length > 0) {
                const available = data.tiers.find((t: Tier) => t.status === 'available');
                if (available) setSelectedTier(available);
            }
        } catch (err) {
            setError('Événement introuvable');
        } finally {
            setLoading(false);
        }
    };

    const getCurrentPrice = () => {
        if (selectedTier) return parseFloat(selectedTier.price);
        if (event) return parseFloat(event.price?.toString());
        return 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !phone) {
            setError('Nom et téléphone requis');
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            // Capture UTM from parent page
            const utm_source = searchParams.get('utm_source') || 'embed';
            const utm_medium = searchParams.get('utm_medium') || 'widget';
            const utm_campaign = searchParams.get('utm_campaign') || '';
            const referrer = searchParams.get('referrer') || document.referrer;

            const res = await fetch(`${API_URL}/public/events/${eventId}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name, phone, email, company, role,
                    tier_id: selectedTier?.id || null,
                    utm_source, utm_medium, utm_campaign,
                    source: 'embed',
                    referrer
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Erreur inscription');
            }

            if (data.checkout_url) {
                // Redirect to Stripe in new tab (for iframes)
                window.open(data.checkout_url, '_blank');
                setSuccess(true);
            } else {
                setSuccess(true);
            }

            // Notify parent window
            window.parent.postMessage({
                type: 'VECTRA_REGISTRATION_SUCCESS',
                eventId,
                tier: selectedTier?.name || null,
                price: getCurrentPrice()
            }, '*');

        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const isDark = theme === 'dark';
    const bgColor = isDark ? '#1f2937' : '#ffffff';
    const textColor = isDark ? '#f9fafb' : '#111827';
    const mutedColor = isDark ? '#9ca3af' : '#6b7280';
    const inputBg = isDark ? '#374151' : '#f9fafb';
    const borderColor = isDark ? '#4b5563' : '#e5e7eb';

    if (loading) {
        return (
            <div style={{
                minHeight: '200px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: bgColor,
                color: textColor
            }}>
                <div className="animate-pulse">Chargement...</div>
            </div>
        );
    }

    if (error && !event) {
        return (
            <div style={{
                padding: '24px',
                textAlign: 'center',
                backgroundColor: bgColor,
                color: '#ef4444'
            }}>
                {error}
            </div>
        );
    }

    if (success) {
        return (
            <div style={{
                padding: '32px',
                textAlign: 'center',
                backgroundColor: bgColor,
                color: textColor,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
                <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
                    Inscription confirmée !
                </h3>
                <p style={{ color: mutedColor }}>
                    {getCurrentPrice() > 0
                        ? 'Finalisez votre paiement dans la fenêtre ouverte.'
                        : 'Votre badge arrivera par WhatsApp.'}
                </p>
            </div>
        );
    }

    return (
        <div style={{
            padding: '24px',
            backgroundColor: bgColor,
            color: textColor,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            borderRadius: '12px'
        }}>
            {/* Event Header */}
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
                <h2 style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    marginBottom: '4px',
                    color: textColor
                }}>
                    {event?.title}
                </h2>
                <p style={{ fontSize: '14px', color: mutedColor }}>
                    📅 {event?.date_start ? new Date(event.date_start).toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                    }) : ''}
                </p>
                {event?.location_details && (
                    <p style={{ fontSize: '14px', color: mutedColor }}>
                        📍 {event.location_details}
                    </p>
                )}
            </div>

            {/* Tier Selection */}
            {event?.has_tiers && event.tiers.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                    <label style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: 600,
                        marginBottom: '8px',
                        color: textColor
                    }}>
                        🎫 Formule
                    </label>
                    <select
                        value={selectedTier?.id || ''}
                        onChange={(e) => {
                            const tier = event.tiers.find(t => t.id === parseInt(e.target.value));
                            setSelectedTier(tier || null);
                        }}
                        style={{
                            width: '100%',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            border: `1px solid ${borderColor}`,
                            backgroundColor: inputBg,
                            color: textColor,
                            fontSize: '16px',
                            outline: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        {event.tiers.map(tier => (
                            <option
                                key={tier.id}
                                value={tier.id}
                                disabled={tier.status !== 'available'}
                            >
                                {tier.name} - {parseFloat(tier.price) === 0 ? 'Gratuit' : `${tier.price}€`}
                                {tier.status === 'sold_out' && ' (Complet)'}
                                {tier.status === 'expired' && ' (Expiré)'}
                            </option>
                        ))}
                    </select>
                    {selectedTier?.description && (
                        <p style={{
                            marginTop: '8px',
                            fontSize: '13px',
                            color: mutedColor
                        }}>
                            {selectedTier.description}
                        </p>
                    )}
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <input
                        type="text"
                        placeholder="Nom complet *"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        style={{
                            padding: '12px 16px',
                            borderRadius: '8px',
                            border: `1px solid ${borderColor}`,
                            backgroundColor: inputBg,
                            color: textColor,
                            fontSize: '16px',
                            outline: 'none'
                        }}
                    />

                    <input
                        type="tel"
                        placeholder="Téléphone WhatsApp *"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        style={{
                            padding: '12px 16px',
                            borderRadius: '8px',
                            border: `1px solid ${borderColor}`,
                            backgroundColor: inputBg,
                            color: textColor,
                            fontSize: '16px',
                            outline: 'none'
                        }}
                    />

                    <input
                        type="email"
                        placeholder="Email (optionnel)"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={{
                            padding: '12px 16px',
                            borderRadius: '8px',
                            border: `1px solid ${borderColor}`,
                            backgroundColor: inputBg,
                            color: textColor,
                            fontSize: '16px',
                            outline: 'none'
                        }}
                    />

                    {event?.requires_company_info && (
                        <>
                            <input
                                type="text"
                                placeholder="Entreprise *"
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                required
                                style={{
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    border: `1px solid ${borderColor}`,
                                    backgroundColor: inputBg,
                                    color: textColor,
                                    fontSize: '16px',
                                    outline: 'none'
                                }}
                            />
                            <input
                                type="text"
                                placeholder="Fonction *"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                required
                                style={{
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    border: `1px solid ${borderColor}`,
                                    backgroundColor: inputBg,
                                    color: textColor,
                                    fontSize: '16px',
                                    outline: 'none'
                                }}
                            />
                        </>
                    )}

                    {error && (
                        <div style={{
                            padding: '12px',
                            backgroundColor: '#fef2f2',
                            color: '#dc2626',
                            borderRadius: '8px',
                            fontSize: '14px'
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting || (event?.has_tiers && !selectedTier)}
                        style={{
                            padding: '14px 24px',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: accentColor,
                            color: '#ffffff',
                            fontSize: '16px',
                            fontWeight: 600,
                            cursor: submitting ? 'not-allowed' : 'pointer',
                            opacity: submitting || (event?.has_tiers && !selectedTier) ? 0.7 : 1,
                            transition: 'opacity 0.2s'
                        }}
                    >
                        {submitting ? '⏳ Inscription...' :
                            getCurrentPrice() > 0
                                ? `S'inscrire - ${getCurrentPrice()}€`
                                : "S'inscrire gratuitement"}
                    </button>
                </div>
            </form>

            {/* Powered by */}
            <div style={{
                marginTop: '16px',
                textAlign: 'center',
                fontSize: '11px',
                color: mutedColor
            }}>
                Powered by <a href="https://vectra.io" target="_blank" style={{ color: accentColor }}>Vectra</a>
            </div>
        </div>
    );
}

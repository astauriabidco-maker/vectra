'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function SuccessPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const eventId = params.id as string;
    const ticketId = searchParams.get('ticket');

    const [countdown, setCountdown] = useState(5);

    useEffect(() => {
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-green-900 via-emerald-900 to-teal-900 flex items-center justify-center p-6">
            <div className="max-w-lg w-full">
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 p-10 text-center relative overflow-hidden">
                    {/* Confetti effect */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        {[...Array(20)].map((_, i) => (
                            <div
                                key={i}
                                className="absolute w-2 h-2 rounded-full animate-bounce"
                                style={{
                                    left: `${Math.random() * 100}%`,
                                    top: `${Math.random() * 100}%`,
                                    backgroundColor: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6'][i % 4],
                                    animationDelay: `${Math.random() * 2}s`,
                                    animationDuration: `${1 + Math.random() * 2}s`
                                }}
                            />
                        ))}
                    </div>

                    {/* Success Icon */}
                    <div className="relative z-10">
                        <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30 animate-pulse">
                            <span className="text-5xl">✓</span>
                        </div>

                        <h1 className="text-3xl font-bold text-white mb-3">
                            🎉 Paiement confirmé !
                        </h1>

                        <p className="text-white/70 text-lg mb-6">
                            Merci pour votre inscription !<br />
                            <strong className="text-green-400">Votre badge arrive par WhatsApp</strong> dans quelques instants.
                        </p>

                        {ticketId && (
                            <div className="inline-block px-4 py-2 bg-white/10 rounded-lg mb-6">
                                <span className="text-white/50 text-sm">N° Billet:</span>
                                <span className="text-white font-mono ml-2">#{ticketId}</span>
                            </div>
                        )}

                        <div className="bg-white/5 rounded-2xl p-6 mb-6">
                            <div className="flex items-center justify-center gap-3 text-white/80">
                                <span className="text-3xl">📱</span>
                                <div className="text-left">
                                    <div className="font-semibold">Vérifiez votre WhatsApp</div>
                                    <div className="text-sm text-white/50">Votre badge avec QR Code arrive !</div>
                                </div>
                            </div>
                        </div>

                        <div className="text-white/40 text-sm">
                            Redirection automatique dans {countdown}s...
                        </div>
                    </div>
                </div>

                <div className="mt-6 text-center">
                    <Link
                        href={`/e/${eventId}`}
                        className="text-white/60 hover:text-white underline transition-colors"
                    >
                        ← Retour à l'événement
                    </Link>
                </div>
            </div>
        </div>
    );
}

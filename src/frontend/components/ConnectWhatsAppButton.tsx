'use client'

import { useState, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

declare global {
    interface Window {
        FB: any
        fbAsyncInit: () => void
    }
}

interface ConnectWhatsAppButtonProps {
    onSuccess?: (data: { waba_id: string; phone_number_id: string; display_phone: string }) => void
    onError?: (error: string) => void
}

export default function ConnectWhatsAppButton({ onSuccess, onError }: ConnectWhatsAppButtonProps) {
    const [loading, setLoading] = useState(false)
    const [fbReady, setFbReady] = useState(false)
    const [config, setConfig] = useState<{ facebook_app_id: string | null; facebook_config_id: string | null } | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Fetch public config
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${API_URL}/config/public`)
                if (res.ok) {
                    const data = await res.json()
                    setConfig(data)
                }
            } catch (err) {
                console.error('Failed to fetch config:', err)
            }
        }
        fetchConfig()
    }, [])

    // Load Facebook SDK
    useEffect(() => {
        if (!config?.facebook_app_id) return

        // Check if SDK is already loaded
        if (window.FB) {
            window.FB.init({
                appId: config.facebook_app_id,
                cookie: true,
                xfbml: true,
                version: 'v18.0'
            })
            setFbReady(true)
            return
        }

        // Load SDK
        window.fbAsyncInit = function () {
            window.FB.init({
                appId: config.facebook_app_id,
                cookie: true,
                xfbml: true,
                version: 'v18.0'
            })
            setFbReady(true)
        }

        const script = document.createElement('script')
        script.src = 'https://connect.facebook.net/fr_FR/sdk.js'
        script.async = true
        script.defer = true
        document.body.appendChild(script)

        return () => {
            // Cleanup
            const existingScript = document.querySelector('script[src*="connect.facebook.net"]')
            if (existingScript) {
                existingScript.remove()
            }
        }
    }, [config?.facebook_app_id])

    const handleConnect = useCallback(async () => {
        if (!window.FB || !config?.facebook_config_id) {
            setError('Facebook SDK not initialized or config_id missing')
            return
        }

        setLoading(true)
        setError(null)

        try {
            // Launch Facebook Login with Embedded Signup
            window.FB.login((response: any) => {
                if (response.authResponse) {
                    const code = response.authResponse.code

                    if (!code) {
                        setError('No authorization code received')
                        setLoading(false)
                        return
                    }

                    // Exchange code for WhatsApp access
                    exchangeCode(code)
                } else {
                    setError('Connexion Facebook annulée')
                    setLoading(false)
                }
            }, {
                config_id: config.facebook_config_id,
                response_type: 'code',
                override_default_response_type: true,
                scope: 'business_management,whatsapp_business_management,whatsapp_business_messaging'
            })
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }, [config])

    const exchangeCode = async (code: string) => {
        try {
            const token = localStorage.getItem('token')
            const res = await fetch(`${API_URL}/auth/whatsapp-signup`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || data.details || 'Failed to connect WhatsApp')
            }

            onSuccess?.(data)
        } catch (err: any) {
            setError(err.message)
            onError?.(err.message)
        } finally {
            setLoading(false)
        }
    }

    // Not configured
    if (!config?.facebook_app_id) {
        return (
            <div className="bg-gray-100 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-500">
                    ⚠️ Facebook App non configuré
                </p>
                <p className="text-xs text-gray-400 mt-1">
                    Configurez FACEBOOK_APP_ID et FACEBOOK_CONFIG_ID dans les paramètres système
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <button
                onClick={handleConnect}
                disabled={loading || !fbReady}
                className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-medium transition-all ${loading || !fbReady
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-[#1877F2] hover:bg-[#166FE5] text-white shadow-lg hover:shadow-xl'
                    }`}
            >
                {loading ? (
                    <>
                        <span className="animate-spin text-xl">⏳</span>
                        Connexion en cours...
                    </>
                ) : !fbReady ? (
                    <>
                        <span className="animate-pulse">⏳</span>
                        Chargement du SDK Facebook...
                    </>
                ) : (
                    <>
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm3 8h-1.35c-.538 0-.65.221-.65.778v1.222h2l-.209 2h-1.791v7h-3v-7h-2v-2h2v-2.308c0-1.769.931-2.692 3.029-2.692h1.971v3z" />
                        </svg>
                        Connecter avec Facebook
                    </>
                )}
            </button>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                    ❌ {error}
                </div>
            )}

            <p className="text-xs text-gray-400 text-center">
                En cliquant, vous autoriserez l'accès à votre compte WhatsApp Business
            </p>
        </div>
    )
}

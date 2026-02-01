'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import jsQR from 'jsqr'

export default function ScanPage() {
    const [scanning, setScanning] = useState(false)
    const [manualInput, setManualInput] = useState('')
    const [result, setResult] = useState<{ valid: boolean, message: string, attendee_name?: string, event_title?: string } | null>(null)
    const [loading, setLoading] = useState(false)
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animationRef = useRef<number | null>(null)

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

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

    const handleScan = async (ticketData: string) => {
        if (loading) return
        setLoading(true)
        setResult(null)

        // Stop scanning when processing
        stopCamera()

        try {
            const res = await authFetch(`${API_URL}/tickets/scan`, {
                method: 'POST',
                body: JSON.stringify({
                    qr_code_data: ticketData
                })
            })

            if (res.ok) {
                const data = await res.json()
                setResult(data)

                // Vibrate on success/failure
                if (navigator.vibrate) {
                    navigator.vibrate(data.valid ? [200] : [100, 50, 100, 50, 100])
                }
            } else {
                setResult({ valid: false, message: 'Erreur serveur ❌' })
            }
        } catch (err) {
            setResult({ valid: false, message: 'Erreur réseau ❌' })
        } finally {
            setLoading(false)
        }
    }

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (manualInput.trim()) {
            handleScan(manualInput.trim())
            setManualInput('')
        }
    }

    // Scan QR code from video frame
    const scanFrame = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || !scanning) return

        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')

        if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
            animationRef.current = requestAnimationFrame(scanFrame)
            return
        }

        // Set canvas size to match video
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Get image data for jsQR
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

        // Decode QR code
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
        })

        if (code && code.data) {
            console.log('[Scanner] 🎯 QR Code detected:', code.data)
            handleScan(code.data)
            return // Stop scanning after detection
        }

        // Continue scanning
        animationRef.current = requestAnimationFrame(scanFrame)
    }, [scanning])

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            })

            if (videoRef.current) {
                videoRef.current.srcObject = stream
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current?.play()
                    setScanning(true)
                }
            }
        } catch (err) {
            console.error('Camera access denied', err)
            alert('Impossible d\'accéder à la caméra. Vérifiez les permissions.')
        }
    }

    const stopCamera = () => {
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current)
            animationRef.current = null
        }

        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
            tracks.forEach(track => track.stop())
            videoRef.current.srcObject = null
        }

        setScanning(false)
    }

    // Start scanning loop when camera is active
    useEffect(() => {
        if (scanning) {
            animationRef.current = requestAnimationFrame(scanFrame)
        }

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current)
            }
        }
    }, [scanning, scanFrame])

    // Clean up camera on unmount
    useEffect(() => {
        return () => stopCamera()
    }, [])

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col">
            {/* Header */}
            <header className="bg-gray-800 p-4 flex items-center justify-between safe-area-inset-top">
                <a href="/events" className="text-white flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Retour
                </a>
                <h1 className="text-white font-semibold">🎟️ Scanner Billets</h1>
                <div className="w-16"></div>
            </header>

            {/* Main Content */}
            <main className="flex-1 flex flex-col items-center justify-center p-4">

                {/* Result Display */}
                {result && (
                    <div className={`w-full max-w-sm mb-6 rounded-2xl p-8 text-center transition-all ${result.valid ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                        }`}>
                        <div className="text-8xl mb-4">
                            {result.valid ? '✅' : result.message.includes('⚠️') ? '⚠️' : '❌'}
                        </div>
                        <div className="text-3xl font-bold text-white mb-2">{result.message}</div>
                        {result.attendee_name && (
                            <div className="text-white/90 text-xl mt-4 py-2 px-4 bg-white/20 rounded-lg inline-block">
                                👤 {result.attendee_name}
                            </div>
                        )}
                        {result.event_title && (
                            <div className="text-white/70 text-sm mt-2">{result.event_title}</div>
                        )}
                        <button
                            onClick={() => { setResult(null); startCamera(); }}
                            className="mt-8 px-8 py-3 bg-white text-gray-900 font-bold rounded-xl shadow-lg"
                        >
                            🔄 Scanner un autre billet
                        </button>
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className="w-full max-w-sm mb-6 rounded-2xl p-8 text-center bg-blue-500">
                        <div className="animate-spin text-6xl mb-4">⏳</div>
                        <div className="text-xl font-bold text-white">Vérification...</div>
                    </div>
                )}

                {/* Camera View */}
                {!result && !loading && (
                    <div className="w-full max-w-sm">
                        {scanning ? (
                            <div className="relative">
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full rounded-2xl"
                                />
                                <canvas ref={canvasRef} className="hidden" />

                                {/* Scanner overlay with targeting frame */}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="relative w-56 h-56">
                                        {/* Corner brackets */}
                                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#128C7E] rounded-tl-lg"></div>
                                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#128C7E] rounded-tr-lg"></div>
                                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#128C7E] rounded-bl-lg"></div>
                                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#128C7E] rounded-br-lg"></div>

                                        {/* Scanning line animation */}
                                        <div className="absolute left-4 right-4 h-0.5 bg-red-500 animate-bounce" style={{ top: '50%' }}></div>
                                    </div>
                                </div>

                                <button
                                    onClick={stopCamera}
                                    className="absolute top-4 right-4 p-3 bg-red-500 text-white rounded-full shadow-lg"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>

                                <div className="mt-4 text-center">
                                    <p className="text-white/80 text-sm">
                                        📷 Pointez vers le QR code du billet
                                    </p>
                                    <p className="text-[#128C7E] text-xs mt-1 animate-pulse">
                                        ● Détection automatique active
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <button
                                    onClick={startCamera}
                                    className="w-full py-8 bg-[#128C7E] text-white font-bold text-2xl rounded-2xl hover:bg-[#0a6b5f] flex flex-col items-center justify-center gap-2 shadow-lg"
                                >
                                    <span className="text-5xl">📷</span>
                                    Scanner avec la Caméra
                                </button>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-gray-600"></div>
                                    </div>
                                    <div className="relative flex justify-center">
                                        <span className="bg-gray-900 px-4 text-gray-400 text-sm">ou saisie manuelle</span>
                                    </div>
                                </div>

                                {/* Manual Input */}
                                <form onSubmit={handleManualSubmit} className="space-y-4">
                                    <input
                                        type="text"
                                        value={manualInput}
                                        onChange={(e) => setManualInput(e.target.value)}
                                        placeholder="TICKET-xxxxxxxx-xxxx-..."
                                        className="w-full px-4 py-4 bg-gray-800 text-white border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#128C7E] text-center text-lg font-mono"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!manualInput.trim() || loading}
                                        className="w-full py-4 bg-orange-500 text-white font-bold text-lg rounded-xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        🔍 Vérifier manuellement
                                    </button>
                                </form>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="bg-gray-800 p-4 text-center text-gray-400 text-sm safe-area-inset-bottom">
                🎪 Mode Portier - Contrôle d'accès événementiel
            </footer>
        </div>
    )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import DashboardLayout from '@/components/Layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'

// ============================================
// TYPES
// ============================================
interface Conversation {
    id: string
    contact_name: string
    wa_id: string
    instagram_id?: string
    messenger_id?: string
    last_message_date: string
    status: string
    channel?: 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER'
}

// Channel Badge Component
const getChannelBadge = (channel?: string) => {
    switch (channel) {
        case 'INSTAGRAM':
            return { icon: '🟣', label: 'Instagram', color: 'bg-purple-100 text-purple-700' }
        case 'MESSENGER':
            return { icon: '🔵', label: 'Messenger', color: 'bg-blue-100 text-blue-700' }
        case 'WHATSAPP':
        default:
            return { icon: '🟢', label: 'WhatsApp', color: 'bg-green-100 text-green-700' }
    }
}

interface Message {
    id: string
    direction: 'inbound' | 'outbound'
    type: string
    body: string
    status: string
    created_at: string
}

interface Template {
    id: string
    name: string
    language: string
    meta_status: string
    body_text: string
    variables_count: number
    content?: {
        buttons?: Array<{ type: string }>
    }
}

// ============================================
// API URL
// ============================================
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

// ============================================
// MAIN COMPONENT
// ============================================
export default function InboxPage() {
    const router = useRouter()
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [canReply, setCanReply] = useState(true)
    const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null)
    const [templates, setTemplates] = useState<Template[]>([])
    const [showTemplateSelector, setShowTemplateSelector] = useState(false)
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
    const [templateParams, setTemplateParams] = useState<string[]>([])
    const [userRole, setUserRole] = useState<string | null>(null)
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [loadingSuggestions, setLoadingSuggestions] = useState(false)
    const [productRetailerId, setProductRetailerId] = useState('')

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const socketRef = useRef<Socket | null>(null)

    // ============================================
    // AUTH CHECK & API INTERCEPTOR
    // ============================================
    useEffect(() => {
        const token = localStorage.getItem('token')
        if (!token) {
            router.push('/login')
        }
        // Get user role from localStorage (client-side only)
        setUserRole(localStorage.getItem('role'))
    }, [router])

    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token')
        if (!token) {
            router.push('/login')
            throw new Error('Unauthorized')
        }

        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            }
        })
    }

    const handleLogout = () => {
        localStorage.removeItem('token')
        router.push('/login')
    }

    // ============================================
    // LOAD CONVERSATIONS
    // ============================================
    useEffect(() => {
        const fetchConversations = async () => {
            try {
                const res = await authFetch(`${API_URL}/conversations`)
                if (res.ok) {
                    const data = await res.json()
                    setConversations(data)
                }
            } catch (err) {
                console.error('Failed to fetch conversations:', err)
            }
        }

        fetchConversations()
        // Refresh every 60 seconds as backup (WebSocket handles most updates)
        const interval = setInterval(fetchConversations, 60000)
        return () => clearInterval(interval)
    }, [])

    // ============================================
    // SOCKET.IO CONNECTION
    // ============================================
    useEffect(() => {
        // Connect to Socket.io server
        const socket = io(API_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        })

        socketRef.current = socket

        socket.on('connect', () => {
            console.log('🔌 Socket.io connected:', socket.id)
        })

        socket.on('disconnect', () => {
            console.log('🔌 Socket.io disconnected')
        })

        socket.on('new_message', (message: Message & { conversation_id: string }) => {
            console.log('📨 New message received:', message)

            // Update messages if this is the current conversation
            setMessages(prev => {
                // Only add if it belongs to the selected conversation
                // and not already in the list
                if (message.conversation_id === selectedConversationId) {
                    const exists = prev.some(m => m.id === message.id)
                    if (!exists) {
                        // Play notification sound
                        try {
                            new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEA...').play().catch(() => { })
                        } catch (e) { /* ignore */ }
                        return [...prev, message]
                    }
                }
                return prev
            })

            // Refresh conversations list to update last message time
            authFetch(`${API_URL}/conversations`)
                .then(res => res.ok ? res.json() : [])
                .then(data => setConversations(data))
                .catch(() => { })
        })

        return () => {
            socket.disconnect()
        }
    }, [selectedConversationId])

    // ============================================
    // LOAD MESSAGES FOR SELECTED CONVERSATION
    // ============================================
    useEffect(() => {
        if (!selectedConversationId) {
            setMessages([])
            return
        }

        const fetchMessages = async () => {
            setLoading(true)
            try {
                const res = await authFetch(`${API_URL}/conversations/${selectedConversationId}/messages`)
                if (res.ok) {
                    const data = await res.json()
                    // Handle new API response structure
                    if (data.messages) {
                        setMessages(data.messages)
                        setCanReply(data.meta?.can_reply ?? true)
                        setSessionExpiresAt(data.meta?.expires_at ?? null)
                    } else {
                        // Fallback for old API structure (array)
                        setMessages(data)
                        setCanReply(true)
                    }
                }
            } catch (err) {
                console.error('Failed to fetch messages:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchMessages()
        // WebSocket handles real-time updates, no polling needed
    }, [selectedConversationId])

    // ============================================
    // FETCH AI SUGGESTIONS
    // ============================================
    useEffect(() => {
        if (!selectedConversationId || !canReply) {
            setSuggestions([])
            return
        }

        const fetchSuggestions = async () => {
            setLoadingSuggestions(true)
            try {
                const res = await authFetch(`${API_URL}/suggestions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conversation_id: selectedConversationId })
                })
                if (res.ok) {
                    const data = await res.json()
                    setSuggestions(data.suggestions || [])
                } else {
                    setSuggestions([])
                }
            } catch (err) {
                console.error('Failed to fetch suggestions:', err)
                setSuggestions([])
            } finally {
                setLoadingSuggestions(false)
            }
        }

        fetchSuggestions()
    }, [selectedConversationId, messages.length])

    // ============================================
    // SCROLL TO BOTTOM ON NEW MESSAGES
    // ============================================
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // ============================================
    // SEND MESSAGE
    // ============================================
    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedConversationId || sending) return

        setSending(true)
        try {
            const res = await authFetch(`${API_URL}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: selectedConversationId,
                    message_body: newMessage.trim(),
                }),
            })

            if (res.ok) {
                setNewMessage('')
                // Refresh messages
                const msgRes = await authFetch(`${API_URL}/conversations/${selectedConversationId}/messages`)
                if (msgRes.ok) {
                    const data = await msgRes.json()
                    if (data.messages) {
                        setMessages(data.messages)
                    } else {
                        setMessages(data)
                    }
                }
            }
        } catch (err) {
            console.error('Failed to send message:', err)
        } finally {
            setSending(false)
        }
    }

    // ============================================
    // SEND TEMPLATE
    // ============================================
    const handleSendTemplate = async () => {
        if (!selectedConversationId || sending || !selectedTemplate) return

        setSending(true)
        try {
            const res = await authFetch(`${API_URL}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: selectedConversationId,
                    type: 'template',
                    template_name: selectedTemplate.name,
                    template_language: selectedTemplate.language,
                    params: templateParams.length > 0 ? templateParams : undefined,
                    product_retailer_id: productRetailerId || undefined,
                }),
            })

            if (res.ok) {
                setShowTemplateSelector(false)
                setSelectedTemplate(null)
                setTemplateParams([])
                setProductRetailerId('')
                // Refresh messages
                const msgRes = await authFetch(`${API_URL}/conversations/${selectedConversationId}/messages`)
                if (msgRes.ok) {
                    const data = await msgRes.json()
                    if (data.messages) {
                        setMessages(data.messages)
                        setCanReply(data.meta?.can_reply ?? true)
                    }
                }
            }
        } catch (err) {
            console.error('Failed to send template:', err)
        } finally {
            setSending(false)
        }
    }

    const selectTemplate = (tpl: Template) => {
        setSelectedTemplate(tpl)
        // Initialize empty params array based on variables_count
        setTemplateParams(new Array(tpl.variables_count).fill(''))
        // Reset product ID
        setProductRetailerId('')
    }

    // Update a specific template parameter
    const updateTemplateParam = (index: number, value: string) => {
        const newParams = [...templateParams]
        newParams[index] = value
        setTemplateParams(newParams)
    }

    // ============================================
    // FETCH TEMPLATES
    // ============================================
    const fetchTemplates = async () => {
        try {
            const res = await authFetch(`${API_URL}/templates`)
            if (res.ok) {
                const data = await res.json()
                setTemplates(data)
                setShowTemplateSelector(true)
            }
        } catch (err) {
            console.error('Failed to fetch templates:', err)
        }
    }

    // ============================================
    // FORMAT DATE
    // ============================================
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    }

    const formatDateFull = (dateStr: string) => {
        const date = new Date(dateStr)
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    // ============================================
    // RENDER
    // ============================================
    return (
        <DashboardLayout>
            <div className="flex h-[calc(100vh-4rem-3rem)] bg-white rounded-xl shadow-sm overflow-hidden">
                {/* ============================================ */}
                {/* LEFT COLUMN - CONVERSATIONS LIST (30%) */}
                {/* ============================================ */}
                <div className="w-[30%] border-r border-gray-200 flex flex-col">
                    {/* Conversations Header */}
                    <div className="bg-gradient-to-r from-[#075E54] to-[#128C7E] px-4 py-3">
                        <h2 className="text-white text-lg font-semibold flex items-center gap-2">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            Conversations
                        </h2>
                    </div>

                    {/* Conversations List */}
                    <div className="flex-1 overflow-y-auto">
                        {conversations.length === 0 ? (
                            <div className="p-4 text-center text-gray-500">
                                Aucune conversation
                            </div>
                        ) : (
                            conversations.map((conv) => (
                                <div
                                    key={conv.id}
                                    onClick={() => setSelectedConversationId(conv.id)}
                                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${selectedConversationId === conv.id ? 'bg-gray-100' : ''
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        {/* Avatar */}
                                        <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-white font-semibold">
                                            {(conv.contact_name || conv.wa_id).charAt(0).toUpperCase()}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center">
                                                <span className="font-medium truncate flex items-center gap-1.5">
                                                    <span title={getChannelBadge(conv.channel).label}>
                                                        {getChannelBadge(conv.channel).icon}
                                                    </span>
                                                    {conv.contact_name || conv.wa_id || conv.instagram_id || conv.messenger_id}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {conv.last_message_date ? formatDate(conv.last_message_date) : ''}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-sm text-gray-500 truncate">
                                                    {conv.wa_id}
                                                </span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${conv.status === 'open'
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                    {conv.status}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* ============================================ */}
                {/* RIGHT COLUMN - CHAT AREA (70%) */}
                {/* ============================================ */}
                <div className="w-[70%] flex flex-col bg-[#e5ddd5]" style={{
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="none" fill-rule="evenodd"%3E%3Cg fill="%239C92AC" fill-opacity="0.05"%3E%3Cpath d="M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
                }}>
                    {!selectedConversationId ? (
                        /* No conversation selected */
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-gray-500">
                                <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                <p className="text-lg font-medium">Sélectionnez une conversation</p>
                                <p className="text-sm mt-1">Choisissez un contact pour voir les messages</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Chat Header */}
                            <div className="bg-[#ededed] px-4 py-3 border-b border-gray-200 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gray-400 flex items-center justify-center text-white font-semibold">
                                    {(conversations.find(c => c.id === selectedConversationId)?.contact_name || '?').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <p className="font-medium">
                                        {conversations.find(c => c.id === selectedConversationId)?.contact_name ||
                                            conversations.find(c => c.id === selectedConversationId)?.wa_id}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {conversations.find(c => c.id === selectedConversationId)?.wa_id}
                                    </p>
                                </div>
                                <div className="ml-auto">
                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${canReply
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-red-100 text-red-700'
                                        }`}>
                                        {canReply ? 'Session Active' : 'Session Expirée'}
                                    </span>
                                </div>
                            </div>

                            {/* Messages Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                {loading ? (
                                    <div className="text-center text-gray-500">Chargement...</div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center text-gray-500">Aucun message</div>
                                ) : (
                                    messages.map((msg) => {
                                        // Parse media content if JSON
                                        let mediaContent: { media_id?: string; caption?: string; mime_type?: string; filename?: string } | null = null;
                                        const isMediaType = ['image', 'video', 'audio', 'voice', 'document', 'sticker'].includes(msg.type);

                                        if (isMediaType && msg.body) {
                                            try {
                                                mediaContent = JSON.parse(msg.body);
                                            } catch {
                                                mediaContent = null;
                                            }
                                        }

                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                                            >
                                                <div
                                                    className={`max-w-[65%] px-3 py-2 rounded-lg shadow-sm ${msg.direction === 'outbound'
                                                        ? 'bg-[#dcf8c6] rounded-br-none'
                                                        : 'bg-white rounded-bl-none'
                                                        }`}
                                                >
                                                    {/* Image Message */}
                                                    {msg.type === 'image' && mediaContent?.media_id && (
                                                        <div className="mb-2">
                                                            <img
                                                                src={`${API_URL}/media/${mediaContent.media_id}`}
                                                                alt="Image"
                                                                className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                                                                style={{ maxHeight: '300px' }}
                                                                onClick={() => window.open(`${API_URL}/media/${mediaContent?.media_id}`, '_blank')}
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                    (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="text-gray-400 text-sm">📷 Image non disponible</div>';
                                                                }}
                                                            />
                                                            {mediaContent.caption && (
                                                                <p className="text-sm mt-1 whitespace-pre-wrap break-words">{mediaContent.caption}</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Video Message */}
                                                    {msg.type === 'video' && mediaContent?.media_id && (
                                                        <div className="mb-2">
                                                            <video
                                                                src={`${API_URL}/media/${mediaContent.media_id}`}
                                                                controls
                                                                className="max-w-full rounded-lg"
                                                                style={{ maxHeight: '300px' }}
                                                            />
                                                            {mediaContent.caption && (
                                                                <p className="text-sm mt-1 whitespace-pre-wrap break-words">{mediaContent.caption}</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Audio/Voice Message */}
                                                    {(msg.type === 'audio' || msg.type === 'voice') && mediaContent?.media_id && (
                                                        <div className="mb-2">
                                                            <audio
                                                                src={`${API_URL}/media/${mediaContent.media_id}`}
                                                                controls
                                                                className="max-w-full"
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Document Message */}
                                                    {msg.type === 'document' && mediaContent?.media_id && (
                                                        <div className="mb-2">
                                                            <a
                                                                href={`${API_URL}/media/${mediaContent.media_id}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-center gap-2 text-blue-600 hover:underline"
                                                            >
                                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                                                </svg>
                                                                <span className="text-sm">{mediaContent.filename || 'Document'}</span>
                                                            </a>
                                                            {mediaContent.caption && (
                                                                <p className="text-sm mt-1 whitespace-pre-wrap break-words">{mediaContent.caption}</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Sticker Message */}
                                                    {msg.type === 'sticker' && mediaContent?.media_id && (
                                                        <div className="mb-2">
                                                            <img
                                                                src={`${API_URL}/media/${mediaContent.media_id}`}
                                                                alt="Sticker"
                                                                className="max-w-[150px] max-h-[150px]"
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Text Message (or fallback) */}
                                                    {msg.type === 'text' && msg.body && (
                                                        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                                                    )}

                                                    {/* Unsupported type fallback */}
                                                    {!isMediaType && msg.type !== 'text' && (
                                                        <p className="text-sm text-gray-500 italic">[{msg.type}]</p>
                                                    )}

                                                    <div className="flex items-center justify-end gap-1 mt-1">
                                                        <span className="text-[10px] text-gray-500">
                                                            {formatDate(msg.created_at)}
                                                        </span>
                                                        {msg.direction === 'outbound' && (
                                                            <span className="text-[10px]">
                                                                {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="bg-[#f0f0f0] px-4 py-3 flex flex-col gap-3">
                                {!canReply && !showTemplateSelector && (
                                    <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex flex-col gap-3">
                                        <div className="text-xs text-red-600 flex items-center gap-2">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            La fenêtre de 24h est fermée. Le client doit répondre ou vous devez envoyer un Template.
                                        </div>
                                        <button
                                            onClick={fetchTemplates}
                                            className="bg-[#128C7E] hover:bg-[#075E54] text-white py-2 px-4 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            Relancer la conversation (Template)
                                        </button>
                                    </div>
                                )}

                                {showTemplateSelector && (
                                    <div className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
                                        <div className="flex justify-between items-center mb-3">
                                            <h3 className="font-semibold text-sm">
                                                {selectedTemplate ? `Template: ${selectedTemplate.name}` : 'Sélectionner un Template'}
                                            </h3>
                                            <button
                                                onClick={() => {
                                                    setShowTemplateSelector(false)
                                                    setSelectedTemplate(null)
                                                    setTemplateParams([])
                                                }}
                                                className="text-gray-400 hover:text-gray-600"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>

                                        {/* Template Selection List */}
                                        {!selectedTemplate && (
                                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                                {templates.length === 0 ? (
                                                    <p className="text-xs text-gray-500 text-center py-2">Aucun template disponible</p>
                                                ) : (
                                                    templates.filter(t => t.meta_status === 'APPROVED').map(tpl => (
                                                        <div
                                                            key={tpl.id}
                                                            onClick={() => selectTemplate(tpl)}
                                                            className="border border-gray-100 p-3 rounded-lg hover:bg-green-50 hover:border-green-200 cursor-pointer transition-all group"
                                                        >
                                                            <div className="flex justify-between items-center group-hover:text-green-700">
                                                                <span className="text-sm font-medium">{tpl.name}</span>
                                                                <div className="flex items-center gap-2">
                                                                    {tpl.variables_count > 0 && (
                                                                        <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">
                                                                            {tpl.variables_count} var
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{tpl.language}</span>
                                                                </div>
                                                            </div>
                                                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tpl.body_text || 'No preview'}</p>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}

                                        {/* Template Variables Form */}
                                        {selectedTemplate && (
                                            <div className="space-y-3">
                                                {/* Template Preview */}
                                                <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600 border border-gray-100">
                                                    {selectedTemplate.body_text || 'Template content'}
                                                </div>

                                                {/* Variable Inputs */}
                                                {selectedTemplate.variables_count > 0 && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs text-gray-500 font-medium">Variables à compléter:</p>
                                                        {Array.from({ length: selectedTemplate.variables_count }).map((_, idx) => (
                                                            <div key={idx} className="flex items-center gap-2">
                                                                <label className="text-xs text-gray-500 w-20">
                                                                    {`{{${idx + 1}}}`}
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={templateParams[idx] || ''}
                                                                    onChange={(e) => updateTemplateParam(idx, e.target.value)}
                                                                    placeholder={`Variable ${idx + 1}`}
                                                                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-200 focus:border-green-300"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Action Buttons */}
                                                {/* Product ID for Catalog Templates */}
                                                {selectedTemplate.content?.buttons?.some(btn => btn.type === 'CATALOG') && (
                                                    <div className="space-y-2 bg-amber-50 p-3 rounded-lg border border-amber-200">
                                                        <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                                                            🛒 Template avec Catalogue Produit
                                                        </p>
                                                        <input
                                                            type="text"
                                                            value={productRetailerId}
                                                            onChange={(e) => setProductRetailerId(e.target.value)}
                                                            placeholder="ID du Produit (Thumbnail SKU) - ex: pizza_marg_01"
                                                            className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 bg-white"
                                                        />
                                                        <p className="text-xs text-amber-600">
                                                            L'ID du produit de votre catalogue Meta Commerce Manager sera affiché comme vignette.
                                                        </p>
                                                    </div>
                                                )}

                                                <div className="flex gap-2 pt-2">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedTemplate(null)
                                                            setTemplateParams([])
                                                        }}
                                                        className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                                                    >
                                                        Retour
                                                    </button>
                                                    <button
                                                        onClick={handleSendTemplate}
                                                        disabled={
                                                            sending ||
                                                            (selectedTemplate.variables_count > 0 && templateParams.some(p => !p.trim())) ||
                                                            (selectedTemplate.content?.buttons?.some(btn => btn.type === 'CATALOG') && !productRetailerId.trim())
                                                        }
                                                        className={`flex-1 py-2 text-sm text-white rounded-lg font-medium transition-all ${sending ||
                                                            (selectedTemplate.variables_count > 0 && templateParams.some(p => !p.trim())) ||
                                                            (selectedTemplate.content?.buttons?.some(btn => btn.type === 'CATALOG') && !productRetailerId.trim())
                                                            ? 'bg-gray-300 cursor-not-allowed'
                                                            : 'bg-[#128C7E] hover:bg-[#075E54]'
                                                            }`}
                                                    >
                                                        {sending ? 'Envoi...' : 'Envoyer'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {canReply && !showTemplateSelector && (
                                    <div className="flex flex-col gap-2">
                                        {/* AI Suggestions */}
                                        {suggestions.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                                    </svg>
                                                    IA:
                                                </span>
                                                {suggestions.map((suggestion, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => setNewMessage(suggestion)}
                                                        className="px-3 py-1.5 bg-white hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-full text-xs text-gray-700 hover:text-green-700 transition-all shadow-sm truncate max-w-[200px]"
                                                        title={suggestion}
                                                    >
                                                        {suggestion.length > 40 ? suggestion.substring(0, 40) + '...' : suggestion}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {loadingSuggestions && (
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                Génération de suggestions...
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2">
                                            {/* Template Button */}
                                            <button
                                                onClick={fetchTemplates}
                                                title="Envoyer un template"
                                                className="w-10 h-10 rounded-full flex items-center justify-center bg-white hover:bg-gray-100 text-gray-600 transition-all shadow-sm"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            </button>
                                            <input
                                                type="text"
                                                value={newMessage}
                                                onChange={(e) => setNewMessage(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                                placeholder="Tapez un message..."
                                                className="flex-1 px-4 py-2 rounded-full border-none outline-none text-sm shadow-sm"
                                            />
                                            <button
                                                onClick={handleSendMessage}
                                                disabled={sending || !newMessage.trim()}
                                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-sm ${sending || !newMessage.trim()
                                                    ? 'bg-gray-300 cursor-not-allowed'
                                                    : 'bg-[#128C7E] hover:bg-[#075E54] text-white active:scale-95'
                                                    }`}
                                            >
                                                <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </DashboardLayout>
    )
}

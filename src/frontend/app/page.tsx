'use client'

import { useState, useEffect, useRef } from 'react'

// ============================================
// TYPES
// ============================================
interface Conversation {
    id: string
    contact_name: string
    wa_id: string
    last_message_date: string
    status: string
}

interface Message {
    id: string
    direction: 'inbound' | 'outbound'
    type: string
    body: string
    status: string
    created_at: string
}

// ============================================
// API URL
// ============================================
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

// ============================================
// MAIN COMPONENT
// ============================================
export default function InboxPage() {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // ============================================
    // LOAD CONVERSATIONS
    // ============================================
    useEffect(() => {
        const fetchConversations = async () => {
            try {
                const res = await fetch(`${API_URL}/conversations`)
                if (res.ok) {
                    const data = await res.json()
                    setConversations(data)
                }
            } catch (err) {
                console.error('Failed to fetch conversations:', err)
            }
        }

        fetchConversations()
        // Refresh every 5 seconds
        const interval = setInterval(fetchConversations, 5000)
        return () => clearInterval(interval)
    }, [])

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
                const res = await fetch(`${API_URL}/conversations/${selectedConversationId}/messages`)
                if (res.ok) {
                    const data = await res.json()
                    setMessages(data)
                }
            } catch (err) {
                console.error('Failed to fetch messages:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchMessages()
        // Refresh messages every 3 seconds
        const interval = setInterval(fetchMessages, 3000)
        return () => clearInterval(interval)
    }, [selectedConversationId])

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
            const res = await fetch(`${API_URL}/messages`, {
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
                const msgRes = await fetch(`${API_URL}/conversations/${selectedConversationId}/messages`)
                if (msgRes.ok) {
                    const data = await msgRes.json()
                    setMessages(data)
                }
            }
        } catch (err) {
            console.error('Failed to send message:', err)
        } finally {
            setSending(false)
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
        <div className="flex h-screen">
            {/* ============================================ */}
            {/* LEFT COLUMN - CONVERSATIONS LIST (30%) */}
            {/* ============================================ */}
            <div className="w-[30%] bg-white border-r border-gray-200 flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#075E54] to-[#128C7E] px-4 py-4">
                    <h1 className="text-white text-xl font-semibold flex items-center gap-2">
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        WhatsApp Hub
                    </h1>
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
                                            <span className="font-medium truncate">
                                                {conv.contact_name || conv.wa_id}
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
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {loading ? (
                                <div className="text-center text-gray-500">Chargement...</div>
                            ) : messages.length === 0 ? (
                                <div className="text-center text-gray-500">Aucun message</div>
                            ) : (
                                messages.map((msg) => (
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
                                            <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
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
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="bg-[#f0f0f0] px-4 py-3 flex items-center gap-3">
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                placeholder="Tapez un message..."
                                className="flex-1 px-4 py-2 rounded-full border-none outline-none text-sm"
                            />
                            <button
                                onClick={handleSendMessage}
                                disabled={sending || !newMessage.trim()}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${sending || !newMessage.trim()
                                        ? 'bg-gray-300 cursor-not-allowed'
                                        : 'bg-[#128C7E] hover:bg-[#075E54] text-white'
                                    }`}
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                </svg>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

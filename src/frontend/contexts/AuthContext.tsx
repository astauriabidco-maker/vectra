'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

interface User {
    id: string
    email: string
    role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT'
}

interface Tenant {
    id: string
    name: string
}

interface AuthContextType {
    user: User | null
    tenant: Tenant | null
    loading: boolean
    logout: () => void
    refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [loading, setLoading] = useState(true)
    const router = useRouter()

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

    const refreshAuth = async () => {
        const token = localStorage.getItem('token')
        if (!token) {
            setUser(null)
            setTenant(null)
            setLoading(false)
            return
        }

        try {
            const res = await fetch(`${API_URL}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (res.ok) {
                const data = await res.json()
                setUser(data.user)
                setTenant(data.tenant)
            } else {
                // Token invalide
                localStorage.removeItem('token')
                setUser(null)
                setTenant(null)
            }
        } catch (err) {
            console.error('Auth refresh failed:', err)
            setUser(null)
            setTenant(null)
        } finally {
            setLoading(false)
        }
    }

    const logout = () => {
        localStorage.removeItem('token')
        setUser(null)
        setTenant(null)
        router.push('/login')
    }

    useEffect(() => {
        refreshAuth()
    }, [])

    return (
        <AuthContext.Provider value={{ user, tenant, loading, logout, refreshAuth }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}

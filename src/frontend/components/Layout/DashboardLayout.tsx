'use client'

import { ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import ComplianceHealthWidget from '@/components/ComplianceHealthWidget'

interface DashboardLayoutProps {
    children: ReactNode
}

const navItems = [
    { href: '/', icon: '💬', label: 'Chat' },
    { href: '/contacts', icon: '📇', label: 'Contacts CRM' },
    { href: '/campaigns', icon: '📢', label: 'Campagnes' },
    { href: '/templates', icon: '📄', label: 'Templates' },
    { href: '/events', icon: '🎟️', label: 'Événements' },
    { href: '/automations', icon: '🤖', label: 'Automations' },
    { href: '/compliance', icon: '🛡️', label: 'Conformité' },
    { href: '/ai-config', icon: '🧠', label: 'Intelligence Artificielle' },
]

const adminItems = [
    { href: '/admin', icon: '⚙️', label: 'Administration' },
    { href: '/admin/settings', icon: '🔧', label: 'Configuration' },
]

export default function DashboardLayout({ children }: DashboardLayoutProps) {
    const { user, tenant, loading, logout } = useAuth()
    const router = useRouter()
    const pathname = usePathname()

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#128C7E]"></div>
            </div>
        )
    }

    if (!user || !tenant) {
        router.push('/login')
        return null
    }

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'SUPER_ADMIN': return 'bg-purple-100 text-purple-800'
            case 'ADMIN': return 'bg-blue-100 text-blue-800'
            case 'AGENT': return 'bg-gray-100 text-gray-800'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    const getTenantEmoji = (name: string) => {
        if (name.toLowerCase().includes('pizza')) return '🍕'
        if (name.toLowerCase().includes('demo')) return '🏢'
        return '🏪'
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 flex flex-col fixed h-full z-10">
                {/* Tenant Header */}
                <div className="p-6 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{getTenantEmoji(tenant.name)}</span>
                        <div>
                            <h1 className="font-bold text-gray-900 text-lg leading-tight">{tenant.name}</h1>
                            <span className="text-xs text-gray-400">WhatsApp Hub</span>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-1">
                    {navItems.map((item) => (
                        <button
                            key={item.href}
                            onClick={() => router.push(item.href)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${pathname === item.href
                                ? 'bg-[#128C7E]/10 text-[#128C7E] font-semibold'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                }`}
                        >
                            <span className="text-xl">{item.icon}</span>
                            <span className="text-sm">{item.label}</span>
                        </button>
                    ))}

                    {/* Admin items - only for SUPER_ADMIN */}
                    {user.role === 'SUPER_ADMIN' && (
                        <>
                            <div className="pt-4 pb-2">
                                <span className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Admin</span>
                            </div>
                            {adminItems.map((item) => (
                                <button
                                    key={item.href}
                                    onClick={() => router.push(item.href)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${pathname === item.href
                                        ? 'bg-purple-50 text-purple-700 font-semibold'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                        }`}
                                >
                                    <span className="text-xl">{item.icon}</span>
                                    <span className="text-sm">{item.label}</span>
                                </button>
                            ))}
                        </>
                    )}
                </nav>

                {/* Logout Button */}
                <div className="p-4 border-t border-gray-100">
                    <button
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        <span className="text-sm font-medium">Déconnexion</span>
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 ml-64">
                {/* Header with Compliance Widget */}
                <header className="h-auto min-h-[4rem] bg-white border-b border-gray-200 px-6 py-3 sticky top-0 z-10">
                    <div className="flex items-center justify-between gap-4">
                        {/* Compliance Health Widget */}
                        <div className="flex-1 max-w-2xl">
                            <ComplianceHealthWidget />
                        </div>

                        {/* User Card */}
                        <div className="flex items-center gap-3">
                            <div className="text-right">
                                <p className="text-sm font-medium text-gray-700">{user.email}</p>
                            </div>
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                                {user.role}
                            </span>
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#128C7E] to-[#25D366] flex items-center justify-center text-white font-bold text-sm">
                                {user.email.charAt(0).toUpperCase()}
                            </div>
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <main className="p-6">
                    {children}
                </main>
            </div>
        </div>
    )
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import {
    MessageSquare,
    Users,
    Settings,
    Plug,
    LayoutDashboard,
    Sparkles,
    Menu,
    X
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navigation = [
    {
        name: 'Inbox',
        href: '/dashboard',
        icon: MessageSquare,
        description: 'Conversations WhatsApp',
    },
    {
        name: 'Customers',
        href: '/customers',
        icon: Users,
        description: 'Gestion des clients',
    },
    {
        name: 'Integrations',
        href: '/settings/integrations',
        icon: Plug,
        description: 'Twilio, Gemini AI',
    },
];

export function AppSidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return <div className="h-screen w-16 border-r bg-background" />; // Simplified skeleton
    }

    return (
        <div className={cn(
            "h-screen border-r bg-gradient-to-b from-background to-muted/30 flex flex-col transition-all duration-300",
            collapsed ? "w-16" : "w-64"
        )}>
            {/* Header */}
            <div className="p-4 border-b bg-background/50 backdrop-blur-sm flex items-center justify-between">
                {!collapsed && (
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center">
                            <span className="text-white font-bold text-sm">V</span>
                        </div>
                        <span className="font-bold text-xl bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">
                            Vectra
                        </span>
                    </div>
                )}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                    {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-1">
                {navigation.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                        <Link key={item.name} href={item.href}>
                            <div className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
                                isActive
                                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}>
                                <item.icon className={cn(
                                    "h-5 w-5 flex-shrink-0",
                                    isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                                )} />
                                {!collapsed && (
                                    <div className="flex-1 min-w-0">
                                        <p className={cn(
                                            "text-sm font-medium truncate",
                                            isActive ? "text-primary-foreground" : ""
                                        )}>
                                            {item.name}
                                        </p>
                                        <p className={cn(
                                            "text-[10px] truncate",
                                            isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                                        )}>
                                            {item.description}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </nav>

            {/* AI Copilot Badge */}
            {!collapsed && (
                <div className="mx-3 mb-3 p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/20">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-500" />
                        <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                            AI Copilot Active
                        </span>
                    </div>
                </div>
            )}

            {/* User */}
            <div className="p-4 border-t bg-background/50">
                <div className={cn(
                    "flex items-center gap-3",
                    collapsed ? "justify-center" : ""
                )}>
                    <UserButton afterSignOutUrl="/" />
                    {!collapsed && (
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">Mon compte</p>
                            <p className="text-xs text-muted-foreground">Gérer le profil</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

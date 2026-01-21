import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'WhatsApp Hub - Shared Inbox',
    description: 'Multi-tenant WhatsApp communication platform',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="fr">
            <body className="bg-gray-100 text-gray-900 antialiased">
                {children}
            </body>
        </html>
    )
}

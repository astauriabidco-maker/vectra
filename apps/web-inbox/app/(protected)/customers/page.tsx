'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CustomerForm } from '@/components/customer-form';
import { getCustomers, Customer } from '@/lib/api';
import { UserButton } from '@clerk/nextjs';
import { Users, MessageSquare, Plus, Building2, Mail, Phone, Loader2, MessageCircle } from 'lucide-react';

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function loadCustomers() {
        setIsLoading(true);
        try {
            const data = await getCustomers();
            setCustomers(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load customers');
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        loadCustomers();
    }, []);

    function handleCustomerCreated() {
        setShowForm(false);
        loadCustomers();
    }

    return (
        <div className="flex h-screen bg-background font-sans antialiased text-foreground">
            {/* Sidebar Navigation */}
            <div className="w-64 border-r bg-muted/30 flex flex-col">
                <div className="p-6 border-b bg-background/50 backdrop-blur-sm">
                    <span className="font-bold text-xl">Vectra</span>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <Link href="/dashboard">
                        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                            <MessageSquare className="h-5 w-5" />
                            <span>Inbox</span>
                        </div>
                    </Link>
                    <Link href="/customers">
                        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-accent text-foreground font-medium">
                            <Users className="h-5 w-5" />
                            <span>Customers</span>
                        </div>
                    </Link>
                </nav>
                <div className="p-4 border-t">
                    <div className="flex items-center gap-3">
                        <UserButton afterSignOutUrl="/" />
                        <span className="text-sm text-muted-foreground">Account</span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <div className="p-6 border-b bg-background/80 backdrop-blur-md flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Customers</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Manage your customer relationships
                        </p>
                    </div>
                    <Button onClick={() => setShowForm(true)} className="gap-2">
                        <Plus className="h-4 w-4" />
                        New Customer
                    </Button>
                </div>

                {/* Customer List */}
                <ScrollArea className="flex-1 p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : error ? (
                        <Card className="p-6 text-center">
                            <p className="text-red-500">{error}</p>
                            <Button onClick={loadCustomers} variant="outline" className="mt-4">
                                Try Again
                            </Button>
                        </Card>
                    ) : customers.length === 0 ? (
                        <Card className="p-12 text-center">
                            <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                            <h3 className="text-lg font-medium mb-2">No customers yet</h3>
                            <p className="text-muted-foreground mb-6">
                                Start by adding your first customer
                            </p>
                            <Button onClick={() => setShowForm(true)} className="gap-2">
                                <Plus className="h-4 w-4" />
                                Add Customer
                            </Button>
                        </Card>
                    ) : (
                        <div className="grid gap-4">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-muted-foreground">
                                <div className="col-span-3">Name</div>
                                <div className="col-span-3">Email</div>
                                <div className="col-span-2">Company</div>
                                <div className="col-span-2">Phone</div>
                                <div className="col-span-2">Tags</div>
                            </div>

                            {/* Customer Rows */}
                            {customers.map((customer) => (
                                <Card
                                    key={customer.id}
                                    className="grid grid-cols-12 gap-4 px-4 py-4 items-center hover:bg-accent/50 transition-colors cursor-pointer"
                                >
                                    <div className="col-span-3 flex items-center gap-3">
                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${!customer.email && customer.phone ? 'bg-emerald-500/10' : 'bg-primary/10'}`}>
                                            {!customer.email && customer.phone ? (
                                                <MessageCircle className="h-5 w-5 text-emerald-500" />
                                            ) : (
                                                <span className="text-primary font-medium">
                                                    {(customer.name || customer.email || customer.phone || '?').charAt(0).toUpperCase()}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium truncate">
                                                {customer.name || 'No name'}
                                            </span>
                                            {!customer.email && customer.phone && (
                                                <span className="text-xs text-emerald-500 flex items-center gap-1">
                                                    <MessageCircle className="h-3 w-3" /> WhatsApp
                                                </span>
                                            )}
                                            {customer.workspace && (
                                                <span className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                                    <span className="font-semibold text-gray-700">{customer.workspace.tenantOrg?.name}</span>
                                                    <span className="text-gray-300">•</span>
                                                    <span>{customer.workspace.name}</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="col-span-3 flex items-center gap-2 text-muted-foreground">
                                        {customer.email ? (
                                            <>
                                                <Mail className="h-4 w-4 flex-shrink-0" />
                                                <span className="truncate">{customer.email}</span>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground/50 italic">No email</span>
                                        )}
                                    </div>
                                    <div className="col-span-2 flex items-center gap-2 text-muted-foreground">
                                        {customer.company ? (
                                            <>
                                                <Building2 className="h-4 w-4 flex-shrink-0" />
                                                <span className="truncate">{customer.company}</span>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground/50">—</span>
                                        )}
                                    </div>
                                    <div className={`col-span-2 flex items-center gap-2 ${!customer.email && customer.phone ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}`}>
                                        {customer.phone ? (
                                            <>
                                                {!customer.email ? (
                                                    <MessageCircle className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                                                ) : (
                                                    <Phone className="h-4 w-4 flex-shrink-0" />
                                                )}
                                                <span className="truncate">{customer.phone}</span>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground/50">—</span>
                                        )}
                                    </div>
                                    <div className="col-span-2 flex gap-1 flex-wrap">
                                        {customer.tags && customer.tags.length > 0 ? (
                                            customer.tags.slice(0, 2).map((tag, i) => (
                                                <span
                                                    key={i}
                                                    className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
                                                >
                                                    {tag}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-muted-foreground/50">—</span>
                                        )}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Create Customer Modal */}
            {showForm && (
                <CustomerForm
                    onSuccess={handleCustomerCreated}
                    onCancel={() => setShowForm(false)}
                />
            )}
        </div>
    );
}

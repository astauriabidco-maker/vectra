// API Client for Vectra Backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7070';

export interface Customer {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    company: string | null;
    notes: string | null;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    workspace?: {
        id: string;
        name: string;
        tenantOrg?: {
            id: string;
            name: string;
        };
    };
}

export interface CreateCustomerData {
    phone: string;  // Required - Phone-First CRM
    email?: string; // Optional
    name?: string;
    company?: string;
    notes?: string;
    tags?: string[];
}

export async function getCustomers(): Promise<Customer[]> {
    const response = await fetch(`${API_URL}/customers`, {
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch customers');
    }
    return response.json();
}

export async function createCustomer(data: CreateCustomerData): Promise<Customer> {
    const response = await fetch(`${API_URL}/customers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        throw new Error('Failed to create customer');
    }
    return response.json();
}

export async function getCustomerById(id: string): Promise<Customer> {
    const response = await fetch(`${API_URL}/customers/${id}`, {
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch customer');
    }
    return response.json();
}

export async function deleteCustomer(id: string): Promise<void> {
    const response = await fetch(`${API_URL}/customers/${id}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error('Failed to delete customer');
    }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt, maskSecret } from '../common/encryption';

// Fields that should be encrypted when storing
const SENSITIVE_FIELDS = ['authToken', 'auth_token', 'apiKey', 'api_key', 'secret'];

export interface IntegrationCredentials {
    accountSid?: string;
    authToken?: string;
    phoneNumber?: string;
    [key: string]: string | undefined;
}

@Injectable()
export class IntegrationsService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Encrypt sensitive fields in credentials object
     */
    private encryptCredentials(credentials: IntegrationCredentials): IntegrationCredentials {
        const encrypted: IntegrationCredentials = { ...credentials };
        for (const field of SENSITIVE_FIELDS) {
            if (encrypted[field]) {
                encrypted[field] = encrypt(encrypted[field] as string);
            }
        }
        return encrypted;
    }

    /**
     * Decrypt sensitive fields in credentials object
     */
    private decryptCredentials(credentials: IntegrationCredentials): IntegrationCredentials {
        const decrypted: IntegrationCredentials = { ...credentials };
        for (const field of SENSITIVE_FIELDS) {
            if (decrypted[field]) {
                try {
                    decrypted[field] = decrypt(decrypted[field] as string);
                } catch (e) {
                    // If decryption fails, field might not be encrypted
                    console.warn(`Could not decrypt field ${field}`);
                }
            }
        }
        return decrypted;
    }

    /**
     * Mask sensitive fields for display
     */
    private maskCredentials(credentials: IntegrationCredentials): IntegrationCredentials {
        const masked: IntegrationCredentials = { ...credentials };
        for (const field of SENSITIVE_FIELDS) {
            if (masked[field]) {
                masked[field] = maskSecret(masked[field] as string);
            }
        }
        return masked;
    }

    /**
     * Save or update an integration for a specific workspace
     */
    async saveIntegration(
        workspaceId: string,
        provider: string,
        data: { enabled?: boolean; credentials?: IntegrationCredentials }
    ) {
        const encryptedCredentials = data.credentials
            ? this.encryptCredentials(data.credentials)
            : undefined;

        const integration = await this.prisma.integration.upsert({
            where: {
                workspaceId_provider: { workspaceId, provider }
            },
            create: {
                workspaceId,
                provider,
                enabled: data.enabled ?? false,
                credentials: encryptedCredentials ?? {},
            },
            update: {
                enabled: data.enabled,
                ...(encryptedCredentials && { credentials: encryptedCredentials }),
            },
        });

        return {
            ...integration,
            credentials: this.maskCredentials(integration.credentials as IntegrationCredentials),
        };
    }

    /**
     * Get an integration with decrypted credentials (for internal use)
     */
    async getIntegration(
        workspaceId: string,
        provider: string
    ): Promise<{ enabled: boolean; credentials: IntegrationCredentials } | null> {
        const integration = await this.prisma.integration.findUnique({
            where: {
                workspaceId_provider: { workspaceId, provider }
            },
        });

        if (!integration) {
            return null;
        }

        return {
            enabled: integration.enabled,
            credentials: this.decryptCredentials(integration.credentials as IntegrationCredentials),
        };
    }

    /**
     * Get an integration with masked credentials (for API response)
     */
    async getIntegrationMasked(workspaceId: string, provider: string) {
        const integration = await this.prisma.integration.findUnique({
            where: {
                workspaceId_provider: { workspaceId, provider }
            },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${provider} not found for workspace`);
        }

        return {
            ...integration,
            credentials: this.maskCredentials(integration.credentials as IntegrationCredentials),
        };
    }

    /**
     * List all integrations for a workspace with masked credentials
     */
    async getAllIntegrations(workspaceId: string) {
        const integrations = await this.prisma.integration.findMany({
            where: { workspaceId },
            orderBy: { provider: 'asc' },
        });

        return integrations.map(integration => ({
            ...integration,
            credentials: this.maskCredentials(integration.credentials as IntegrationCredentials),
        }));
    }

    /**
     * Get Twilio credentials for a workspace (with fallback to env vars)
     */
    async getTwilioCredentials(workspaceId?: string): Promise<{
        accountSid: string;
        authToken: string;
        phoneNumber: string;
    }> {
        if (workspaceId) {
            const integration = await this.getIntegration(workspaceId, 'twilio');

            if (integration?.enabled && integration.credentials.accountSid) {
                return {
                    accountSid: integration.credentials.accountSid,
                    authToken: integration.credentials.authToken || '',
                    phoneNumber: integration.credentials.phoneNumber || '',
                };
            }
        }

        // Fallback to environment variables (global config)
        console.log('📌 Using Twilio credentials from environment variables');
        return {
            accountSid: process.env.TWILIO_ACCOUNT_SID || '',
            authToken: process.env.TWILIO_AUTH_TOKEN || '',
            phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
        };
    }
}

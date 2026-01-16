import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor(config: ConfigService) {
        const url = config.get<string>('DATABASE_URL');

        if (!url) {
            console.error('❌ ERREUR: DATABASE_URL introuvable via ConfigService');
        } else {
            console.log('✅ DATABASE_URL trouvée via ConfigService');
        }

        super({
            datasources: {
                db: {
                    url: url,
                },
            },
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}

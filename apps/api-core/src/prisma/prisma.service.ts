import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        // 🚨 FIX: On force l'URL explicitement ici
        const url = process.env.DATABASE_URL;

        if (!url) {
            console.error('❌ ERREUR CRITIQUE: La variable DATABASE_URL est absente !');
        } else {
            console.log('✅ DATABASE_URL trouvée (Lancement de Prisma)');
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

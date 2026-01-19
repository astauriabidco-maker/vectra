import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis;

    onModuleInit() {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6399');
        const redisPassword = process.env.REDIS_PASSWORD;

        this.client = new Redis({
            host: redisHost,
            port: redisPort,
            password: redisPassword,
        });

        this.client.on('connect', () => {
            console.log(`✅ Connected to Redis at ${redisHost}:${redisPort}`);
        });

        this.client.on('error', (err) => {
            console.error('❌ Redis connection error:', err);
        });
    }

    onModuleDestroy() {
        this.client.disconnect();
    }

    async pushJob(queueName: string, data: any) {
        await this.client.rpush(queueName, JSON.stringify(data));
    }

    async publishEvent(channel: string, data: any) {
        await this.client.publish(channel, JSON.stringify(data));
    }
}

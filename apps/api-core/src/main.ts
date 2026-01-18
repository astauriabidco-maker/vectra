import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());

    // CORS for Vercel Frontend + Local Development
    app.enableCors({
        origin: [
            'http://localhost:3000', // Local dev
            'http://localhost:4200', // Alternative local
            'https://vectra-api-core.vercel.app', // Vercel production
        ],
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
        credentials: true,
    });

    const port = process.env.PORT || 7070;
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Vectra Backend running on: http://0.0.0.0:${port}`);
}
bootstrap();

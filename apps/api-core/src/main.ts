import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());

    // Enhanced CORS for Cloud Deployment
    app.enableCors({
        origin: '*', // For now, can be restricted to Vercel URLs later
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        credentials: true,
    });

    const port = process.env.PORT || 7070;
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Vectra Backend running on port ${port}`);
}
bootstrap();

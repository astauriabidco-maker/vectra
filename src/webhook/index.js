/**
 * Vectra Hub - Webhook Service (V9 Omnichannel)
 * 
 * ARCHITECTURE RULE (Antigravity):
 * Ce service est STATELESS et doit répondre en < 1 seconde.
 * - Reçoit les webhooks de Meta (WhatsApp + Instagram + Messenger)
 * - Route et publie dans Redis (queue "inbound_events")
 * - Renvoie 200 OK immédiatement
 * 
 * INTERDIT: Traiter les messages, accéder à la DB, ou faire des appels externes.
 */

const Fastify = require('fastify');
const Redis = require('ioredis');

// ============================================
// CONFIGURATION
// ============================================
const PORT = parseInt(process.env.PORT || '3000', 10);
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'changeme';

const QUEUE_NAME = 'inbound_events';

// ============================================
// REDIS CONNECTION
// ============================================
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
    console.log(`[Webhook] ✅ Redis connected at ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('error', (err) => {
    console.error('[Webhook] ❌ Redis error:', err.message);
});

// ============================================
// FASTIFY SERVER
// ============================================
const server = Fastify({
    logger: true,
});

// ============================================
// HEALTH CHECK
// ============================================
server.get('/health', async (request, reply) => {
    return reply.send({
        status: 'ok',
        service: 'webhook',
        version: 'v9-omnichannel',
        redis: redis.status,
        timestamp: new Date().toISOString(),
    });
});

// ============================================
// GET /webhook - Meta Verification
// Meta appelle cette route pour vérifier le serveur
// Works for WhatsApp, Instagram & Messenger
// ============================================
server.get('/webhook', async (request, reply) => {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    console.log('[Webhook] 🔐 Verification request received', { mode });

    // Validate the verification request
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
        console.log('[Webhook] ✅ Verification successful');
        // Meta exige que le challenge soit renvoyé en texte brut
        return reply.status(200).send(challenge);
    }

    console.warn('[Webhook] ❌ Verification failed - invalid token');
    return reply.status(403).send('Forbidden');
});

// ============================================
// CHANNEL DETECTION LOGIC
// ============================================
function detectChannel(body) {
    const objectType = body?.object;

    // WhatsApp Business Account
    if (objectType === 'whatsapp_business_account') {
        return 'WHATSAPP';
    }

    // Instagram webhooks
    if (objectType === 'instagram') {
        return 'INSTAGRAM';
    }

    // Facebook Page (Messenger)
    if (objectType === 'page') {
        // Check if it's actually a messaging event
        const entry = body?.entry?.[0];
        if (entry?.messaging) {
            return 'MESSENGER';
        }
        // Could be other page events (feed, etc.)
        return 'FACEBOOK_PAGE';
    }

    return 'UNKNOWN';
}

// ============================================
// POST /webhook - Receive Messages (Omnichannel)
// Handles: WhatsApp, Instagram DM, Facebook Messenger
// CRITICAL: Répondre en < 1 seconde !
// ============================================
server.post('/webhook', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body;

    try {
        // Detect the channel from the webhook payload
        const channel = detectChannel(body);

        // Log channel detection
        console.log(`[Webhook] 📥 Received ${channel} webhook`);

        // Skip unknown or unsupported object types
        if (channel === 'UNKNOWN') {
            console.warn('[Webhook] ⚠️ Unknown object type:', body?.object);
            return reply.status(200).send('EVENT_RECEIVED');
        }

        // Skip non-messaging Facebook Page events
        if (channel === 'FACEBOOK_PAGE') {
            console.log('[Webhook] ⏭️ Skipping non-messaging page event');
            return reply.status(200).send('EVENT_RECEIVED');
        }

        // Génère un ID unique pour traçabilité
        const eventId = `evt_${channel}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // Crée l'événement à publier avec channel metadata
        const event = {
            id: eventId,
            channel: channel,
            receivedAt: new Date().toISOString(),
            payload: body,
        };

        // ============================================
        // ANTIGRAVITY: Push to Redis queue and return immediately
        // Ne PAS traiter le message ici !
        // ============================================
        await redis.lpush(QUEUE_NAME, JSON.stringify(event));

        const processingTime = Date.now() - startTime;
        console.log(`[Webhook] 📨 ${channel} event queued in ${processingTime}ms`, { eventId });

        // Toujours renvoyer 200 à Meta pour éviter les retries
        return reply.status(200).send('EVENT_RECEIVED');

    } catch (error) {
        // Même en cas d'erreur, on renvoie 200 pour éviter les retries Meta
        console.error('[Webhook] ❌ Error queuing event:', error);
        return reply.status(200).send('EVENT_RECEIVED');
    }
});

// ============================================
// START SERVER
// ============================================
const start = async () => {
    try {
        await server.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`[Webhook] 🚀 Server running at http://0.0.0.0:${PORT}`);
        console.log(`[Webhook] 📋 Queue: ${QUEUE_NAME}`);
        console.log(`[Webhook] 🔑 Verify Token: ${META_VERIFY_TOKEN.substring(0, 3)}***`);
        console.log(`[Webhook] 🌐 Omnichannel: WhatsApp + Instagram + Messenger`);
    } catch (err) {
        console.error('[Webhook] ❌ Failed to start:', err);
        process.exit(1);
    }
};

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
const shutdown = async () => {
    console.log('[Webhook] 🛑 Shutting down...');
    await server.close();
    await redis.quit();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
start();

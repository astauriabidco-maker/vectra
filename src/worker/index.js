/**
 * WhatsApp Hub - Worker Service
 * 
 * ARCHITECTURE ROLE:
 * - Écoute la queue Redis "inbound_events"
 * - Parse les webhooks WhatsApp
 * - Insère les données dans PostgreSQL (contacts, conversations, messages)
 * 
 * RÈGLES:
 * - Toutes les requêtes DB DOIVENT inclure tenant_id
 * - Ne jamais crasher sur une erreur de traitement
 */

const { Pool } = require('pg');
const Redis = require('ioredis');
const axios = require('axios');

// ============================================
// CONFIGURATION
// ============================================
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:secret_dev@localhost:5432/whatsapp_hub';

const QUEUE_NAME = 'inbound_events';

// WhatsApp Cloud API Config
const META_API_URL = 'https://graph.facebook.com/v18.0';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_ID = process.env.META_PHONE_ID;

// Default tenant ID (will be loaded at startup)
let DEFAULT_TENANT_ID = null;

// ============================================
// POSTGRESQL CONNECTION
// ============================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
    console.log('[Worker] ✅ PostgreSQL connected');
});

pool.on('error', (err) => {
    console.error('[Worker] ❌ PostgreSQL error:', err.message);
});

// ============================================
// REDIS CONNECTION (Queue consumer)
// ============================================
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,
});

redis.on('connect', () => {
    console.log(`[Worker] ✅ Redis connected at ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('error', (err) => {
    console.error('[Worker] ❌ Redis error:', err.message);
});

// ============================================
// REDIS PUBLISHER (for real-time events)
// ============================================
const redisPublisher = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
});

redisPublisher.on('connect', () => {
    console.log('[Worker] ✅ Redis Publisher connected');
});

// ============================================
// LOAD DEFAULT TENANT
// ============================================
async function loadDefaultTenant() {
    try {
        const result = await pool.query('SELECT id, name FROM tenants LIMIT 1');
        if (result.rows.length > 0) {
            DEFAULT_TENANT_ID = result.rows[0].id;
            console.log(`[Worker] 🏢 Default tenant: ${result.rows[0].name} (${DEFAULT_TENANT_ID})`);
        } else {
            console.error('[Worker] ❌ No tenant found in database!');
            process.exit(1);
        }
    } catch (err) {
        console.error('[Worker] ❌ Failed to load tenant:', err.message);
        process.exit(1);
    }
}

// ============================================
// FIND OR CREATE CONTACT
// ============================================
async function findOrCreateContact(client, waId, name) {
    // Check if contact exists
    const existing = await client.query(
        'SELECT id FROM contacts WHERE tenant_id = $1 AND wa_id = $2',
        [DEFAULT_TENANT_ID, waId]
    );

    if (existing.rows.length > 0) {
        console.log(`[Worker] 👤 Contact found: ${waId}`);
        return existing.rows[0].id;
    }

    // Create new contact
    const newContact = await client.query(
        'INSERT INTO contacts (tenant_id, wa_id, name) VALUES ($1, $2, $3) RETURNING id',
        [DEFAULT_TENANT_ID, waId, name || null]
    );

    console.log(`[Worker] 👤 Contact created: ${waId}`);
    return newContact.rows[0].id;
}

// ============================================
// FIND OR CREATE CONVERSATION
// ============================================
async function findOrCreateConversation(client, contactId) {
    // Check for existing open conversation
    const existing = await client.query(
        `SELECT id FROM conversations 
     WHERE tenant_id = $1 AND contact_id = $2 AND status = 'open'`,
        [DEFAULT_TENANT_ID, contactId]
    );

    if (existing.rows.length > 0) {
        // Update last_customer_message_at
        await client.query(
            `UPDATE conversations SET last_customer_message_at = NOW(), updated_at = NOW() 
       WHERE id = $1`,
            [existing.rows[0].id]
        );
        console.log(`[Worker] 💬 Conversation updated: ${existing.rows[0].id}`);
        return existing.rows[0].id;
    }

    // Create new conversation
    const newConversation = await client.query(
        `INSERT INTO conversations (tenant_id, contact_id, status, last_customer_message_at) 
     VALUES ($1, $2, 'open', NOW()) RETURNING id`,
        [DEFAULT_TENANT_ID, contactId]
    );

    console.log(`[Worker] 💬 Conversation created: ${newConversation.rows[0].id}`);
    return newConversation.rows[0].id;
}

// ============================================
// INSERT MESSAGE
// ============================================
async function insertMessage(client, conversationId, messageData, fullPayload) {
    // Handle different message types
    let messageBody = null;
    let mediaId = null;
    let mediaCaption = null;

    switch (messageData.type) {
        case 'text':
            messageBody = messageData.text?.body || null;
            break;
        case 'image':
            mediaId = messageData.image?.id || null;
            mediaCaption = messageData.image?.caption || null;
            // Store as JSON for frontend parsing
            messageBody = JSON.stringify({
                media_id: mediaId,
                caption: mediaCaption,
                mime_type: messageData.image?.mime_type || 'image/jpeg'
            });
            console.log(`[Worker] 📷 Image message: ${mediaId}`);
            break;
        case 'video':
            mediaId = messageData.video?.id || null;
            mediaCaption = messageData.video?.caption || null;
            messageBody = JSON.stringify({
                media_id: mediaId,
                caption: mediaCaption,
                mime_type: messageData.video?.mime_type || 'video/mp4'
            });
            console.log(`[Worker] 🎥 Video message: ${mediaId}`);
            break;
        case 'audio':
        case 'voice':
            mediaId = messageData.audio?.id || messageData.voice?.id || null;
            messageBody = JSON.stringify({
                media_id: mediaId,
                mime_type: messageData.audio?.mime_type || messageData.voice?.mime_type || 'audio/ogg'
            });
            console.log(`[Worker] 🎵 Audio message: ${mediaId}`);
            break;
        case 'document':
            mediaId = messageData.document?.id || null;
            messageBody = JSON.stringify({
                media_id: mediaId,
                caption: messageData.document?.caption || null,
                filename: messageData.document?.filename || 'document',
                mime_type: messageData.document?.mime_type || 'application/octet-stream'
            });
            console.log(`[Worker] 📄 Document message: ${mediaId}`);
            break;
        case 'sticker':
            mediaId = messageData.sticker?.id || null;
            messageBody = JSON.stringify({
                media_id: mediaId,
                mime_type: messageData.sticker?.mime_type || 'image/webp'
            });
            console.log(`[Worker] 🎭 Sticker message: ${mediaId}`);
            break;
        default:
            messageBody = `[${messageData.type} message]`;
    }

    const result = await client.query(
        `INSERT INTO messages 
     (tenant_id, conversation_id, direction, type, body, wa_message_id, status, payload) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
     RETURNING id, created_at`,
        [
            DEFAULT_TENANT_ID,
            conversationId,
            'inbound',
            messageData.type || 'text',
            messageBody,
            messageData.id,
            'delivered',
            JSON.stringify(fullPayload),
        ]
    );

    const insertedMessage = result.rows[0];
    console.log(`[Worker] 📩 Message inserted: ${insertedMessage.id}`);

    // 🔴 REAL-TIME: Publish to Redis for Socket.io
    const realtimePayload = {
        id: insertedMessage.id,
        conversation_id: conversationId,
        direction: 'inbound',
        type: messageData.type || 'text',
        body: messageBody,
        status: 'delivered',
        created_at: insertedMessage.created_at,
        tenant_id: DEFAULT_TENANT_ID
    };
    await redisPublisher.publish('chat_events', JSON.stringify(realtimePayload));
    console.log('[Worker] 📡 Published to chat_events');

    return insertedMessage.id;
}

// ============================================
// CHECK AUTOMATION RULES
// ============================================
async function checkAutomationRules(tenantId, messageBody) {
    if (!messageBody) return null;

    try {
        const result = await pool.query(
            `SELECT id, response_text FROM automation_rules 
             WHERE tenant_id = $1 AND is_active = true 
             AND LOWER($2) LIKE '%' || LOWER(trigger_keyword) || '%'
             LIMIT 1`,
            [tenantId, messageBody]
        );

        if (result.rows.length > 0) {
            console.log(`[Worker] 🤖 Automation rule matched: ${result.rows[0].id}`);
            return result.rows[0];
        }
    } catch (err) {
        console.error('[Worker] ❌ Automation check failed:', err.message);
    }

    return null;
}

// ============================================
// SEND WHATSAPP MESSAGE
// ============================================
async function sendWhatsAppMessage(toWaId, text) {
    if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
        console.error('[Worker] ❌ Missing META_ACCESS_TOKEN or META_PHONE_ID');
        return null;
    }

    try {
        const response = await axios.post(
            `${META_API_URL}/${META_PHONE_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: toWaId,
                type: 'text',
                text: { body: text }
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`[Worker] ✅ WhatsApp message sent to ${toWaId}`);
        return response.data?.messages?.[0]?.id || null;
    } catch (err) {
        console.error('[Worker] ❌ Failed to send WhatsApp message:', err.response?.data || err.message);
        return null;
    }
}

// ============================================
// INSERT AUTOMATED MESSAGE
// ============================================
async function insertAutomatedMessage(conversationId, body, waMessageId) {
    try {
        const result = await pool.query(
            `INSERT INTO messages 
             (tenant_id, conversation_id, direction, type, body, wa_message_id, status, is_automated) 
             VALUES ($1, $2, 'outbound', 'text', $3, $4, 'sent', true)
             RETURNING id, created_at`,
            [DEFAULT_TENANT_ID, conversationId, body, waMessageId]
        );
        console.log('[Worker] 📤 Automated message saved to DB');

        // 🔴 REAL-TIME: Publish to Redis for Socket.io
        const insertedMessage = result.rows[0];
        const realtimePayload = {
            id: insertedMessage.id,
            conversation_id: conversationId,
            direction: 'outbound',
            type: 'text',
            body: body,
            status: 'sent',
            created_at: insertedMessage.created_at,
            tenant_id: DEFAULT_TENANT_ID,
            is_automated: true
        };
        await redisPublisher.publish('chat_events', JSON.stringify(realtimePayload));
        console.log('[Worker] 📡 Published automated message to chat_events');
    } catch (err) {
        console.error('[Worker] ❌ Failed to save automated message:', err.message);
    }
}

// ============================================
// PROCESS WEBHOOK EVENT
// ============================================
async function processEvent(eventData) {
    const startTime = Date.now();

    try {
        const event = JSON.parse(eventData);
        const payload = event.payload;

        console.log(`[Worker] 📥 Processing event: ${event.id}`);

        // Navigate to message in WhatsApp structure
        const entry = payload?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;
        const contacts = value?.contacts;

        // Skip if no messages (e.g., status updates)
        if (!messages || messages.length === 0) {
            console.log(`[Worker] ⏭️ Skipping event (no messages): ${event.id}`);
            return;
        }

        // Get the first message
        const message = messages[0];
        const contact = contacts?.[0];
        const waId = message.from;
        const contactName = contact?.profile?.name || null;

        console.log(`[Worker] 📨 Message from ${waId}:`, message.text?.body || `[${message.type}]`);

        // ============================================
        // DATABASE TRANSACTION
        // ============================================
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Step A: Find or create contact
            const contactId = await findOrCreateContact(client, waId, contactName);

            // Step B: Find or create conversation
            const conversationId = await findOrCreateConversation(client, contactId);

            // Step C: Insert message
            await insertMessage(client, conversationId, message, payload);

            await client.query('COMMIT');

            const processingTime = Date.now() - startTime;
            console.log(`[Worker] ✅ Event processed in ${processingTime}ms: ${event.id}`);

            // ============================================
            // STEP D: CHECK AUTOMATION RULES (after commit)
            // ============================================
            const messageBody = message.text?.body;
            const automationRule = await checkAutomationRules(DEFAULT_TENANT_ID, messageBody);

            if (automationRule) {
                console.log(`[Worker] 🤖 Triggering automated reply...`);
                const waMessageId = await sendWhatsAppMessage(waId, automationRule.response_text);
                if (waMessageId) {
                    await insertAutomatedMessage(conversationId, automationRule.response_text, waMessageId);
                }
            }

        } catch (dbError) {
            await client.query('ROLLBACK');
            console.error(`[Worker] ❌ DB transaction failed:`, dbError.message);
        } finally {
            client.release();
        }

    } catch (parseError) {
        console.error(`[Worker] ❌ Failed to parse event:`, parseError.message);
    }
}

// ============================================
// POLLING LOOP (BRPOP for blocking)
// ============================================
async function startPolling() {
    console.log(`[Worker] 👂 Listening to queue: ${QUEUE_NAME}`);

    while (true) {
        try {
            // BRPOP: Blocking pop - waits for message with 5 second timeout
            const result = await redis.brpop(QUEUE_NAME, 5);

            if (result) {
                const [, eventData] = result;
                await processEvent(eventData);
            }
        } catch (err) {
            console.error('[Worker] ❌ Polling error:', err.message);
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// ============================================
// STARTUP
// ============================================
async function start() {
    console.log('[Worker] 🚀 Starting Worker Service...');

    // Load default tenant
    await loadDefaultTenant();

    // Start polling
    startPolling();
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
async function shutdown() {
    console.log('[Worker] 🛑 Shutting down...');
    await redis.quit();
    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the worker
start();

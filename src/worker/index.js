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

// ============================================
// CONFIGURATION
// ============================================
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:secret_dev@localhost:5432/whatsapp_hub';

const QUEUE_NAME = 'inbound_events';

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
// REDIS CONNECTION
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
    const result = await client.query(
        `INSERT INTO messages 
     (tenant_id, conversation_id, direction, type, body, wa_message_id, status, payload) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
     RETURNING id`,
        [
            DEFAULT_TENANT_ID,
            conversationId,
            'inbound',
            messageData.type || 'text',
            messageData.text?.body || null,
            messageData.id,
            'delivered',
            JSON.stringify(fullPayload),
        ]
    );

    console.log(`[Worker] 📩 Message inserted: ${result.rows[0].id}`);
    return result.rows[0].id;
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

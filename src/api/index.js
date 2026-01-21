/**
 * WhatsApp Hub - API Service
 * 
 * ARCHITECTURE ROLE:
 * - Expose REST endpoints for the frontend
 * - Read conversations/messages from PostgreSQL
 * - Handle outbound message creation
 * 
 * RÈGLES:
 * - Toutes les requêtes DB DOIVENT inclure tenant_id
 * - CORS activé pour le développement local
 */

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Pool } = require('pg');
const axios = require('axios');

// ============================================
// CONFIGURATION
// ============================================
const PORT = parseInt(process.env.PORT || '4000', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:secret_dev@localhost:5432/whatsapp_hub';

// Meta WhatsApp API Configuration
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_ID = process.env.META_PHONE_ID;
const META_API_URL = `https://graph.facebook.com/v17.0/${META_PHONE_ID}/messages`;

// Default tenant ID (will be loaded at startup)
let TENANT_ID = null;

// ============================================
// POSTGRESQL CONNECTION
// ============================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
    console.log('[API] ✅ PostgreSQL connected');
});

pool.on('error', (err) => {
    console.error('[API] ❌ PostgreSQL error:', err.message);
});

// ============================================
// LOAD DEFAULT TENANT
// ============================================
async function loadDefaultTenant() {
    try {
        const result = await pool.query('SELECT id, name FROM tenants LIMIT 1');
        if (result.rows.length > 0) {
            TENANT_ID = result.rows[0].id;
            console.log(`[API] 🏢 Default tenant: ${result.rows[0].name} (${TENANT_ID})`);
        } else {
            console.error('[API] ❌ No tenant found in database!');
            process.exit(1);
        }
    } catch (err) {
        console.error('[API] ❌ Failed to load tenant:', err.message);
        process.exit(1);
    }
}

// ============================================
// FASTIFY SERVER
// ============================================
const server = Fastify({
    logger: true,
});

// ============================================
// CORS CONFIGURATION
// ============================================
server.register(cors, {
    origin: true, // Allow all origins for local dev
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
});

// ============================================
// HEALTH CHECK
// ============================================
server.get('/health', async (request, reply) => {
    return reply.send({
        status: 'ok',
        service: 'api',
        tenant: TENANT_ID,
        timestamp: new Date().toISOString(),
    });
});

// ============================================
// GET /conversations
// Liste des conversations du tenant
// ============================================
server.get('/conversations', async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT 
        conv.id,
        conv.status,
        conv.last_customer_message_at,
        conv.updated_at,
        c.wa_id,
        c.name as contact_name
      FROM conversations conv
      JOIN contacts c ON conv.contact_id = c.id
      WHERE conv.tenant_id = $1
      ORDER BY conv.last_customer_message_at DESC NULLS LAST`,
            [TENANT_ID]
        );

        const conversations = result.rows.map(row => ({
            id: row.id,
            contact_name: row.contact_name || row.wa_id,
            wa_id: row.wa_id,
            last_message_date: row.last_customer_message_at,
            status: row.status,
            updated_at: row.updated_at,
        }));

        return reply.send(conversations);
    } catch (err) {
        console.error('[API] ❌ Error fetching conversations:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// GET /conversations/:id/messages
// Messages d'une conversation spécifique
// ============================================
server.get('/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params;

    try {
        // Verify conversation belongs to tenant
        const convCheck = await pool.query(
            'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
            [id, TENANT_ID]
        );

        if (convCheck.rows.length === 0) {
            return reply.status(404).send({ error: 'Conversation not found' });
        }

        const result = await pool.query(
            `SELECT 
        id,
        direction,
        type,
        body,
        status,
        wa_message_id,
        created_at
      FROM messages
      WHERE conversation_id = $1 AND tenant_id = $2
      ORDER BY created_at ASC`,
            [id, TENANT_ID]
        );

        const messages = result.rows.map(row => ({
            id: row.id,
            direction: row.direction,
            type: row.type,
            body: row.body,
            status: row.status,
            wa_message_id: row.wa_message_id,
            created_at: row.created_at,
        }));

        return reply.send(messages);
    } catch (err) {
        console.error('[API] ❌ Error fetching messages:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// POST /messages
// Créer un message sortant via WhatsApp Cloud API
// ============================================
server.post('/messages', async (request, reply) => {
    const { conversation_id, message_body } = request.body || {};

    // Validation
    if (!conversation_id || !message_body) {
        return reply.status(400).send({
            error: 'Missing required fields: conversation_id, message_body'
        });
    }

    // Check Meta credentials
    if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
        console.error('[API] ❌ META_ACCESS_TOKEN or META_PHONE_ID not configured');
        return reply.status(500).send({ error: 'WhatsApp API not configured' });
    }

    try {
        // 1. Verify conversation belongs to tenant and get contact wa_id
        const convResult = await pool.query(
            `SELECT conv.id, c.wa_id 
             FROM conversations conv
             JOIN contacts c ON conv.contact_id = c.id
             WHERE conv.id = $1 AND conv.tenant_id = $2`,
            [conversation_id, TENANT_ID]
        );

        if (convResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Conversation not found' });
        }

        const { wa_id } = convResult.rows[0];
        console.log(`[API] 📱 Sending message to ${wa_id}`);

        // 2. Call Meta WhatsApp Cloud API
        let metaResponse;
        let waMessageId = null;
        let messageStatus = 'sent';

        try {
            metaResponse = await axios.post(
                META_API_URL,
                {
                    messaging_product: 'whatsapp',
                    to: wa_id,
                    text: { body: message_body }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 // 10 seconds timeout
                }
            );

            // Extract wa_message_id from Meta response
            waMessageId = metaResponse.data?.messages?.[0]?.id || null;
            console.log(`[API] ✅ Message sent to WhatsApp. wa_message_id: ${waMessageId}`);

        } catch (axiosError) {
            // Log Meta API error details
            const errorData = axiosError.response?.data || axiosError.message;
            console.error('[API] ❌ Meta API Error:', JSON.stringify(errorData));
            messageStatus = 'failed';
        }

        // 3. Insert message in database with status and wa_message_id
        const insertResult = await pool.query(
            `INSERT INTO messages 
             (tenant_id, conversation_id, direction, type, body, status, wa_message_id) 
             VALUES ($1, $2, 'outbound', 'text', $3, $4, $5) 
             RETURNING id, direction, body, status, wa_message_id, created_at`,
            [TENANT_ID, conversation_id, message_body, messageStatus, waMessageId]
        );

        const newMessage = insertResult.rows[0];
        console.log(`[API] 📤 Message saved: ${newMessage.id} (status: ${messageStatus})`);

        // 4. Return appropriate response
        if (messageStatus === 'failed') {
            return reply.status(500).send({
                error: 'Failed to send message to WhatsApp',
                message_id: newMessage.id,
                status: 'failed'
            });
        }

        return reply.status(201).send({
            id: newMessage.id,
            direction: newMessage.direction,
            body: newMessage.body,
            status: newMessage.status,
            wa_message_id: newMessage.wa_message_id,
            created_at: newMessage.created_at,
        });

    } catch (err) {
        console.error('[API] ❌ Error creating message:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// START SERVER
// ============================================
async function start() {
    try {
        // Load tenant first
        await loadDefaultTenant();

        // Start server
        await server.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`[API] 🚀 Server running at http://0.0.0.0:${PORT}`);
        console.log(`[API] 📋 Endpoints: /conversations, /messages`);
    } catch (err) {
        console.error('[API] ❌ Failed to start:', err);
        process.exit(1);
    }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
async function shutdown() {
    console.log('[API] 🛑 Shutting down...');
    await server.close();
    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
start();

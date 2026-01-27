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
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const Redis = require('ioredis');
require('dotenv').config();

// ============================================
// CONFIGURATION
// ============================================
const PORT = parseInt(process.env.PORT || '4000', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:secret_dev@localhost:5432/whatsapp_hub';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_fallback_123';

// Redis Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Meta WhatsApp API Configuration
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_ID = process.env.META_PHONE_ID;
const META_WABA_ID = process.env.META_WABA_ID; // WhatsApp Business Account ID
const META_API_URL = `https://graph.facebook.com/v17.0/${META_PHONE_ID}/messages`;

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
// SERVER INITIALIZATION
// ============================================
const server = Fastify({
    logger: true,
});

// Decorate request with tenantId
server.decorateRequest('tenantId', null);

// Auth Middleware
server.decorate('authenticate', async (request, reply) => {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({ error: 'Missing or malformed token' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        request.tenantId = decoded.tenantId;
        request.userId = decoded.userId;
        request.userRole = decoded.role;
    } catch (err) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
    }
});

// Role-Based Access Control Middleware (Factory)
const requireRole = (role) => async (request, reply) => {
    if (request.userRole !== role) {
        return reply.status(403).send({ error: 'Forbidden: Insufficient permissions' });
    }
};

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
        timestamp: new Date().toISOString(),
    });
});

// ============================================
// GET /media/:mediaId
// Proxy pour récupérer les médias WhatsApp (contourne CORS)
// ============================================
server.get('/media/:mediaId', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { mediaId } = request.params;

    if (!META_ACCESS_TOKEN) {
        return reply.status(500).send({ error: 'META_ACCESS_TOKEN not configured' });
    }

    try {
        // Step 1: Get media URL from Meta API
        console.log(`[API] 📷 Fetching media info for: ${mediaId}`);
        const metaInfoResponse = await axios.get(
            `https://graph.facebook.com/v17.0/${mediaId}`,
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`
                }
            }
        );

        const mediaUrl = metaInfoResponse.data.url;
        if (!mediaUrl) {
            return reply.status(404).send({ error: 'Media URL not found' });
        }

        console.log(`[API] 📷 Downloading media from: ${mediaUrl.substring(0, 50)}...`);

        // Step 2: Download the actual media binary
        const mediaResponse = await axios.get(mediaUrl, {
            headers: {
                'Authorization': `Bearer ${META_ACCESS_TOKEN}`
            },
            responseType: 'arraybuffer'
        });

        // Step 3: Send the binary with correct content type
        const contentType = mediaResponse.headers['content-type'] || 'application/octet-stream';
        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'public, max-age=86400'); // Cache for 24h

        return reply.send(Buffer.from(mediaResponse.data));

    } catch (err) {
        console.error('[API] ❌ Media proxy error:', err.response?.data || err.message);
        return reply.status(500).send({ error: 'Failed to fetch media' });
    }
});

// ============================================
// POST /auth/login
// Authentification utilisateur
// ============================================
server.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
        return reply.status(400).send({ error: 'Email and password required' });
    }

    try {
        const result = await pool.query(
            'SELECT id, tenant_id, password_hash, role FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, tenantId: user.tenant_id, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return reply.send({ token, role: user.role });
    } catch (err) {
        console.error('[API] ❌ Login error:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// GET /conversations
// Liste des conversations du tenant
// ============================================
server.get('/conversations', { preHandler: [server.authenticate] }, async (request, reply) => {
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
            [request.tenantId]
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
server.get('/conversations/:id/messages', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
        // Verify conversation belongs to tenant
        const convCheck = await pool.query(
            'SELECT id, last_customer_message_at FROM conversations WHERE id = $1 AND tenant_id = $2',
            [id, request.tenantId]
        );

        if (convCheck.rows.length === 0) {
            return reply.status(404).send({ error: 'Conversation not found' });
        }

        // Calculate 24h window status
        const conversation = convCheck.rows[0];
        let can_reply = false;
        let expires_at = null;

        if (conversation.last_customer_message_at) {
            const lastMsgDate = new Date(conversation.last_customer_message_at);
            const now = new Date();
            const diffMs = now.getTime() - lastMsgDate.getTime();
            const twentyFourHoursMs = 24 * 60 * 60 * 1000;

            can_reply = diffMs < twentyFourHoursMs;
            if (conversation.last_customer_message_at) {
                expires_at = new Date(lastMsgDate.getTime() + twentyFourHoursMs).toISOString();
            }
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
            [id, request.tenantId]
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

        // Return wrapped response
        return reply.send({
            messages: messages,
            meta: {
                can_reply,
                expires_at
            }
        });
    } catch (err) {
        console.error('[API] ❌ Error fetching messages:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// GET /templates
// Liste des templates avec tous les détails
// ============================================
server.get('/templates', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT id, name, language, meta_status, body_text, variables_count, content, wa_template_id 
             FROM templates WHERE tenant_id = $1 
             ORDER BY name ASC`,
            [request.tenantId]
        );

        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Error fetching templates:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// POST /templates/sync
// Synchronise les templates depuis Meta
// ============================================
server.post('/templates/sync', { preHandler: [server.authenticate] }, async (request, reply) => {
    if (!META_ACCESS_TOKEN || !META_WABA_ID) {
        return reply.status(500).send({ error: 'META_ACCESS_TOKEN or META_WABA_ID not configured' });
    }

    try {
        console.log('[API] 🔄 Syncing templates from Meta...');

        // Fetch templates from Meta API
        const metaResponse = await axios.get(
            `https://graph.facebook.com/v17.0/${META_WABA_ID}/message_templates`,
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`
                },
                params: {
                    limit: 100
                }
            }
        );

        const templates = metaResponse.data.data || [];
        console.log(`[API] 📥 Received ${templates.length} templates from Meta`);

        let synced = 0;
        let updated = 0;

        for (const tpl of templates) {
            // Extract body text from components
            let bodyText = '';
            let variablesCount = 0;
            const bodyComponent = tpl.components?.find(c => c.type === 'BODY');

            if (bodyComponent) {
                bodyText = bodyComponent.text || '';
                // Count variables ({{1}}, {{2}}, etc.)
                const matches = bodyText.match(/\{\{\d+\}\}/g);
                variablesCount = matches ? matches.length : 0;
            }

            // Check if template exists
            const existing = await pool.query(
                'SELECT id FROM templates WHERE tenant_id = $1 AND name = $2 AND language = $3',
                [request.tenantId, tpl.name, tpl.language]
            );

            if (existing.rows.length > 0) {
                // Update existing
                await pool.query(
                    `UPDATE templates SET 
                        wa_template_id = $1,
                        meta_status = $2,
                        body_text = $3,
                        variables_count = $4,
                        content = $5,
                        updated_at = NOW()
                     WHERE id = $6`,
                    [
                        tpl.id,
                        tpl.status,
                        bodyText,
                        variablesCount,
                        JSON.stringify(tpl),
                        existing.rows[0].id
                    ]
                );
                updated++;
            } else {
                // Insert new
                await pool.query(
                    `INSERT INTO templates 
                        (tenant_id, wa_template_id, name, language, meta_status, body_text, variables_count, content)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        request.tenantId,
                        tpl.id,
                        tpl.name,
                        tpl.language,
                        tpl.status,
                        bodyText,
                        variablesCount,
                        JSON.stringify(tpl)
                    ]
                );
                synced++;
            }
        }

        console.log(`[API] ✅ Sync complete: ${synced} new, ${updated} updated`);

        // Return updated list
        const result = await pool.query(
            `SELECT id, name, language, meta_status, body_text, variables_count 
             FROM templates WHERE tenant_id = $1 ORDER BY name ASC`,
            [request.tenantId]
        );

        return reply.send({
            message: `Synced ${synced} new templates, updated ${updated}`,
            templates: result.rows
        });

    } catch (err) {
        console.error('[API] ❌ Template sync error:', err.response?.data || err.message);
        return reply.status(500).send({ error: 'Failed to sync templates from Meta' });
    }
});

// ============================================
// POST /messages
// Créer un message sortant via WhatsApp Cloud API
// ============================================
server.post('/messages', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { conversation_id, message_body, type, template_name, template_language, params } = request.body || {};

    // Validation
    const isTemplate = type === 'template';
    if (!conversation_id || (!isTemplate && !message_body) || (isTemplate && !template_name)) {
        return reply.status(400).send({
            error: isTemplate
                ? 'Missing required fields for template: conversation_id, template_name'
                : 'Missing required fields: conversation_id, message_body'
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
            [conversation_id, request.tenantId]
        );

        if (convResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Conversation not found' });
        }

        const { wa_id } = convResult.rows[0];
        const templateName = template_name || 'hello_world';
        const templateLang = template_language || 'en_US';

        console.log(`[API] 📤 Sending ${isTemplate ? 'template' : 'text'} message to ${wa_id}`);

        // 2. Call Meta WhatsApp Cloud API
        let metaResponse;
        let waMessageId = null;
        let messageStatus = 'sent';
        let finalBody = message_body;

        // Meta Payload
        const metaPayload = {
            messaging_product: 'whatsapp',
            to: wa_id
        };

        if (isTemplate) {
            metaPayload.type = 'template';
            metaPayload.template = {
                name: templateName,
                language: { code: templateLang }
            };

            // Add variables if provided
            if (params && Array.isArray(params) && params.length > 0) {
                metaPayload.template.components = [
                    {
                        type: 'body',
                        parameters: params.map(p => ({ type: 'text', text: String(p) }))
                    }
                ];
                console.log(`[API] 📝 Template with ${params.length} variables`);
            }

            // Try to find template content for our local DB storage
            const tplResult = await pool.query(
                'SELECT body_text FROM templates WHERE name = $1 AND tenant_id = $2 AND language = $3',
                [templateName, request.tenantId, templateLang.replace('_', '-').split('-')[0]]
            );

            if (tplResult.rows.length > 0 && tplResult.rows[0].body_text) {
                finalBody = tplResult.rows[0].body_text;
                // Replace placeholders with actual values
                if (params && Array.isArray(params)) {
                    params.forEach((val, idx) => {
                        finalBody = finalBody.replace(`{{${idx + 1}}}`, val);
                    });
                }
            } else {
                finalBody = `Template: ${templateName}`;
                if (params && params.length > 0) {
                    finalBody += ` (${params.join(', ')})`;
                }
            }
        } else {
            metaPayload.text = { body: message_body };
        }

        try {
            metaResponse = await axios.post(
                META_API_URL,
                metaPayload,
                {
                    headers: {
                        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            waMessageId = metaResponse.data?.messages?.[0]?.id || null;
            console.log(`[API] ✅ API Meta success. wa_message_id: ${waMessageId}`);

        } catch (axiosError) {
            const errorData = axiosError.response?.data || axiosError.message;
            console.error('[API] ❌ Meta API Error:', JSON.stringify(errorData));
            messageStatus = 'failed';
        }

        // 3. Insert message in database
        const insertResult = await pool.query(
            `INSERT INTO messages 
             (tenant_id, conversation_id, direction, type, body, status, wa_message_id) 
             VALUES ($1, $2, 'outbound', $3, $4, $5, $6) 
             RETURNING id, direction, body, status, wa_message_id, created_at`,
            [request.tenantId, conversation_id, isTemplate ? 'template' : 'text', finalBody, messageStatus, waMessageId]
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
// AUTOMATION RULES (CHATBOT)
// ============================================

// Lister les règles du tenant
server.get('/automations', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            'SELECT id, trigger_keyword, response_text, is_active, created_at FROM automation_rules WHERE tenant_id = $1 ORDER BY created_at DESC',
            [request.tenantId]
        );
        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Failed to fetch automations:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// Créer une règle
server.post('/automations', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { trigger_keyword, response_text } = request.body || {};
    if (!trigger_keyword || !response_text) {
        return reply.status(400).send({ error: 'Trigger keyword and response text are required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO automation_rules (tenant_id, trigger_keyword, response_text) VALUES ($1, $2, $3) RETURNING id, trigger_keyword, response_text, is_active',
            [request.tenantId, trigger_keyword.trim(), response_text.trim()]
        );
        return reply.status(201).send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to create automation:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// Supprimer une règle
server.delete('/automations/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    try {
        const result = await pool.query(
            'DELETE FROM automation_rules WHERE id = $1 AND tenant_id = $2 RETURNING id',
            [id, request.tenantId]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Rule not found' });
        }
        return reply.send({ message: 'Rule deleted' });
    } catch (err) {
        console.error('[API] ❌ Failed to delete automation:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// ADMIN ROUTES (SUPER_ADMIN ONLY)
// ============================================

// Lister tous les tenants
server.get('/admin/tenants', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    try {
        const result = await pool.query('SELECT id, name, created_at FROM tenants ORDER BY created_at DESC');
        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Failed to fetch tenants:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// Créer un tenant
server.post('/admin/tenants', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    const { name } = request.body || {};
    if (!name) return reply.status(400).send({ error: 'Name required' });

    try {
        const result = await pool.query(
            'INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, created_at',
            [name]
        );
        return reply.status(201).send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to create tenant:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// Créer un utilisateur
server.post('/admin/users', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    const { email, password, tenant_id, role } = request.body || {};

    if (!email || !password || !tenant_id) {
        return reply.status(400).send({ error: 'Email, password and tenant_id are required' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (tenant_id, email, password_hash, role) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, email, role, tenant_id`,
            [tenant_id, email, passwordHash, role || 'AGENT']
        );
        return reply.status(201).send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to create user:', err.message);
        if (err.code === '23505') return reply.status(400).send({ error: 'Email already exists' });
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// START SERVER
// ============================================
async function start() {
    try {
        // Start Fastify server
        await server.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`[API] 🚀 Server running at http://0.0.0.0:${PORT}`);
        console.log(`[API] 🔑 JWT Auth enabled`);

        // ============================================
        // SOCKET.IO SETUP
        // ============================================
        const io = new Server(server.server, {
            cors: {
                origin: ['http://localhost:3001', 'http://localhost:3000', 'http://127.0.0.1:3001'],
                methods: ['GET', 'POST'],
                credentials: true
            },
            transports: ['websocket', 'polling']
        });

        io.on('connection', (socket) => {
            console.log(`[API] 🔌 Client connected: ${socket.id}`);

            socket.on('disconnect', () => {
                console.log(`[API] 🔌 Client disconnected: ${socket.id}`);
            });
        });

        console.log('[API] 🔌 Socket.io attached to server');

        // ============================================
        // REDIS SUBSCRIBER FOR REAL-TIME EVENTS
        // ============================================
        const redisSub = new Redis({
            host: REDIS_HOST,
            port: REDIS_PORT
        });

        redisSub.on('connect', () => {
            console.log('[API] ✅ Redis Subscriber connected');
        });

        redisSub.on('error', (err) => {
            console.error('[API] ❌ Redis Subscriber error:', err.message);
        });

        // Subscribe to chat_events channel
        await redisSub.subscribe('chat_events');
        console.log('[API] 📡 Subscribed to chat_events channel');

        // Forward Redis messages to Socket.io clients
        redisSub.on('message', (channel, message) => {
            if (channel === 'chat_events') {
                try {
                    const data = JSON.parse(message);
                    console.log(`[API] 📨 Broadcasting new_message: ${data.id}`);
                    io.emit('new_message', data);
                } catch (err) {
                    console.error('[API] ❌ Failed to parse Redis message:', err.message);
                }
            }
        });

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

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
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FormData = require('form-data');
const nodemailer = require('nodemailer');
require('dotenv').config();

// AI Factory for multi-provider support
const { AIFactory } = require('./lib/ai');

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
// FIND OR CREATE CONTACT (V9 Omnichannel)
// Supports: wa_id (WhatsApp), instagram_id, messenger_id
// ============================================
async function findOrCreateContact(client, waId, name) {
    // Legacy function - delegates to omnichannel version
    return findOrCreateContactOmni(client, { wa_id: waId }, { name });
}

async function findOrCreateContactOmni(client, identifiers, profileData = {}) {
    const { wa_id, instagram_id, messenger_id } = identifiers;
    const { name, first_name, last_name, avatar_url } = profileData;

    // Build dynamic lookup query
    const conditions = [];
    const params = [DEFAULT_TENANT_ID];
    let paramIndex = 2;

    if (wa_id) {
        conditions.push(`wa_id = $${paramIndex++}`);
        params.push(wa_id);
    }
    if (instagram_id) {
        conditions.push(`instagram_id = $${paramIndex++}`);
        params.push(instagram_id);
    }
    if (messenger_id) {
        conditions.push(`messenger_id = $${paramIndex++}`);
        params.push(messenger_id);
    }

    const whereClause = conditions.length > 0
        ? `AND (${conditions.join(' OR ')})`
        : '';

    const existing = await client.query(
        `SELECT id FROM contacts WHERE tenant_id = $1 ${whereClause}`,
        params
    );

    if (existing.rows.length > 0) {
        // Update with new identifiers if available
        const contactId = existing.rows[0].id;
        await client.query(`
            UPDATE contacts SET
                wa_id = COALESCE($2, wa_id),
                instagram_id = COALESCE($3, instagram_id),
                messenger_id = COALESCE($4, messenger_id),
                avatar_url = COALESCE($5, avatar_url),
                first_name = COALESCE($6, first_name),
                last_name = COALESCE($7, last_name),
                last_interaction = NOW()
            WHERE id = $1
        `, [contactId, wa_id || null, instagram_id || null, messenger_id || null, avatar_url || null, first_name || null, last_name || null]);

        const channelIcon = wa_id ? '🟢' : instagram_id ? '🟣' : '🔵';
        console.log(`[Worker] ${channelIcon} Contact found & updated: ${wa_id || instagram_id || messenger_id}`);
        return contactId;
    }

    // Create new contact
    const result = await client.query(`
        INSERT INTO contacts (tenant_id, wa_id, instagram_id, messenger_id, name, first_name, last_name, avatar_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
    `, [DEFAULT_TENANT_ID, wa_id || null, instagram_id || null, messenger_id || null, name || null, first_name || null, last_name || null, avatar_url || null]);

    const channelIcon = wa_id ? '🟢' : instagram_id ? '🟣' : '🔵';
    console.log(`[Worker] ${channelIcon} Contact created: ${wa_id || instagram_id || messenger_id}`);
    return result.rows[0].id;
}

// ============================================
// FIND OR CREATE CONVERSATION (V9 Omnichannel)
// ============================================
async function findOrCreateConversation(client, contactId, channel = 'WHATSAPP') {
    return findOrCreateConversationOmni(client, contactId, channel);
}

async function findOrCreateConversationOmni(client, contactId, channel = 'WHATSAPP', socialThreadId = null) {
    // Check for existing open conversation on same channel
    const existing = await client.query(
        `SELECT id FROM conversations 
         WHERE tenant_id = $1 AND contact_id = $2 AND channel = $3 AND status = 'open'`,
        [DEFAULT_TENANT_ID, contactId, channel]
    );

    if (existing.rows.length > 0) {
        // Update last_customer_message_at
        await client.query(
            `UPDATE conversations SET last_customer_message_at = NOW(), updated_at = NOW() 
             WHERE id = $1`,
            [existing.rows[0].id]
        );
        console.log(`[Worker] 💬 ${channel} conversation updated: ${existing.rows[0].id}`);
        return existing.rows[0].id;
    }

    // Create new conversation with channel
    const newConversation = await client.query(
        `INSERT INTO conversations (tenant_id, contact_id, channel, social_thread_id, status, last_customer_message_at) 
         VALUES ($1, $2, $3, $4, 'open', NOW()) RETURNING id`,
        [DEFAULT_TENANT_ID, contactId, channel, socialThreadId]
    );

    console.log(`[Worker] 💬 ${channel} conversation created: ${newConversation.rows[0].id}`);
    return newConversation.rows[0].id;
}

// ============================================
// SEND MESSAGE BY CHANNEL (V9 Omnichannel)
// ============================================
async function sendMessageByChannel(channel, recipientId, text, accessToken = null) {
    const token = accessToken || META_ACCESS_TOKEN;

    switch (channel) {
        case 'WHATSAPP':
            return sendWhatsAppMessage(recipientId, text);

        case 'INSTAGRAM':
        case 'MESSENGER':
            // Both use the same Send API
            try {
                const response = await axios.post(
                    `${META_API_URL}/me/messages`,
                    {
                        recipient: { id: recipientId },
                        message: { text }
                    },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                console.log(`[Worker] ✅ ${channel} message sent: ${response.data.message_id}`);
                return response.data.message_id;
            } catch (error) {
                console.error(`[Worker] ❌ Failed to send ${channel} message:`, error.response?.data || error.message);
                return null;
            }

        default:
            console.error(`[Worker] ❌ Unknown channel: ${channel}`);
            return null;
    }
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
// GET AI CONFIG FOR TENANT
// ============================================
async function getAIConfig(tenantId) {
    try {
        const result = await pool.query(
            `SELECT id, is_active, system_prompt, system_instructions, 
                    persona_style, emoji_usage, creativity_level,
                    provider, model, api_key
             FROM ai_configs WHERE tenant_id = $1 AND is_active = true`,
            [tenantId]
        );
        return result.rows[0] || null;
    } catch (err) {
        console.error('[Worker] ❌ Failed to get AI config:', err.message);
        return null;
    }
}

// ============================================
// GET KNOWLEDGE BASE FOR RAG
// ============================================
async function getKnowledgeBase(tenantId) {
    try {
        const result = await pool.query(
            `SELECT source_name, content FROM knowledge_docs 
             WHERE tenant_id = $1 AND is_active = true
             ORDER BY created_at DESC`,
            [tenantId]
        );
        return result.rows;
    } catch (err) {
        console.error('[Worker] ❌ Failed to get knowledge base:', err.message);
        return [];
    }
}

// ============================================
// PERSONA STYLE DESCRIPTIONS (Human Touch)
// ============================================
function getPersonaStyleDescription(style) {
    const styles = {
        'PROFESSIONAL': 'Utilise le vouvoiement, sois formel, précis et poli. Garde un ton professionnel en toutes circonstances.',
        'FRIENDLY': 'Tu peux tutoyer si le client tutoie. Sois cool, chaleureux et serviable. Un ton décontracté mais respectueux.',
        'EMPATHETIC': 'Montre que tu comprends les problèmes. Utilise des expressions comme "Je comprends", "Je suis désolé", "Je vais vous aider". Sois rassurant.',
        'FUNNY': 'Tu peux utiliser l\'humour légèrement. Sois décalé et fun, mais reste professionnel et utile.'
    };
    return styles[style] || styles['FRIENDLY'];
}

// ============================================
// BUILD SUPER PROMPT (RAG + Emotional Intelligence)
// ============================================
function buildRAGSystemPrompt(config, knowledgeDocs) {
    const basePrompt = config.system_prompt || "Tu es un assistant virtuel.";
    const instructions = config.system_instructions || '';
    const personaStyle = config.persona_style || 'FRIENDLY';
    const emojiEnabled = config.emoji_usage !== false;

    // Get persona description
    const personaDescription = getPersonaStyleDescription(personaStyle);

    // Concatenate all knowledge documents
    let contextData = '';
    if (knowledgeDocs.length > 0) {
        contextData = knowledgeDocs.map(doc =>
            `📄 ${doc.source_name}:\n${doc.content}`
        ).join('\n\n---\n\n');
    }

    // Build the Super Prompt with Human Touch
    let systemPrompt = `${basePrompt}

🎭 STYLE DE COMMUNICATION :
${personaDescription}
Utilisation des émojis : ${emojiEnabled ? 'OUI, utilise des émojis appropriés pour rendre la conversation vivante' : 'NON, ne mets pas d\'émojis'}.`;

    if (instructions) {
        systemPrompt += `\n\n📝 INSTRUCTIONS SUPPLÉMENTAIRES :\n${instructions}`;
    }

    // Emotional Intelligence Directive
    systemPrompt += `

🎯 DIRECTIVE D'ANALYSE ÉMOTIONNELLE (Interne) :
Avant de répondre, analyse l'émotion du dernier message de l'utilisateur :
- Si COLÈRE/FRUSTRATION : Sois calme, excuse-toi sincèrement, ne fais pas d'humour, sois concis et solution-orienté.
- Si JOIE/EXCITATION : Sois enthousiaste et partage leur énergie positive.
- Si URGENCE : Va droit au but, pas de blabla, sois efficace.
- Si CONFUSION : Sois patient, explique clairement, propose de l'aide supplémentaire.
- Si NEUTRE : Garde le style par défaut défini ci-dessus.`;

    // Knowledge Base (RAG)
    if (contextData) {
        systemPrompt += `

📚 BASE DE CONNAISSANCE OFFICIELLE :
Utilise ces informations pour répondre factuellement :
---
${contextData}
---`;
    }

    // Strict Constraints
    systemPrompt += `

⛔ CONTRAINTES STRICTES :
- Ne dis JAMAIS "En tant qu'IA..." ou "Je suis un assistant virtuel".
- Fais des phrases courtes et naturelles (comme un humain sur WhatsApp).
- Si la réponse n'est pas dans la base de connaissance, dis-le poliment et propose de contacter un humain.
- N'invente JAMAIS de prix, produits, horaires ou informations non présentes dans la base.
- Sois concis : les messages longs fatiguent sur WhatsApp.`;

    return systemPrompt;
}

// ============================================
// GET CONVERSATION HISTORY FOR AI CONTEXT
// ============================================
async function getConversationHistory(conversationId, limit = 10) {
    try {
        const result = await pool.query(
            `SELECT direction, body, type FROM messages 
             WHERE conversation_id = $1 AND type = 'text'
             ORDER BY created_at DESC LIMIT $2`,
            [conversationId, limit]
        );

        // Reverse to get chronological order and map to chat format
        return result.rows.reverse().map(msg => ({
            role: msg.direction === 'inbound' ? 'user' : 'assistant',
            content: msg.body || ''
        }));
    } catch (err) {
        console.error('[Worker] ❌ Failed to get conversation history:', err.message);
        return [];
    }
}

// ============================================
// GENERATE AI RESPONSE
// ============================================
async function generateAIResponse(conversationId, tenantId) {
    const config = await getAIConfig(tenantId);

    if (!config) {
        console.log('[Worker] ⏭️ AI not configured or not active for tenant');
        return null;
    }

    if (!config.api_key) {
        console.log('[Worker] ⏭️ AI API key not set for tenant');
        return null;
    }

    try {
        const messages = await getConversationHistory(conversationId);

        if (messages.length === 0) {
            console.log('[Worker] ⏭️ No messages in conversation for AI context');
            return null;
        }

        // Load knowledge base for RAG
        const knowledgeDocs = await getKnowledgeBase(tenantId);
        console.log(`[Worker] 📚 Loaded ${knowledgeDocs.length} knowledge documents`);

        // Build RAG-enhanced system prompt
        const ragSystemPrompt = buildRAGSystemPrompt(config, knowledgeDocs);

        // Create enhanced config with RAG prompt
        const ragConfig = {
            ...config,
            system_prompt: ragSystemPrompt
        };

        console.log(`[Worker] 🤖 Generating AI response using ${config.provider} with RAG...`);
        const response = await AIFactory.generate(ragConfig, messages);
        console.log('[Worker] ✅ AI response generated');

        return response;
    } catch (err) {
        console.error('[Worker] ❌ AI generation failed:', err.message);
        return null;
    }
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
// PROCESS TEMPLATE STATUS UPDATE
// ============================================
async function processTemplateStatusUpdate(value) {
    try {
        const templateId = value.message_template_id;
        const templateName = value.message_template_name;
        const newStatus = value.event; // APPROVED, REJECTED, PAUSED, DISABLED, etc.
        const reason = value.reason || null;

        console.log(`[Worker] 📋 Template status update: ${templateName} -> ${newStatus}`);

        // Map Meta events to our status
        let dbStatus = newStatus;
        if (newStatus === 'APPROVED') dbStatus = 'APPROVED';
        else if (newStatus === 'REJECTED') dbStatus = 'REJECTED';
        else if (newStatus === 'PAUSED' || newStatus === 'DISABLED') dbStatus = 'PAUSED';
        else dbStatus = 'PENDING';

        // Update template in database
        const result = await pool.query(
            `UPDATE templates 
             SET meta_status = $1, rejection_reason = $2, updated_at = NOW()
             WHERE wa_template_id = $3 OR name = $4
             RETURNING id, name, meta_status`,
            [dbStatus, reason, String(templateId), templateName]
        );

        if (result.rows.length > 0) {
            console.log(`[Worker] ✅ Template updated: ${result.rows[0].name} -> ${dbStatus}`);
        } else {
            console.log(`[Worker] ⚠️ Template not found in DB: ${templateName} (ID: ${templateId})`);
        }

    } catch (err) {
        console.error('[Worker] ❌ Failed to process template status update:', err.message);
    }
}

// ============================================
// PROCESS WEBHOOK EVENT (V9 Omnichannel)
// Handles: WhatsApp, Instagram, Messenger
// ============================================
async function processEvent(eventData) {
    const startTime = Date.now();

    try {
        const event = JSON.parse(eventData);
        const payload = event.payload;
        const channel = event.channel || 'WHATSAPP'; // V9: Channel from webhook router

        const channelIcon = channel === 'WHATSAPP' ? '🟢' : channel === 'INSTAGRAM' ? '🟣' : '🔵';
        console.log(`[Worker] ${channelIcon} Processing ${channel} event: ${event.id}`);

        // Route to appropriate handler based on channel
        if (channel === 'WHATSAPP') {
            await processWhatsAppEvent(event, payload, startTime);
        } else if (channel === 'INSTAGRAM' || channel === 'MESSENGER') {
            await processSocialEvent(event, payload, channel, startTime);
        } else {
            console.log(`[Worker] ⏭️ Unknown channel, skipping: ${channel}`);
        }

    } catch (parseError) {
        console.error(`[Worker] ❌ Failed to parse event:`, parseError.message);
    }
}

// ============================================
// PROCESS WHATSAPP EVENT (Original Logic)
// ============================================
async function processWhatsAppEvent(event, payload, startTime) {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const field = changes?.field;

    // Handle template status updates
    if (field === 'message_template_status_update') {
        console.log('[Worker] 📋 Template status update received');
        await processTemplateStatusUpdate(value);
        return;
    }

    const messages = value?.messages;
    const contacts = value?.contacts;

    // Skip if no messages
    if (!messages || messages.length === 0) {
        console.log(`[Worker] ⏭️ Skipping event (no messages): ${event.id}`);
        return;
    }

    const message = messages[0];
    const contact = contacts?.[0];
    const waId = message.from;
    const contactName = contact?.profile?.name || null;

    console.log(`[Worker] 🟢 WhatsApp message from ${waId}:`, message.text?.body || `[${message.type}]`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const contactId = await findOrCreateContactOmni(client, { wa_id: waId }, { name: contactName });
        const conversationId = await findOrCreateConversationOmni(client, contactId, 'WHATSAPP');
        await insertMessage(client, conversationId, message, payload);

        await client.query('COMMIT');

        const processingTime = Date.now() - startTime;
        console.log(`[Worker] ✅ WhatsApp event processed in ${processingTime}ms: ${event.id}`);

        // Automation & AI response
        const messageBody = message.text?.body;
        const automationRule = await checkAutomationRules(DEFAULT_TENANT_ID, messageBody);

        if (automationRule) {
            console.log(`[Worker] 🤖 Triggering automated reply...`);
            const msgId = await sendMessageByChannel('WHATSAPP', waId, automationRule.response_text);
            if (msgId) {
                await insertAutomatedMessage(conversationId, automationRule.response_text, msgId);
            }
        } else {
            console.log('[Worker] 🧠 No automation rule matched, trying AI response...');
            const aiResponse = await generateAIResponse(conversationId, DEFAULT_TENANT_ID);
            if (aiResponse) {
                console.log('[Worker] 💬 Sending AI-generated response...');
                const msgId = await sendMessageByChannel('WHATSAPP', waId, aiResponse);
                if (msgId) {
                    await insertAutomatedMessage(conversationId, aiResponse, msgId);
                }
            }
        }

    } catch (dbError) {
        await client.query('ROLLBACK');
        console.error(`[Worker] ❌ DB transaction failed:`, dbError.message);
    } finally {
        client.release();
    }
}

// ============================================
// PROCESS INSTAGRAM/MESSENGER EVENT (V9 New)
// ============================================
async function processSocialEvent(event, payload, channel, startTime) {
    const entry = payload?.entry?.[0];

    // Instagram & Messenger use 'messaging' array instead of 'changes'
    const messagingEvents = entry?.messaging || [];

    if (messagingEvents.length === 0) {
        // Try changes array (some Instagram events use this)
        const changes = entry?.changes?.[0];
        if (changes?.value?.messages) {
            // Handle Instagram webhook API v2 format
            console.log(`[Worker] Processing ${channel} via changes format`);
            // TODO: Implement if needed
        }
        console.log(`[Worker] ⏭️ Skipping ${channel} event (no messaging): ${event.id}`);
        return;
    }

    const msgEvent = messagingEvents[0];
    const senderId = msgEvent.sender?.id;
    const messageData = msgEvent.message;
    const messageText = messageData?.text;
    const messageId = messageData?.mid;

    if (!senderId || !messageData) {
        console.log(`[Worker] ⏭️ Skipping ${channel} event (incomplete data): ${event.id}`);
        return;
    }

    const channelIcon = channel === 'INSTAGRAM' ? '🟣' : '🔵';
    console.log(`[Worker] ${channelIcon} ${channel} message from ${senderId}:`, messageText || `[attachment]`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Build identifier based on channel
        const identifiers = channel === 'INSTAGRAM'
            ? { instagram_id: senderId }
            : { messenger_id: senderId };

        // TODO: Fetch profile from Graph API for name/avatar
        // GET /{PSID}?fields=name,profile_pic
        const profileData = { name: `${channel} User ${senderId.slice(-4)}` };

        const contactId = await findOrCreateContactOmni(client, identifiers, profileData);
        const conversationId = await findOrCreateConversationOmni(client, contactId, channel);

        // Insert message (adapt format for insertMessage)
        const normalizedMessage = {
            id: messageId,
            from: senderId,
            type: messageData.attachments ? 'image' : 'text',
            text: { body: messageText },
            timestamp: Math.floor(Date.now() / 1000).toString()
        };

        await insertMessage(client, conversationId, normalizedMessage, payload);

        await client.query('COMMIT');

        const processingTime = Date.now() - startTime;
        console.log(`[Worker] ✅ ${channel} event processed in ${processingTime}ms: ${event.id}`);

        // Automation & AI response for social channels
        if (messageText) {
            const automationRule = await checkAutomationRules(DEFAULT_TENANT_ID, messageText);

            if (automationRule) {
                console.log(`[Worker] 🤖 Triggering automated ${channel} reply...`);
                const msgId = await sendMessageByChannel(channel, senderId, automationRule.response_text);
                if (msgId) {
                    await insertAutomatedMessage(conversationId, automationRule.response_text, msgId);
                }
            } else {
                console.log(`[Worker] 🧠 Trying AI response for ${channel}...`);
                const aiResponse = await generateAIResponse(conversationId, DEFAULT_TENANT_ID);
                if (aiResponse) {
                    console.log(`[Worker] 💬 Sending AI-generated ${channel} response...`);
                    const msgId = await sendMessageByChannel(channel, senderId, aiResponse);
                    if (msgId) {
                        await insertAutomatedMessage(conversationId, aiResponse, msgId);
                    }
                }
            }
        }

    } catch (dbError) {
        await client.query('ROLLBACK');
        console.error(`[Worker] ❌ ${channel} DB transaction failed:`, dbError.message);
    } finally {
        client.release();
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
// CAMPAIGN WORKER (BullMQ with Rate Limiting)
// ============================================
const { Worker, Queue } = require('bullmq');

const MARKETING_QUEUE_NAME = 'marketing_queue';

// Create BullMQ connection config
const bullmqConnection = {
    host: REDIS_HOST,
    port: REDIS_PORT
};

/**
 * Check if error is retryable (temporary)
 */
function isRetryableError(error) {
    // Rate limit (429)
    if (error.response?.status === 429) return true;
    // Server errors (5xx)
    if (error.response?.status >= 500) return true;
    // Timeout errors
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;
    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') return true;
    // WhatsApp temporary errors
    const waError = error.response?.data?.error;
    if (waError?.code === 130472) return true; // Rate limit
    if (waError?.code === 131053) return true; // Temporarily unavailable
    return false;
}

/**
 * Send WhatsApp Template Message for Campaign with Retry Logic
 * @param {string} phone - Destination phone number
 * @param {string} templateName - Template name
 * @param {string} language - Template language
 * @param {number} maxRetries - Max retry attempts (default 3)
 * @returns {Object} { success: boolean, waMessageId: string|null, error: string|null, retries: number }
 */
async function sendCampaignTemplate(phone, templateName, language = 'fr', maxRetries = 3) {
    if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
        console.error('[Campaign] ❌ Meta credentials not configured');
        return { success: false, waMessageId: null, error: 'Meta credentials not configured', retries: 0 };
    }

    let lastError = null;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.post(
                `${META_API_URL}/${META_PHONE_ID}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: phone.replace(/\D/g, ''), // Remove non-digits
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: language }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                }
            );

            const waMessageId = response.data?.messages?.[0]?.id;
            console.log(`[Campaign] ✅ Template sent to ${phone}: ${waMessageId}${attempt > 0 ? ` (after ${attempt} retries)` : ''}`);
            return { success: true, waMessageId, error: null, retries: attempt };
        } catch (err) {
            lastError = err;
            const errorMessage = err.response?.data?.error?.message || err.message;

            if (isRetryableError(err) && attempt < maxRetries) {
                // Calculate exponential backoff: 1s, 2s, 4s
                const delayMs = Math.pow(2, attempt) * 1000;
                console.log(`[Campaign] ⚠️ Retryable error for ${phone}: ${errorMessage}`);
                console.log(`[Campaign] 🔄 Retry ${attempt + 1}/${maxRetries} in ${delayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                retries = attempt + 1;
            } else {
                // Non-retryable error or max retries reached
                console.error(`[Campaign] ❌ Failed to send to ${phone}:`, errorMessage);
                break;
            }
        }
    }

    // Return failure with last error
    const errorMessage = lastError?.response?.data?.error?.message || lastError?.message || 'Unknown error';
    return {
        success: false,
        waMessageId: null,
        error: retries >= maxRetries ? `Failed after ${maxRetries} retries: ${errorMessage}` : errorMessage,
        retries
    };
}

/**
 * Update campaign_item status and create message record
 */
async function updateCampaignItem(campaignItemId, campaignId, tenantId, phone, success, waMessageId, errorMessage = null) {
    try {
        // Update campaign_item status
        const status = success ? 'SENT' : 'FAILED';
        await pool.query(
            `UPDATE campaign_items 
             SET status = $1, sent_at = NOW(), error_message = $2
             WHERE id = $3`,
            [status, errorMessage, campaignItemId]
        );

        // If successful, create a message record for chat history
        if (success && waMessageId) {
            // First, find or create conversation for this contact
            const convResult = await pool.query(
                `SELECT id FROM conversations 
                 WHERE tenant_id = $1 AND phone = $2
                 LIMIT 1`,
                [tenantId, phone]
            );

            let conversationId = convResult.rows[0]?.id;

            if (!conversationId) {
                // Create conversation if doesn't exist
                const newConv = await pool.query(
                    `INSERT INTO conversations (tenant_id, phone, status)
                     VALUES ($1, $2, 'open')
                     RETURNING id`,
                    [tenantId, phone]
                );
                conversationId = newConv.rows[0].id;
            }

            // Insert message
            const msgResult = await pool.query(
                `INSERT INTO messages 
                 (tenant_id, conversation_id, direction, type, body, wa_message_id, status)
                 VALUES ($1, $2, 'outgoing', 'template', $3, $4, 'sent')
                 RETURNING id`,
                [tenantId, conversationId, `[Template Campaign]`, waMessageId]
            );

            // Link message to campaign_item
            await pool.query(
                `UPDATE campaign_items SET message_id = $1 WHERE id = $2`,
                [msgResult.rows[0].id, campaignItemId]
            );
        }

        // Check if campaign is complete
        const statsResult = await pool.query(
            `SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status IN ('SENT', 'FAILED')) as processed
             FROM campaign_items 
             WHERE campaign_id = $1`,
            [campaignId]
        );

        const { total, processed } = statsResult.rows[0];
        if (parseInt(processed) >= parseInt(total)) {
            await pool.query(
                `UPDATE campaigns 
                 SET status = 'COMPLETED', completed_at = NOW() 
                 WHERE id = $1`,
                [campaignId]
            );
            console.log(`[Campaign] 🎉 Campaign ${campaignId} completed!`);
        }

    } catch (err) {
        console.error(`[Campaign] ❌ Failed to update campaign_item:`, err.message);
    }
}

/**
 * Marketing Queue Processor with Rate Limiting
 * ⚠️ SÉCURITÉ: 5 messages/seconde MAX (200ms entre chaque)
 */
async function startMarketingWorker() {
    console.log('[Marketing Worker] 🚀 Starting Marketing Worker...');
    console.log('[Marketing Worker] ⚠️ Rate Limit: 5 messages/second (200ms delay)');

    // Rate limiting: max 5 messages per second = 200ms between messages
    const RATE_LIMIT_MS = 200;

    while (true) {
        try {
            // BRPOP from marketing_queue
            const result = await redis.brpop(MARKETING_QUEUE_NAME, 5);

            if (result) {
                const [, jobData] = result;
                const job = JSON.parse(jobData);

                if (job.type === 'CAMPAIGN_SEND') {
                    console.log(`[Marketing] 📤 Sending to ${job.phone} (template: ${job.templateName})`);

                    const result = await sendCampaignTemplate(
                        job.phone,
                        job.templateName,
                        job.templateLanguage
                    );

                    // Update campaign_item with result (including retry info)
                    await updateCampaignItem(
                        job.campaignItemId,
                        job.campaignId,
                        job.tenantId,
                        job.phone,
                        result.success,
                        result.waMessageId,
                        result.error
                    );

                    // ⚠️ RATE LIMITING - Wait 200ms before next message
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
                }
                // ============================================
                // V8.95: SEND EVENT BADGE JOB
                // ============================================
                else if (job.type === 'SEND_EVENT_BADGE') {
                    console.log(`[Badge Worker] 🪪 Generating badge for ${job.attendee_name} (${job.attendee_phone})`);

                    try {
                        // Get event info
                        const eventResult = await pool.query(
                            `SELECT * FROM events WHERE id = $1`,
                            [job.event_id]
                        );

                        if (eventResult.rows.length === 0) {
                            console.error(`[Badge Worker] ❌ Event ${job.event_id} not found`);
                            continue;
                        }

                        const event = eventResult.rows[0];

                        // Get ticket info
                        const ticketResult = await pool.query(
                            `SELECT * FROM tickets WHERE id = $1`,
                            [job.ticket_id]
                        );

                        if (ticketResult.rows.length === 0) {
                            console.error(`[Badge Worker] ❌ Ticket ${job.ticket_id} not found`);
                            continue;
                        }

                        const ticket = ticketResult.rows[0];

                        // ============================================
                        // GENERATE BADGE IMAGE
                        // ============================================
                        const qrDataUrl = await QRCode.toDataURL(ticket.qr_code_data, {
                            errorCorrectionLevel: 'M',
                            margin: 1,
                            width: 100,
                            color: { dark: '#2D3748', light: '#FFFFFF' }
                        });
                        const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

                        // Parse name
                        const nameParts = (job.attendee_name || '').split(' ');
                        const firstName = nameParts[0] || '';
                        const lastName = nameParts.slice(1).join(' ') || '';

                        // Role color
                        const roleColors = {
                            'VIP': '#F59E0B', 'SPEAKER': '#8B5CF6', 'STAFF': '#EF4444',
                            'ORGANISATEUR': '#059669', 'ORGANIZER': '#059669'
                        };
                        const roleColor = roleColors[(job.attendee_role || '').toUpperCase()] || '#3B82F6';

                        // Format dates
                        const startDate = new Date(event.date_start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
                        const endDate = event.date_end ? new Date(event.date_end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null;
                        const dateText = endDate ? `${startDate} - ${endDate}` : startDate;

                        const badgeWidth = 600;
                        const badgeHeight = 400;

                        const badgeSvg = `
                            <svg width="${badgeWidth}" height="${badgeHeight}" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" style="stop-color:#FAFAFA"/>
                                        <stop offset="100%" style="stop-color:#F3F4F6"/>
                                    </linearGradient>
                                </defs>
                                <rect width="${badgeWidth}" height="${badgeHeight}" fill="url(#bg)" rx="16"/>
                                <rect x="0" y="0" width="${badgeWidth}" height="12" fill="#1F2937" rx="8"/>
                                <rect x="0" y="${badgeHeight - 12}" width="${badgeWidth}" height="12" fill="#1F2937" rx="8"/>
                                <text x="30" y="55" font-family="Arial, sans-serif" font-size="14" fill="#6B7280">${event.title}</text>
                                <text x="30" y="130" font-family="Arial Black, sans-serif" font-size="52" fill="#111827" font-weight="900">${firstName}</text>
                                <text x="30" y="180" font-family="Arial, sans-serif" font-size="36" fill="#374151" font-weight="700">${lastName.toUpperCase()}</text>
                                <text x="30" y="220" font-family="Arial, sans-serif" font-size="18" fill="#6B7280">${job.attendee_company || ''}</text>
                                <rect x="30" y="245" width="${Math.min((job.attendee_role || 'PARTICIPANT').length * 14 + 30, 200)}" height="36" fill="${roleColor}" rx="18"/>
                                <text x="48" y="270" font-family="Arial, sans-serif" font-size="14" fill="white" font-weight="700">${(job.attendee_role || 'PARTICIPANT').toUpperCase()}</text>
                                <text x="30" y="350" font-family="Arial, sans-serif" font-size="12" fill="#9CA3AF">📅 ${dateText}</text>
                                ${event.location_details ? `<text x="30" y="370" font-family="Arial, sans-serif" font-size="12" fill="#9CA3AF">📍 ${event.location_details.substring(0, 40)}</text>` : ''}
                                <image href="data:image/png;base64,${qrBase64}" x="${badgeWidth - 130}" y="${badgeHeight - 150}" width="100" height="100"/>
                            </svg>
                        `;

                        const documentBuffer = await sharp(Buffer.from(badgeSvg))
                            .png()
                            .toBuffer();

                        // Save to disk
                        const TICKETS_DIR = '/app/uploads/tickets';
                        if (!fs.existsSync(TICKETS_DIR)) {
                            fs.mkdirSync(TICKETS_DIR, { recursive: true });
                        }
                        const documentFilename = `badge-${ticket.id}.png`;
                        const documentPath = path.join(TICKETS_DIR, documentFilename);
                        await fs.promises.writeFile(documentPath, documentBuffer);
                        const documentUrl = `/uploads/tickets/${documentFilename}`;

                        // Update ticket with badge URL
                        await pool.query(
                            `UPDATE tickets SET badge_url = $1 WHERE id = $2`,
                            [documentUrl, ticket.id]
                        );

                        // ============================================
                        // SEND VIA WHATSAPP
                        // ============================================
                        const formData = new FormData();
                        formData.append('file', documentBuffer, {
                            filename: documentFilename,
                            contentType: 'image/png'
                        });
                        formData.append('messaging_product', 'whatsapp');
                        formData.append('type', 'image/png');

                        const uploadResponse = await axios.post(
                            `https://graph.facebook.com/v17.0/${META_PHONE_ID}/media`,
                            formData,
                            {
                                headers: {
                                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                                    ...formData.getHeaders()
                                }
                            }
                        );

                        const mediaId = uploadResponse.data.id;

                        // Send WhatsApp message
                        const caption = `👋 Bonjour ${firstName} !\n\nVoici votre *Badge d'Accès* pour *${event.title}*.\n\n📅 ${dateText}\n${event.location_details ? `📍 ${event.location_details}\n` : ''}\n✅ Présentez ce QR code à l'entrée.\n\nÀ très bientôt ! 🎉`;

                        await axios.post(
                            `https://graph.facebook.com/v17.0/${META_PHONE_ID}/messages`,
                            {
                                messaging_product: 'whatsapp',
                                recipient_type: 'individual',
                                to: job.attendee_phone,
                                type: 'image',
                                image: { id: mediaId, caption }
                            },
                            {
                                headers: {
                                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                                    'Content-Type': 'application/json'
                                }
                            }
                        );

                        // Update ticket sent_at
                        await pool.query(
                            `UPDATE tickets SET sent_at = NOW() WHERE id = $1`,
                            [ticket.id]
                        );

                        console.log(`[Badge Worker] ✅ Badge sent to ${job.attendee_phone}`);

                        // ============================================
                        // EMAIL BACKUP (if email provided)
                        // ============================================
                        if (ticket.attendee_email) {
                            try {
                                // Get tenant SMTP config or use default
                                const smtpConfig = await pool.query(
                                    `SELECT * FROM email_configs WHERE tenant_id = $1`,
                                    [event.tenant_id]
                                );

                                let transporter;
                                if (smtpConfig.rows.length > 0 && smtpConfig.rows[0].smtp_host) {
                                    const cfg = smtpConfig.rows[0];
                                    transporter = nodemailer.createTransport({
                                        host: cfg.smtp_host,
                                        port: cfg.smtp_port || 587,
                                        secure: cfg.smtp_port === 465,
                                        auth: {
                                            user: cfg.smtp_user,
                                            pass: cfg.smtp_password
                                        }
                                    });
                                } else {
                                    // Fallback: Use environment SMTP or Ethereal for testing
                                    if (process.env.SMTP_HOST) {
                                        transporter = nodemailer.createTransport({
                                            host: process.env.SMTP_HOST,
                                            port: parseInt(process.env.SMTP_PORT || '587'),
                                            secure: process.env.SMTP_PORT === '465',
                                            auth: {
                                                user: process.env.SMTP_USER,
                                                pass: process.env.SMTP_PASSWORD
                                            }
                                        });
                                    } else {
                                        // Create test account for dev
                                        const testAccount = await nodemailer.createTestAccount();
                                        transporter = nodemailer.createTransport({
                                            host: 'smtp.ethereal.email',
                                            port: 587,
                                            auth: {
                                                user: testAccount.user,
                                                pass: testAccount.pass
                                            }
                                        });
                                    }
                                }

                                const emailHtml = `
                                    <!DOCTYPE html>
                                    <html>
                                    <head>
                                        <meta charset="utf-8">
                                        <style>
                                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; padding: 40px 20px; }
                                            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
                                            .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px; text-align: center; }
                                            .header h1 { color: white; margin: 0; font-size: 28px; }
                                            .content { padding: 40px; }
                                            .badge-preview { background: #f9fafb; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
                                            .info { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; margin: 20px 0; }
                                            .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
                                        </style>
                                    </head>
                                    <body>
                                        <div class="container">
                                            <div class="header">
                                                <h1>🎟️ Votre Badge est prêt !</h1>
                                            </div>
                                            <div class="content">
                                                <p>Bonjour <strong>${firstName}</strong>,</p>
                                                <p>Merci pour votre inscription à <strong>${event.title}</strong> !</p>
                                                
                                                <div class="info">
                                                    <strong>📅 Date :</strong> ${dateText}<br>
                                                    ${event.location_details ? `<strong>📍 Lieu :</strong> ${event.location_details}` : ''}
                                                </div>
                                                
                                                <div class="badge-preview">
                                                    <p>Votre badge est en pièce jointe de cet email.</p>
                                                    <p><strong>Présentez le QR code à l'entrée.</strong></p>
                                                </div>
                                                
                                                <p>💡 <em>Vous avez également reçu ce badge par WhatsApp.</em></p>
                                                
                                                <p>À très bientôt ! 🎉</p>
                                            </div>
                                            <div class="footer">
                                                Cet email a été envoyé automatiquement par le système d'inscription.
                                            </div>
                                        </div>
                                    </body>
                                    </html>
                                `;

                                const mailOptions = {
                                    from: process.env.SMTP_FROM || '"Événements" <noreply@vectra.io>',
                                    to: ticket.attendee_email,
                                    subject: `🎟️ Votre Badge - ${event.title}`,
                                    html: emailHtml,
                                    attachments: [{
                                        filename: `badge-${firstName.toLowerCase()}.png`,
                                        content: documentBuffer,
                                        contentType: 'image/png'
                                    }]
                                };

                                const info = await transporter.sendMail(mailOptions);
                                console.log(`[Badge Worker] 📧 Email backup sent to ${ticket.attendee_email}`);

                                // Log preview URL for Ethereal (dev only)
                                if (info.messageId && info.envelope) {
                                    const previewUrl = nodemailer.getTestMessageUrl(info);
                                    if (previewUrl) {
                                        console.log(`[Badge Worker] 📧 Preview: ${previewUrl}`);
                                    }
                                }

                                // Update ticket with email_sent_at
                                await pool.query(
                                    `UPDATE tickets SET email_sent_at = NOW() WHERE id = $1`,
                                    [ticket.id]
                                );

                            } catch (emailErr) {
                                console.error(`[Badge Worker] ⚠️ Email backup failed for ${ticket.attendee_email}:`, emailErr.message);
                                // Don't throw - email is backup, WhatsApp was successful
                            }
                        }

                    } catch (badgeErr) {
                        console.error(`[Badge Worker] ❌ Failed to send badge to ${job.attendee_phone}:`, badgeErr.message);
                    }

                    // ⚠️ RATE LIMITING - Wait 200ms before next message
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
                }
            }
        } catch (err) {
            console.error('[Marketing Worker] ❌ Error:', err.message);
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

    // Start polling for inbound messages
    startPolling();

    // Start marketing worker (runs concurrently) - 5 msg/sec rate limit
    startMarketingWorker();
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

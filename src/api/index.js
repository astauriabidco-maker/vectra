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
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const he = require('he');
const { YoutubeTranscript } = require('youtube-transcript');
const QRCode = require('qrcode');
const sharp = require('sharp');
require('dotenv').config();

// Gemini AI Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let geminiModel = null;
if (GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    console.log('[API] 🤖 Gemini AI initialized');
} else {
    console.log('[API] ⚠️ GEMINI_API_KEY not set - AI suggestions disabled');
}

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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
});

// ============================================
// MULTIPART FILE UPLOAD CONFIGURATION
// ============================================
server.register(multipart, {
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    }
});

// ============================================
// STATIC FILE SERVING (for uploaded media)
// ============================================
const UPLOADS_DIR = path.join(__dirname, '../../uploads/media');
// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
server.register(fastifyStatic, {
    root: UPLOADS_DIR,
    prefix: '/uploads/media/',
    decorateReply: false
});

// Serve ticket images
const TICKETS_DIR = path.join('/app/uploads', 'tickets');
if (!fs.existsSync(TICKETS_DIR)) {
    fs.mkdirSync(TICKETS_DIR, { recursive: true });
}
server.register(fastifyStatic, {
    root: TICKETS_DIR,
    prefix: '/uploads/tickets/',
    decorateReply: false
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
// MEDIA LIBRARY ROUTES (V3.10)
// ============================================

// Allowed MIME types for each media type
const ALLOWED_MIME_TYPES = {
    IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
    VIDEO: ['video/mp4', 'video/3gpp'],
    DOCUMENT: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};

// Helper function to determine media type from MIME
function getMediaType(mimeType) {
    if (ALLOWED_MIME_TYPES.IMAGE.includes(mimeType)) return 'IMAGE';
    if (ALLOWED_MIME_TYPES.VIDEO.includes(mimeType)) return 'VIDEO';
    if (ALLOWED_MIME_TYPES.DOCUMENT.includes(mimeType)) return 'DOCUMENT';
    return null;
}

// POST /media/upload - Upload a media file
server.post('/media/upload', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const data = await request.file();

        if (!data) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }

        const { filename: originalName, mimetype } = data;
        const mediaType = getMediaType(mimetype);

        if (!mediaType) {
            return reply.status(400).send({
                error: 'Invalid file type',
                allowed: Object.values(ALLOWED_MIME_TYPES).flat()
            });
        }

        // Generate unique filename
        const ext = path.extname(originalName);
        const uniqueFilename = `${crypto.randomUUID()}${ext}`;
        const filePath = path.join(UPLOADS_DIR, uniqueFilename);

        // Save file to disk
        const buffer = await data.toBuffer();
        fs.writeFileSync(filePath, buffer);

        const sizeBytes = buffer.length;
        const fileUrl = `/uploads/media/${uniqueFilename}`;

        // Save to database
        const result = await pool.query(`
            INSERT INTO media (tenant_id, filename, original_name, mime_type, size_bytes, url, media_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, filename, original_name, mime_type, size_bytes, url, media_type, created_at
        `, [request.tenantId, uniqueFilename, originalName, mimetype, sizeBytes, fileUrl, mediaType]);

        console.log(`[API] 📁 Media uploaded: ${uniqueFilename} (${mediaType}, ${sizeBytes} bytes)`);

        return reply.status(201).send({
            success: true,
            media: result.rows[0]
        });

    } catch (err) {
        console.error('[API] ❌ Media upload error:', err.message);
        return reply.status(500).send({ error: 'Failed to upload file' });
    }
});

// GET /library/media - List all media for tenant
server.get('/library/media', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const { type } = request.query; // Optional filter by media_type

        let query = `
            SELECT id, filename, original_name, mime_type, size_bytes, url, media_type, created_at
            FROM media
            WHERE tenant_id = $1
        `;
        const params = [request.tenantId];

        if (type && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(type)) {
            query += ` AND media_type = $2`;
            params.push(type);
        }

        query += ` ORDER BY created_at DESC`;

        const result = await pool.query(query, params);

        return reply.send({
            success: true,
            media: result.rows,
            count: result.rows.length
        });

    } catch (err) {
        console.error('[API] ❌ Media list error:', err.message);
        return reply.status(500).send({ error: 'Failed to fetch media' });
    }
});

// DELETE /library/media/:id - Delete a media file
server.delete('/library/media/:id', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const { id } = request.params;

        // Get file info first
        const existing = await pool.query(`
            SELECT filename FROM media WHERE id = $1 AND tenant_id = $2
        `, [id, request.tenantId]);

        if (existing.rows.length === 0) {
            return reply.status(404).send({ error: 'Media not found' });
        }

        const filename = existing.rows[0].filename;
        const filePath = path.join(UPLOADS_DIR, filename);

        // Delete from filesystem
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Delete from database
        await pool.query(`DELETE FROM media WHERE id = $1`, [id]);

        console.log(`[API] 🗑️ Media deleted: ${filename}`);

        return reply.send({ success: true, message: 'Media deleted' });

    } catch (err) {
        console.error('[API] ❌ Media delete error:', err.message);
        return reply.status(500).send({ error: 'Failed to delete media' });
    }
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
// GET /auth/me
// Retourne les infos de l'utilisateur connecté + tenant
// ============================================
server.get('/auth/me', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT 
                u.id, u.email, u.role,
                t.id as tenant_id, t.name as tenant_name
             FROM users u
             JOIN tenants t ON u.tenant_id = t.id
             WHERE u.id = $1`,
            [request.userId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'User not found' });
        }

        const row = result.rows[0];
        return reply.send({
            user: {
                id: row.id,
                email: row.email,
                role: row.role
            },
            tenant: {
                id: row.tenant_id,
                name: row.tenant_name
            }
        });
    } catch (err) {
        console.error('[API] ❌ Auth me error:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// GET /conversations
// Liste des conversations du tenant (V9 Omnichannel)
// ============================================
server.get('/conversations', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT 
        conv.id,
        conv.status,
        conv.channel,
        conv.last_customer_message_at,
        conv.updated_at,
        c.wa_id,
        c.instagram_id,
        c.messenger_id,
        c.name as contact_name,
        c.avatar_url
      FROM conversations conv
      JOIN contacts c ON conv.contact_id = c.id
      WHERE conv.tenant_id = $1
      ORDER BY conv.last_customer_message_at DESC NULLS LAST`,
            [request.tenantId]
        );

        const conversations = result.rows.map(row => ({
            id: row.id,
            contact_name: row.contact_name || row.wa_id || row.instagram_id || row.messenger_id,
            wa_id: row.wa_id,
            instagram_id: row.instagram_id,
            messenger_id: row.messenger_id,
            avatar_url: row.avatar_url,
            channel: row.channel || 'WHATSAPP',
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
            `SELECT id, name, language, meta_status, body_text, variables_count, content, wa_template_id, 
                    usage_count, last_used_at 
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

            // Extract rejection reason from Meta response
            let rejectionReason = null;
            if (tpl.status === 'REJECTED') {
                // Meta includes rejection info in the rejected_reason field or quality_score
                rejectionReason = tpl.rejected_reason || tpl.reason || null;

                // Check for quality score issues
                if (tpl.quality_score) {
                    const qualityInfo = tpl.quality_score.score ? `Qualité: ${tpl.quality_score.score}` : '';
                    const reasons = tpl.quality_score.reasons?.join(', ') || '';
                    if (reasons) {
                        rejectionReason = rejectionReason ? `${rejectionReason} - ${reasons}` : reasons;
                    }
                    if (qualityInfo && !rejectionReason) {
                        rejectionReason = qualityInfo;
                    }
                }
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
                        rejection_reason = $6,
                        updated_at = NOW()
                     WHERE id = $7`,
                    [
                        tpl.id,
                        tpl.status,
                        bodyText,
                        variablesCount,
                        JSON.stringify(tpl),
                        rejectionReason,
                        existing.rows[0].id
                    ]
                );
                updated++;
            } else {
                // Insert new
                await pool.query(
                    `INSERT INTO templates 
                        (tenant_id, wa_template_id, name, language, meta_status, body_text, variables_count, content, rejection_reason)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        request.tenantId,
                        tpl.id,
                        tpl.name,
                        tpl.language,
                        tpl.status,
                        bodyText,
                        variablesCount,
                        JSON.stringify(tpl),
                        rejectionReason
                    ]
                );
                synced++;
            }
        }

        console.log(`[API] ✅ Sync complete: ${synced} new, ${updated} updated`);

        // Return updated list
        const result = await pool.query(
            `SELECT id, name, language, meta_status, body_text, variables_count, rejection_reason, wa_template_id, content,
                    usage_count, last_used_at 
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
// TEMPLATE VERSION HISTORY
// ============================================

// Helper function to create a version snapshot
async function createTemplateVersion(templateId, tenantId, changeType, changeDescription, changedBy) {
    try {
        // Get current template data
        const templateResult = await pool.query(
            'SELECT * FROM templates WHERE id = $1 AND tenant_id = $2',
            [templateId, tenantId]
        );

        if (templateResult.rows.length === 0) return null;

        const template = templateResult.rows[0];

        // Get next version number
        const versionResult = await pool.query(
            'SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM template_versions WHERE template_id = $1',
            [templateId]
        );
        const nextVersion = versionResult.rows[0].next_version;

        // Insert version
        const insertResult = await pool.query(`
            INSERT INTO template_versions 
            (template_id, tenant_id, version_number, name, language, category, body_text, content, meta_status, change_type, change_description, changed_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            templateId,
            tenantId,
            nextVersion,
            template.name,
            template.language,
            template.category,
            template.body_text,
            template.content,
            template.meta_status,
            changeType,
            changeDescription,
            changedBy
        ]);

        console.log(`[API] 📜 Created version ${nextVersion} for template ${template.name}`);
        return insertResult.rows[0];
    } catch (err) {
        console.error('[API] ❌ Error creating version:', err.message);
        return null;
    }
}

// GET /templates/:id/history - Get version history for a template
server.get('/templates/:id/history', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(`
            SELECT 
                id, version_number, name, language, category, body_text, meta_status,
                change_type, change_description, changed_by, created_at
            FROM template_versions 
            WHERE template_id = $1 AND tenant_id = $2
            ORDER BY version_number DESC
            LIMIT 50
        `, [id, request.tenantId]);

        return reply.send({
            template_id: id,
            versions: result.rows,
            total: result.rows.length
        });
    } catch (err) {
        console.error('[API] ❌ Error fetching history:', err.message);
        return reply.status(500).send({ error: 'Failed to fetch version history' });
    }
});

// POST /templates/:id/versions - Create a version snapshot manually
server.post('/templates/:id/versions', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { description } = request.body || {};

    try {
        const version = await createTemplateVersion(
            id,
            request.tenantId,
            'manual_snapshot',
            description || 'Manual snapshot',
            request.user?.email || 'system'
        );

        if (!version) {
            return reply.status(404).send({ error: 'Template not found' });
        }

        return reply.send({
            success: true,
            message: `Version ${version.version_number} created`,
            version
        });
    } catch (err) {
        console.error('[API] ❌ Error creating version:', err.message);
        return reply.status(500).send({ error: 'Failed to create version' });
    }
});

// POST /templates/:id/versions/:versionId/restore - Restore a previous version
server.post('/templates/:id/versions/:versionId/restore', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { id, versionId } = request.params;

    try {
        // Get the version to restore
        const versionResult = await pool.query(
            'SELECT * FROM template_versions WHERE id = $1 AND template_id = $2 AND tenant_id = $3',
            [versionId, id, request.tenantId]
        );

        if (versionResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Version not found' });
        }

        const version = versionResult.rows[0];

        // Create a snapshot of current state before restoring
        await createTemplateVersion(
            id,
            request.tenantId,
            'pre_restore',
            `Snapshot before restoring to version ${version.version_number}`,
            request.user?.email || 'system'
        );

        // Note: We don't actually update the template in Meta, just the local record
        // The user would need to re-submit to Meta if they want to update the actual template
        await pool.query(`
            UPDATE templates 
            SET body_text = $1, content = $2, updated_at = NOW()
            WHERE id = $3 AND tenant_id = $4
        `, [version.body_text, version.content, id, request.tenantId]);

        // Create a version entry for the restore action
        await createTemplateVersion(
            id,
            request.tenantId,
            'restored',
            `Restored from version ${version.version_number}`,
            request.user?.email || 'system'
        );

        return reply.send({
            success: true,
            message: `Template restored to version ${version.version_number}`,
            restored_version: version.version_number
        });
    } catch (err) {
        console.error('[API] ❌ Error restoring version:', err.message);
        return reply.status(500).send({ error: 'Failed to restore version' });
    }
});

// ============================================
// COMPLIANCE DASHBOARD - Meta Account Health
// ============================================

// GET /compliance/health - Get Meta account compliance status
server.get('/compliance/health', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        // Initialize response with defaults
        const complianceData = {
            account_status: 'UNKNOWN',
            account_review_status: 'NOT_VERIFIED',
            messaging_limit: 'TIER_50',
            messaging_limit_value: 50,
            quality_rating: 'UNKNOWN',
            display_name_status: 'UNKNOWN',
            phone_verified: false,
            business_name: null,
            messages_sent_24h: 0,
            errors: [],
            fetched_at: new Date().toISOString()
        };

        // Get today's message count from DB first (always needed)
        try {
            const countResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM messages 
                WHERE tenant_id = $1 
                AND direction = 'outgoing' 
                AND timestamp >= NOW() - INTERVAL '24 hours'
            `, [request.tenantId]);

            complianceData.messages_sent_24h = parseInt(countResult.rows[0]?.count || '0');
        } catch (dbErr) {
            console.error('[Compliance] ❌ DB query error:', dbErr.message);
        }

        // Check if Meta credentials are configured
        if (!META_ACCESS_TOKEN || !META_WABA_ID || !META_PHONE_ID) {
            complianceData.errors.push('Meta API credentials not configured');
            return reply.send(complianceData);
        }

        // Fetch WABA (WhatsApp Business Account) status
        try {
            const wabaResponse = await axios.get(
                `https://graph.facebook.com/v17.0/${META_WABA_ID}`,
                {
                    params: {
                        access_token: META_ACCESS_TOKEN,
                        fields: 'name,account_review_status,message_template_namespace,on_behalf_of_business_info'
                    }
                }
            );

            const wabaData = wabaResponse.data;
            complianceData.business_name = wabaData.name || null;
            complianceData.account_review_status = wabaData.account_review_status || 'NOT_VERIFIED';
            complianceData.account_status = wabaData.account_review_status === 'APPROVED' ? 'VERIFIED' : 'NOT_VERIFIED';

            console.log('[Compliance] ✅ WABA status fetched:', wabaData.account_review_status);
        } catch (wabaErr) {
            console.error('[Compliance] ❌ WABA fetch error:', wabaErr.response?.data || wabaErr.message);
            complianceData.errors.push(`WABA: ${wabaErr.response?.data?.error?.message || wabaErr.message}`);
        }

        // Fetch Phone Number status (quality rating, messaging limits)
        try {
            const phoneResponse = await axios.get(
                `https://graph.facebook.com/v17.0/${META_PHONE_ID}`,
                {
                    params: {
                        access_token: META_ACCESS_TOKEN,
                        fields: 'verified_name,quality_rating,display_phone_number,name_status,messaging_limit_tier,is_official_business_account,account_mode'
                    }
                }
            );

            const phoneData = phoneResponse.data;
            complianceData.quality_rating = phoneData.quality_rating || 'UNKNOWN';
            complianceData.messaging_limit = phoneData.messaging_limit_tier || 'TIER_50';
            complianceData.display_name_status = phoneData.name_status || 'UNKNOWN';
            complianceData.phone_verified = !!phoneData.verified_name;

            // Parse messaging limit value
            const tierMatch = complianceData.messaging_limit.match(/TIER_(\d+)K?/);
            if (tierMatch) {
                const value = parseInt(tierMatch[1]);
                complianceData.messaging_limit_value = tierMatch[0].includes('K') ? value * 1000 : value;
            }

            console.log('[Compliance] ✅ Phone status fetched: Quality=', phoneData.quality_rating, 'Limit=', phoneData.messaging_limit_tier);
        } catch (phoneErr) {
            console.error('[Compliance] ❌ Phone fetch error:', phoneErr.response?.data || phoneErr.message);
            complianceData.errors.push(`Phone: ${phoneErr.response?.data?.error?.message || phoneErr.message}`);
        }

        return reply.send(complianceData);

    } catch (err) {
        console.error('[Compliance] ❌ Health check error:', err.message);
        return reply.status(500).send({ error: 'Failed to fetch compliance status' });
    }
});

// GET /compliance/status - Detailed status for the wizard
server.get('/compliance/status', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        const status = {
            // Step 1: Phone Number Status
            phone: {
                status: 'UNKNOWN',
                connected: false,
                quality_rating: 'UNKNOWN',
                display_phone: null,
                verified_name: null
            },
            // Step 2: Display Name / Identity
            identity: {
                status: 'UNKNOWN',
                name_status: 'UNKNOWN',
                current_name: null,
                rejection_reason: null
            },
            // Step 3: Business Verification
            business: {
                status: 'UNKNOWN',
                verified: false,
                name: null,
                waba_id: META_WABA_ID || null
            },
            // Messaging limits
            messaging: {
                limit_tier: 'TIER_50',
                limit_value: 50,
                can_send_marketing: false
            },
            errors: [],
            fetched_at: new Date().toISOString()
        };

        if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
            status.errors.push('Meta credentials not configured');
            return reply.send(status);
        }

        // Fetch Phone Number details
        try {
            const phoneRes = await axios.get(
                `https://graph.facebook.com/v17.0/${META_PHONE_ID}`,
                {
                    params: {
                        access_token: META_ACCESS_TOKEN,
                        fields: 'verified_name,quality_rating,display_phone_number,name_status,messaging_limit_tier,status,code_verification_status'
                    }
                }
            );

            const phone = phoneRes.data;
            status.phone.connected = phone.status === 'CONNECTED' || !!phone.verified_name;
            status.phone.status = status.phone.connected ? 'CONNECTED' : 'DISCONNECTED';
            status.phone.quality_rating = phone.quality_rating || 'UNKNOWN';
            status.phone.display_phone = phone.display_phone_number || null;
            status.phone.verified_name = phone.verified_name || null;

            // Identity / Name status
            status.identity.current_name = phone.verified_name || null;
            status.identity.name_status = phone.name_status || 'UNKNOWN';
            status.identity.status = phone.name_status === 'APPROVED' ? 'APPROVED' :
                phone.name_status === 'PENDING_REVIEW' ? 'PENDING' : 'REJECTED';

            // Messaging limits
            status.messaging.limit_tier = phone.messaging_limit_tier || 'TIER_50';
            const tierMatch = status.messaging.limit_tier.match(/TIER_(\d+)K?/);
            if (tierMatch) {
                const value = parseInt(tierMatch[1]);
                status.messaging.limit_value = tierMatch[0].includes('K') ? value * 1000 : value;
            }
            status.messaging.can_send_marketing = status.phone.connected && status.identity.status === 'APPROVED';

            console.log('[Compliance] ✅ Phone status:', phone.status, 'Name:', phone.name_status);
        } catch (err) {
            console.error('[Compliance] ❌ Phone fetch error:', err.response?.data || err.message);
            status.errors.push(`Phone: ${err.response?.data?.error?.message || err.message}`);
        }

        // Fetch WABA / Business verification
        if (META_WABA_ID) {
            try {
                const wabaRes = await axios.get(
                    `https://graph.facebook.com/v17.0/${META_WABA_ID}`,
                    {
                        params: {
                            access_token: META_ACCESS_TOKEN,
                            fields: 'name,account_review_status,business_verification_status,on_behalf_of_business_info'
                        }
                    }
                );

                const waba = wabaRes.data;
                status.business.name = waba.name || null;
                status.business.verified = waba.account_review_status === 'APPROVED' ||
                    waba.business_verification_status === 'verified';
                status.business.status = status.business.verified ? 'VERIFIED' : 'NOT_VERIFIED';

                console.log('[Compliance] ✅ WABA status:', waba.account_review_status);
            } catch (err) {
                console.error('[Compliance] ❌ WABA fetch error:', err.response?.data || err.message);
                status.errors.push(`WABA: ${err.response?.data?.error?.message || err.message}`);
            }
        }

        return reply.send(status);

    } catch (err) {
        console.error('[Compliance] ❌ Status check error:', err.message);
        return reply.status(500).send({ error: 'Failed to fetch compliance status' });
    }
});

// POST /compliance/trigger-sms - Request new OTP for phone reconnection
server.post('/compliance/trigger-sms', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
            return reply.status(400).send({ error: 'Meta credentials not configured' });
        }

        const { method = 'SMS' } = request.body || {}; // SMS or VOICE

        // Request verification code via Meta API
        const response = await axios.post(
            `https://graph.facebook.com/v17.0/${META_PHONE_ID}/request_code`,
            {
                code_method: method,
                language: 'fr'
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('[Compliance] ✅ OTP requested via', method);

        return reply.send({
            success: true,
            message: `Code envoyé par ${method}`,
            method
        });

    } catch (err) {
        console.error('[Compliance] ❌ OTP request error:', err.response?.data || err.message);
        return reply.status(500).send({
            error: err.response?.data?.error?.message || 'Failed to request verification code'
        });
    }
});

// POST /compliance/verify-code - Verify OTP code
server.post('/compliance/verify-code', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
            return reply.status(400).send({ error: 'Meta credentials not configured' });
        }

        const { code } = request.body || {};

        if (!code) {
            return reply.status(400).send({ error: 'Verification code is required' });
        }

        // Verify the code via Meta API
        const response = await axios.post(
            `https://graph.facebook.com/v17.0/${META_PHONE_ID}/verify_code`,
            { code },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('[Compliance] ✅ Code verified successfully');

        return reply.send({
            success: true,
            message: 'Numéro vérifié avec succès'
        });

    } catch (err) {
        console.error('[Compliance] ❌ Code verification error:', err.response?.data || err.message);
        return reply.status(500).send({
            error: err.response?.data?.error?.message || 'Code verification failed'
        });
    }
});

// POST /compliance/update-profile - Update display name / about
server.post('/compliance/update-profile', { preHandler: [server.authenticate] }, async (request, reply) => {
    try {
        if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
            return reply.status(400).send({ error: 'Meta credentials not configured' });
        }

        const { display_name, about } = request.body || {};

        if (!display_name && !about) {
            return reply.status(400).send({ error: 'display_name or about is required' });
        }

        const updates = {};
        if (about) updates.about = about;

        // Update profile via Meta API
        // Note: display_name change requires business verification and approval
        if (about) {
            await axios.post(
                `https://graph.facebook.com/v17.0/${META_PHONE_ID}/whatsapp_business_profile`,
                {
                    messaging_product: 'whatsapp',
                    about
                },
                {
                    headers: {
                        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
        }

        // For display name, we need to use the register endpoint or certificate
        if (display_name) {
            try {
                await axios.post(
                    `https://graph.facebook.com/v17.0/${META_PHONE_ID}/register`,
                    {
                        messaging_product: 'whatsapp',
                        pin: '000000' // This might need to be dynamic
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            } catch (regErr) {
                // Registration might fail if already registered, that's OK
                console.log('[Compliance] Registration attempt:', regErr.response?.data?.error?.message);
            }
        }

        console.log('[Compliance] ✅ Profile updated');

        return reply.send({
            success: true,
            message: 'Profil mis à jour. Les modifications de nom nécessitent une approbation Meta (24-72h).'
        });

    } catch (err) {
        console.error('[Compliance] ❌ Profile update error:', err.response?.data || err.message);
        return reply.status(500).send({
            error: err.response?.data?.error?.message || 'Failed to update profile'
        });
    }
});

// ============================================
// TEST TEMPLATE - Send test to phone number
// ============================================
server.post('/templates/test', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { template_name, template_language, phone_number, variables } = request.body;

    // Validate required fields
    if (!template_name || !phone_number) {
        return reply.status(400).send({
            error: 'Champs requis: template_name et phone_number'
        });
    }

    // Check Meta credentials
    if (!META_ACCESS_TOKEN || !META_PHONE_ID) {
        return reply.status(500).send({
            error: 'Configuration WhatsApp API manquante (META_ACCESS_TOKEN ou META_PHONE_ID)'
        });
    }

    // Format phone number (remove spaces, dashes, ensure + prefix)
    let formattedPhone = phone_number.replace(/[\s\-\(\)]/g, '');
    if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone;
    }
    // Remove + for Meta API
    const waId = formattedPhone.replace('+', '');

    console.log(`[API] 🧪 Testing template "${template_name}" to ${formattedPhone}`);

    try {
        // Build Meta payload
        const metaPayload = {
            messaging_product: 'whatsapp',
            to: waId,
            type: 'template',
            template: {
                name: template_name,
                language: { code: template_language || 'fr' }
            }
        };

        // Add body variables if provided
        if (variables && Array.isArray(variables) && variables.length > 0) {
            metaPayload.template.components = [{
                type: 'body',
                parameters: variables.map(v => ({ type: 'text', text: String(v) }))
            }];
        }

        // Send via Meta API
        const metaResponse = await axios.post(
            META_API_URL,
            metaPayload,
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`[API] ✅ Test template sent! Message ID: ${metaResponse.data.messages?.[0]?.id}`);

        // Increment usage count for this template
        try {
            await pool.query(
                `UPDATE templates SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = NOW() 
                 WHERE name = $1 AND tenant_id = $2`,
                [template_name, request.tenantId]
            );
        } catch (updateErr) {
            console.warn('[API] Could not update usage count:', updateErr.message);
        }

        return reply.send({
            success: true,
            message: `Template envoyé avec succès à ${formattedPhone}`,
            message_id: metaResponse.data.messages?.[0]?.id
        });

    } catch (err) {
        console.error('[API] ❌ Test template error:', err.response?.data || err.message);

        // Extract Meta error message
        const metaError = err.response?.data?.error;
        let errorMessage = 'Échec de l\'envoi du template';

        if (metaError) {
            if (metaError.error_subcode === 132001) {
                errorMessage = 'Template non approuvé ou inexistant sur Meta';
            } else if (metaError.error_subcode === 131030) {
                errorMessage = 'Numéro de téléphone invalide ou non WhatsApp';
            } else if (metaError.message) {
                errorMessage = metaError.message;
            }
        }

        return reply.status(400).send({
            error: errorMessage,
            details: metaError
        });
    }
});

// ============================================
// HELPER: Convert name to snake_case (Meta compliant)
// ============================================
function toSnakeCase(name) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9]+/g, '_')      // Replace non-alphanumeric with underscores
        .replace(/^_+|_+$/g, '')          // Trim leading/trailing underscores
        .substring(0, 64);                 // Max 64 characters
}

// ============================================
// HELPER: Validate template content
// ============================================
function validateTemplateContent(text) {
    const prohibitedKeywords = ['viagra', 'casino', 'lottery', 'win money'];
    const lowerText = text.toLowerCase();

    for (const keyword of prohibitedKeywords) {
        if (lowerText.includes(keyword)) {
            return { valid: false, reason: `Contenu interdit détecté: "${keyword}"` };
        }
    }

    if (text.length > 1024) {
        return { valid: false, reason: 'Le corps du message dépasse 1024 caractères' };
    }

    return { valid: true };
}

// ============================================
// POST /templates/create
// Créer un nouveau template et le soumettre à Meta
// Supports: HEADER (TEXT/IMAGE/VIDEO/DOCUMENT), BODY, FOOTER, BUTTONS (all types)
// ============================================
server.post('/templates/create', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { name, category, language, bodyText, header, footer, buttons } = request.body || {};

    // Validation des champs requis
    if (!name || !category || !language || !bodyText) {
        return reply.status(400).send({
            error: 'Champs requis manquants: name, category, language, bodyText'
        });
    }

    // Vérifier les credentials Meta
    if (!META_ACCESS_TOKEN || !META_WABA_ID) {
        return reply.status(500).send({ error: 'META_ACCESS_TOKEN ou META_WABA_ID non configuré' });
    }

    // Formater le nom en snake_case
    const formattedName = toSnakeCase(name);
    console.log(`[API] 📝 Creating advanced template: "${name}" -> "${formattedName}"`);

    // Valider le contenu
    const validation = validateTemplateContent(bodyText);
    if (!validation.valid) {
        return reply.status(400).send({ error: validation.reason });
    }

    // Compter les variables dans le bodyText
    const variableMatches = bodyText.match(/\{\{\d+\}\}/g);
    const variablesCount = variableMatches ? variableMatches.length : 0;

    // ============================================
    // CONSTRUIRE LES COMPONENTS META
    // ============================================
    const components = [];

    // 1. HEADER COMPONENT (optionnel)
    if (header && header.type) {
        const headerComponent = { type: 'HEADER' };

        switch (header.type) {
            case 'TEXT':
                headerComponent.format = 'TEXT';
                headerComponent.text = header.text || '';
                // Ajouter exemple si variables présentes
                const headerVars = header.text?.match(/\{\{\d+\}\}/g);
                if (headerVars && headerVars.length > 0) {
                    headerComponent.example = {
                        header_text: headerVars.map((_, i) => `Example${i + 1}`)
                    };
                }
                break;
            case 'IMAGE':
                headerComponent.format = 'IMAGE';
                // Meta requiert un exemple pour les médias, mais on peut soumettre sans en MVP
                if (header.example_media_handle) {
                    headerComponent.example = {
                        header_handle: [header.example_media_handle]
                    };
                }
                break;
            case 'VIDEO':
                headerComponent.format = 'VIDEO';
                if (header.example_media_handle) {
                    headerComponent.example = {
                        header_handle: [header.example_media_handle]
                    };
                }
                break;
            case 'DOCUMENT':
                headerComponent.format = 'DOCUMENT';
                if (header.example_media_handle) {
                    headerComponent.example = {
                        header_handle: [header.example_media_handle]
                    };
                }
                break;
        }

        components.push(headerComponent);
        console.log(`[API] 📎 Header added: ${header.type}`);
    }

    // 2. BODY COMPONENT (requis)
    const bodyComponent = {
        type: 'BODY',
        text: bodyText
    };
    // Ajouter exemples pour les variables du body
    if (variablesCount > 0) {
        bodyComponent.example = {
            body_text: [variableMatches.map((_, i) => `Example${i + 1}`)]
        };
    }
    components.push(bodyComponent);

    // 3. FOOTER COMPONENT (optionnel)
    if (footer && footer.text) {
        components.push({
            type: 'FOOTER',
            text: footer.text.substring(0, 60) // Max 60 chars pour footer
        });
        console.log(`[API] 📝 Footer added: "${footer.text.substring(0, 30)}..."`);
    }

    // 4. BUTTONS COMPONENT (optionnel, max 3 pour CTA, max 3 pour Quick Reply)
    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        const metaButtons = [];

        for (const btn of buttons.slice(0, 3)) { // Max 3 boutons
            switch (btn.type) {
                case 'QUICK_REPLY':
                    metaButtons.push({
                        type: 'QUICK_REPLY',
                        text: (btn.text || '').substring(0, 25)
                    });
                    break;

                case 'URL':
                    const urlButton = {
                        type: 'URL',
                        text: (btn.text || '').substring(0, 25),
                        url: btn.url || ''
                    };
                    // Gérer les URL dynamiques avec {{1}}
                    if (btn.url && btn.url.includes('{{')) {
                        urlButton.example = [btn.url.replace(/\{\{\d+\}\}/g, 'example')];
                    }
                    metaButtons.push(urlButton);
                    break;

                case 'PHONE_NUMBER':
                    metaButtons.push({
                        type: 'PHONE_NUMBER',
                        text: (btn.text || '').substring(0, 25),
                        phone_number: btn.phone_number || ''
                    });
                    break;

                case 'COPY_CODE':
                    metaButtons.push({
                        type: 'COPY_CODE',
                        example: btn.example_code || 'PROMO123'
                    });
                    break;

                case 'FLOW':
                    metaButtons.push({
                        type: 'FLOW',
                        text: (btn.text || '').substring(0, 25),
                        flow_id: btn.flow_id || '',
                        flow_action: btn.flow_action || 'navigate',
                        navigate_screen: btn.navigate_screen || 'screen_1'
                    });
                    console.log(`[API] 🔄 Flow button added: ${btn.flow_id}`);
                    break;

                case 'CATALOG':
                    // Catalog button for E-commerce templates
                    metaButtons.push({
                        type: 'CATALOG',
                        text: (btn.text || 'Voir le catalogue').substring(0, 25)
                    });
                    console.log(`[API] 🛒 Catalog button added`);
                    break;

                default:
                    // Fallback to QUICK_REPLY
                    metaButtons.push({
                        type: 'QUICK_REPLY',
                        text: (btn.text || 'OK').substring(0, 25)
                    });
            }
        }

        if (metaButtons.length > 0) {
            components.push({
                type: 'BUTTONS',
                buttons: metaButtons
            });
            console.log(`[API] 🔘 ${metaButtons.length} button(s) added`);
        }
    }

    try {
        // Log du payload pour debug
        const payload = {
            name: formattedName,
            category: category.toUpperCase(),
            language: language,
            components: components
        };
        console.log('[API] 🚀 Submitting template to Meta:', JSON.stringify(payload, null, 2));

        // Appel Meta API pour créer le template
        const metaResponse = await axios.post(
            `https://graph.facebook.com/v18.0/${META_WABA_ID}/message_templates`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const waTemplateId = metaResponse.data.id;
        const metaStatus = metaResponse.data.status || 'PENDING';
        console.log(`[API] ✅ Template created in Meta: ${waTemplateId} (status: ${metaStatus})`);

        // Insérer en base de données avec tous les détails
        const dbResult = await pool.query(
            `INSERT INTO templates 
                (tenant_id, wa_template_id, name, language, meta_status, body_text, variables_count, content, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, name, language, meta_status, body_text, variables_count, wa_template_id, category`,
            [
                request.tenantId,
                waTemplateId,
                formattedName,
                language,
                metaStatus,
                bodyText,
                variablesCount,
                JSON.stringify({ components, header, footer, buttons }),
                category.toUpperCase()
            ]
        );

        const newTemplate = dbResult.rows[0];
        console.log(`[API] 📋 Template saved to DB: ${newTemplate.id}`);

        return reply.status(201).send({
            success: true,
            message: 'Template soumis à Meta pour validation',
            template: newTemplate
        });

    } catch (err) {
        console.error('[API] ❌ Template creation error:', err.response?.data || err.message);

        // Parser l'erreur Meta pour un message plus clair
        const metaError = err.response?.data?.error;
        if (metaError) {
            return reply.status(400).send({
                error: metaError.message || 'Erreur Meta API',
                details: metaError.error_user_msg || metaError.error_subcode
            });
        }

        return reply.status(500).send({ error: 'Échec de la création du template' });
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

            // Initialize components array
            const templateComponents = [];

            // Add body variables if provided
            if (params && Array.isArray(params) && params.length > 0) {
                templateComponents.push({
                    type: 'body',
                    parameters: params.map(p => ({ type: 'text', text: String(p) }))
                });
                console.log(`[API] 📝 Template with ${params.length} variables`);
            }

            // Check for catalog product ID (for E-commerce templates)
            const productRetailerId = request.body.product_retailer_id;
            if (productRetailerId) {
                templateComponents.push({
                    type: 'button',
                    sub_type: 'CATALOG',
                    index: 0,
                    parameters: [
                        {
                            type: 'action',
                            action: {
                                thumbnail_product_retailer_id: productRetailerId
                            }
                        }
                    ]
                });
                console.log(`[API] 🛒 Catalog template with product: ${productRetailerId}`);
            }

            // Add header media if provided (for media templates)
            const headerMediaUrl = request.body.header_media_url;
            const headerMediaType = request.body.header_media_type;
            if (headerMediaUrl && headerMediaType) {
                templateComponents.push({
                    type: 'header',
                    parameters: [
                        {
                            type: headerMediaType.toLowerCase(), // 'image', 'video', 'document'
                            [headerMediaType.toLowerCase()]: {
                                link: headerMediaUrl
                            }
                        }
                    ]
                });
                console.log(`[API] 📎 Header ${headerMediaType} attached: ${headerMediaUrl.substring(0, 50)}...`);
            }

            // Assign components if any
            if (templateComponents.length > 0) {
                metaPayload.template.components = templateComponents;
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

            // Increment usage count for template messages
            if (isTemplate && templateName) {
                try {
                    await pool.query(
                        `UPDATE templates SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = NOW() 
                         WHERE name = $1 AND tenant_id = $2`,
                        [templateName, request.tenantId]
                    );
                } catch (updateErr) {
                    console.warn('[API] Could not update template usage count:', updateErr.message);
                }
            }

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
// AI CONFIG ENDPOINTS
// ============================================

// Get AI config for current tenant
server.get('/ai-config', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT id, tenant_id, is_active, system_prompt, system_instructions, 
                    persona_style, emoji_usage, creativity_level,
                    provider, model,
                    CASE WHEN api_key IS NOT NULL THEN true ELSE false END as has_api_key
             FROM ai_configs WHERE tenant_id = $1`,
            [request.tenantId]
        );

        if (result.rows.length === 0) {
            // Return default config if none exists
            return reply.send({
                is_active: false,
                system_prompt: null,
                system_instructions: null,
                persona_style: 'FRIENDLY',
                emoji_usage: true,
                creativity_level: 0.7,
                provider: 'GEMINI',
                model: 'gemini-2.0-flash',
                has_api_key: false
            });
        }

        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to get AI config:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// Save AI config for current tenant
server.post('/ai-config', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { is_active, system_prompt, system_instructions, persona_style, emoji_usage, creativity_level, provider, model, api_key } = request.body || {};

    try {
        // Upsert AI config
        const result = await pool.query(
            `INSERT INTO ai_configs (tenant_id, is_active, system_prompt, system_instructions, persona_style, emoji_usage, creativity_level, provider, model, api_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (tenant_id) DO UPDATE SET
                is_active = COALESCE(EXCLUDED.is_active, ai_configs.is_active),
                system_prompt = COALESCE(EXCLUDED.system_prompt, ai_configs.system_prompt),
                system_instructions = COALESCE(EXCLUDED.system_instructions, ai_configs.system_instructions),
                persona_style = COALESCE(EXCLUDED.persona_style, ai_configs.persona_style),
                emoji_usage = COALESCE(EXCLUDED.emoji_usage, ai_configs.emoji_usage),
                creativity_level = COALESCE(EXCLUDED.creativity_level, ai_configs.creativity_level),
                provider = COALESCE(EXCLUDED.provider, ai_configs.provider),
                model = COALESCE(EXCLUDED.model, ai_configs.model),
                api_key = CASE WHEN EXCLUDED.api_key IS NOT NULL AND EXCLUDED.api_key != '' 
                          THEN EXCLUDED.api_key ELSE ai_configs.api_key END,
                updated_at = NOW()
             RETURNING id, is_active, system_prompt, system_instructions, persona_style, emoji_usage, creativity_level, provider, model,
                       CASE WHEN api_key IS NOT NULL THEN true ELSE false END as has_api_key`,
            [request.tenantId, is_active, system_prompt, system_instructions, persona_style || 'FRIENDLY', emoji_usage ?? true, creativity_level ?? 0.7, provider || 'GEMINI', model || 'gemini-2.0-flash', api_key || null]
        );

        console.log(`[API] 🤖 AI config saved for tenant: ${request.tenantId}`);
        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to save AI config:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// KNOWLEDGE BASE (RAG Light)
// ============================================

// GET /ai/knowledge - List all knowledge documents
server.get('/ai/knowledge', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT id, tenant_id, source_name, content, is_active, created_at, updated_at
             FROM knowledge_docs 
             WHERE tenant_id = $1 
             ORDER BY created_at DESC`,
            [request.tenantId]
        );
        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Failed to get knowledge docs:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /ai/knowledge - Add new knowledge document
server.post('/ai/knowledge', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { source_name, content, is_active = true } = request.body || {};

    if (!content || !content.trim()) {
        return reply.status(400).send({ error: 'Le contenu est requis' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO knowledge_docs (tenant_id, source_name, content, is_active)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [request.tenantId, source_name || 'Document', content.trim(), is_active]
        );
        console.log(`[API] 📚 Knowledge doc added: ${result.rows[0].source_name}`);
        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to add knowledge doc:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// PUT /ai/knowledge/:id - Update knowledge document
server.put('/ai/knowledge/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { source_name, content, is_active } = request.body || {};

    try {
        const result = await pool.query(
            `UPDATE knowledge_docs 
             SET source_name = COALESCE($3, source_name),
                 content = COALESCE($4, content),
                 is_active = COALESCE($5, is_active),
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2
             RETURNING *`,
            [id, request.tenantId, source_name, content, is_active]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Document non trouvé' });
        }

        console.log(`[API] 📝 Knowledge doc updated: ${result.rows[0].source_name}`);
        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to update knowledge doc:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// DELETE /ai/knowledge/:id - Delete knowledge document
server.delete('/ai/knowledge/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            `DELETE FROM knowledge_docs 
             WHERE id = $1 AND tenant_id = $2
             RETURNING id, source_name`,
            [id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Document non trouvé' });
        }

        console.log(`[API] 🗑️ Knowledge doc deleted: ${result.rows[0].source_name}`);
        return reply.send({ success: true, deleted: result.rows[0] });
    } catch (err) {
        console.error('[API] ❌ Failed to delete knowledge doc:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// IMPORT WEB PAGE TO KNOWLEDGE BASE
// ============================================
server.post('/ai/knowledge/import-web', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { url } = request.body || {};

    if (!url) {
        return reply.status(400).send({ error: 'URL requise' });
    }

    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        return reply.status(400).send({ error: 'URL invalide' });
    }

    try {
        console.log(`[API] 🌐 Scraping web page: ${url}`);

        // Fetch the page
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; VectraBot/1.0)'
            }
        });

        // Load HTML with cheerio
        const $ = cheerio.load(response.data);

        // Remove useless elements
        $('script, style, nav, footer, header, noscript, iframe, svg, img').remove();

        // Get page title
        let title = $('title').text().trim() || $('h1').first().text().trim() || 'Page Web';
        title = he.decode(title).substring(0, 100);

        // Extract main text
        let text = $('body').text();

        // Clean up text: decode HTML entities, remove extra whitespace
        text = he.decode(text);
        text = text.replace(/\s+/g, ' ').trim();

        // Limit content size (max 20000 chars)
        const MAX_CHARS = 20000;
        if (text.length > MAX_CHARS) {
            text = text.substring(0, MAX_CHARS) + '... [Contenu tronqué]';
        }

        if (text.length < 50) {
            return reply.status(400).send({ error: 'Impossible d\'extraire du contenu de cette page' });
        }

        // Save to knowledge_docs
        const result = await pool.query(
            `INSERT INTO knowledge_docs (tenant_id, source_name, content, type, is_active)
             VALUES ($1, $2, $3, 'WEB', true)
             RETURNING id, source_name, content, type, is_active, created_at`,
            [request.tenantId, `Web: ${title}`, text]
        );

        console.log(`[API] ✅ Web page imported: ${title} (${text.length} chars)`);
        return reply.send(result.rows[0]);

    } catch (err) {
        console.error('[API] ❌ Failed to import web page:', err.message);
        if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
            return reply.status(408).send({ error: 'La page a mis trop de temps à répondre' });
        }
        return reply.status(500).send({ error: 'Impossible de récupérer cette page' });
    }
});

// ============================================
// IMPORT YOUTUBE VIDEO TO KNOWLEDGE BASE
// ============================================
server.post('/ai/knowledge/import-youtube', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { url } = request.body || {};

    if (!url) {
        return reply.status(400).send({ error: 'URL YouTube requise' });
    }

    // Extract video ID from various YouTube URL formats
    let videoId = null;
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('youtube.com')) {
            videoId = urlObj.searchParams.get('v');
        } else if (urlObj.hostname.includes('youtu.be')) {
            videoId = urlObj.pathname.slice(1);
        }
    } catch (e) {
        return reply.status(400).send({ error: 'URL invalide' });
    }

    if (!videoId) {
        return reply.status(400).send({ error: 'Impossible d\'extraire l\'ID de la vidéo YouTube' });
    }

    try {
        console.log(`[API] 🎬 Fetching YouTube transcript: ${videoId}`);

        // Fetch transcript
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'fr' })
            .catch(() => YoutubeTranscript.fetchTranscript(videoId)); // Fallback to any language

        if (!transcriptData || transcriptData.length === 0) {
            return reply.status(400).send({ error: 'Cette vidéo n\'a pas de sous-titres automatiques disponibles' });
        }

        // Concatenate all transcript segments
        let text = transcriptData.map(segment => segment.text).join(' ');

        // Clean up text
        text = he.decode(text);
        text = text.replace(/\s+/g, ' ').trim();

        // Limit content size (max 20000 chars)
        const MAX_CHARS = 20000;
        if (text.length > MAX_CHARS) {
            text = text.substring(0, MAX_CHARS) + '... [Transcription tronquée]';
        }

        // Save to knowledge_docs
        const result = await pool.query(
            `INSERT INTO knowledge_docs (tenant_id, source_name, content, type, is_active)
             VALUES ($1, $2, $3, 'VIDEO', true)
             RETURNING id, source_name, content, type, is_active, created_at`,
            [request.tenantId, `YouTube: ${videoId}`, text]
        );

        console.log(`[API] ✅ YouTube transcript imported: ${videoId} (${text.length} chars)`);
        return reply.send(result.rows[0]);

    } catch (err) {
        console.error('[API] ❌ Failed to import YouTube transcript:', err.message);
        if (err.message.includes('Could not get the transcript') || err.message.includes('disabled')) {
            return reply.status(400).send({ error: 'Cette vidéo n\'a pas de sous-titres automatiques disponibles' });
        }
        return reply.status(500).send({ error: 'Impossible de récupérer les sous-titres de cette vidéo' });
    }
});

// ============================================
// AI SUGGESTIONS
// ============================================
server.post('/suggestions', { preHandler: [server.authenticate] }, async (request, reply) => {
    const { conversation_id } = request.body || {};

    if (!conversation_id) {
        return reply.status(400).send({ error: 'conversation_id required' });
    }

    try {
        // 1. Get tenant's Gemini API key
        const tenantResult = await pool.query(
            'SELECT gemini_api_key FROM tenants WHERE id = $1',
            [request.tenantId]
        );

        const tenantApiKey = tenantResult.rows[0]?.gemini_api_key;

        if (!tenantApiKey) {
            return reply.status(503).send({ error: 'AI not configured for this tenant', suggestions: [] });
        }

        // 2. Initialize Gemini with tenant's key
        const genAI = new GoogleGenerativeAI(tenantApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        // 3. Verify conversation belongs to tenant and get contact info
        const convResult = await pool.query(
            `SELECT conv.id, c.name as contact_name, c.wa_id
             FROM conversations conv
             JOIN contacts c ON conv.contact_id = c.id
             WHERE conv.id = $1 AND conv.tenant_id = $2`,
            [conversation_id, request.tenantId]
        );

        if (convResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Conversation not found' });
        }

        const contactName = convResult.rows[0].contact_name || 'Client';

        // 4. Get last 10 messages for context
        const messagesResult = await pool.query(
            `SELECT direction, body, type 
             FROM messages 
             WHERE conversation_id = $1 AND tenant_id = $2 AND type = 'text'
             ORDER BY created_at DESC LIMIT 10`,
            [conversation_id, request.tenantId]
        );

        const messages = messagesResult.rows.reverse();

        if (messages.length === 0) {
            return reply.send({ suggestions: ['Bonjour ! Comment puis-je vous aider ?', 'Merci de votre message', 'Je reviens vers vous rapidement'] });
        }

        // 5. Build conversation context
        const conversationText = messages.map(m => {
            const role = m.direction === 'inbound' ? contactName : 'Agent';
            return `${role}: ${m.body}`;
        }).join('\n');

        // 6. Call Gemini for suggestions
        const prompt = `Tu es un assistant professionnel pour le service client WhatsApp.
Voici l'historique récent d'une conversation:

${conversationText}

Génère exactement 3 réponses professionnelles et courtes (max 50 mots chacune) que l'agent pourrait envoyer.
Réponds uniquement avec un JSON array de 3 strings, sans markdown ni explication.
Exemple: ["Réponse 1", "Réponse 2", "Réponse 3"]`;

        console.log('[API] 🤖 Requesting AI suggestions...');
        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        // 7. Parse response
        let suggestions = [];
        try {
            const jsonMatch = responseText.match(/\[.*\]/s);
            if (jsonMatch) {
                suggestions = JSON.parse(jsonMatch[0]);
            }
        } catch (parseErr) {
            console.error('[API] ⚠️ Failed to parse AI response:', responseText);
            suggestions = ['Merci pour votre message', 'Je m\'en occupe', 'Bien reçu, je reviens vers vous'];
        }

        suggestions = suggestions.slice(0, 3);
        while (suggestions.length < 3) {
            suggestions.push('...');
        }

        console.log(`[API] ✅ Generated ${suggestions.length} suggestions`);
        return reply.send({ suggestions });

    } catch (err) {
        console.error('[API] ❌ AI suggestions error:', err.message);
        return reply.status(500).send({ error: 'Failed to generate suggestions', suggestions: [] });
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

// Get tenant settings (including masked API key)
server.get('/admin/tenants/:id/settings', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    const { id } = request.params;
    try {
        const result = await pool.query(
            'SELECT id, name, gemini_api_key FROM tenants WHERE id = $1',
            [id]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Tenant not found' });
        }
        const tenant = result.rows[0];
        // Mask the API key for security
        const hasApiKey = !!tenant.gemini_api_key;
        const maskedKey = hasApiKey ? '****' + tenant.gemini_api_key.slice(-4) : null;
        return reply.send({
            id: tenant.id,
            name: tenant.name,
            gemini_api_key_configured: hasApiKey,
            gemini_api_key_masked: maskedKey
        });
    } catch (err) {
        console.error('[API] ❌ Failed to get tenant settings:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// Update tenant Gemini API key
server.patch('/admin/tenants/:id/settings', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    const { id } = request.params;
    const { gemini_api_key } = request.body || {};

    try {
        const result = await pool.query(
            'UPDATE tenants SET gemini_api_key = $1 WHERE id = $2 RETURNING id, name',
            [gemini_api_key || null, id]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Tenant not found' });
        }
        console.log(`[API] 🔑 Updated Gemini API key for tenant: ${result.rows[0].name}`);
        return reply.send({ success: true, tenant: result.rows[0] });
    } catch (err) {
        console.error('[API] ❌ Failed to update tenant settings:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// SYSTEM CONFIG ROUTES (SUPER_ADMIN ONLY)
// ============================================

// Sensitive keys that should be masked when displayed
const SENSITIVE_KEYS = [
    'PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'ACCESS', 'CREDENTIAL'
];

// Helper to mask sensitive values
function maskValue(key, value) {
    if (!value) return '';
    const isKeysSensitive = SENSITIVE_KEYS.some(sk => key.toUpperCase().includes(sk));
    if (isKeysSensitive && value.length > 8) {
        return value.substring(0, 4) + '****' + value.substring(value.length - 4);
    }
    return value;
}

// GET /admin/env - Read environment variables
server.get('/admin/env', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    const { reveal } = request.query;

    try {
        const envPath = process.env.ENV_FILE_PATH || '/project/.env';

        if (!fs.existsSync(envPath)) {
            return reply.status(404).send({ error: '.env file not found' });
        }

        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        const envVars = {};

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) continue;

            const eqIndex = trimmedLine.indexOf('=');
            if (eqIndex === -1) continue;

            const key = trimmedLine.substring(0, eqIndex).trim();
            const value = trimmedLine.substring(eqIndex + 1).trim();

            // Mask sensitive values unless reveal=true
            envVars[key] = {
                value: reveal === 'true' ? value : maskValue(key, value),
                masked: reveal !== 'true' && SENSITIVE_KEYS.some(sk => key.toUpperCase().includes(sk))
            };
        }

        console.log(`[API] 📋 Env variables read by SUPER_ADMIN (masked: ${reveal !== 'true'})`);
        return reply.send({
            variables: envVars,
            path: envPath,
            last_modified: fs.statSync(envPath).mtime
        });
    } catch (err) {
        console.error('[API] ❌ Failed to read .env:', err.message);
        return reply.status(500).send({ error: 'Failed to read configuration' });
    }
});

// POST /admin/env - Update environment variables
server.post('/admin/env', {
    preHandler: [server.authenticate, requireRole('SUPER_ADMIN')]
}, async (request, reply) => {
    const updates = request.body;

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'No variables provided' });
    }

    try {
        const envPath = process.env.ENV_FILE_PATH || '/project/.env';

        // Read existing env file
        let existingContent = '';
        let existingVars = {};

        if (fs.existsSync(envPath)) {
            existingContent = fs.readFileSync(envPath, 'utf8');
            const lines = existingContent.split('\n');

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine.startsWith('#')) continue;

                const eqIndex = trimmedLine.indexOf('=');
                if (eqIndex === -1) continue;

                const key = trimmedLine.substring(0, eqIndex).trim();
                const value = trimmedLine.substring(eqIndex + 1).trim();
                existingVars[key] = value;
            }
        }

        // Merge updates (don't allow empty strings for critical keys)
        let changedKeys = [];
        for (const [key, value] of Object.entries(updates)) {
            // Skip masked values (they contain ****)
            if (value.includes('****')) {
                console.log(`[API] ⚠️ Skipping masked value for ${key}`);
                continue;
            }

            // Validate key format
            if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
                return reply.status(400).send({ error: `Invalid key format: ${key}` });
            }

            existingVars[key] = value;
            changedKeys.push(key);
        }

        // Write updated env file
        const newContent = Object.entries(existingVars)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n') + '\n';

        // Backup the original
        if (fs.existsSync(envPath)) {
            const backupPath = `${envPath}.backup.${Date.now()}`;
            fs.copyFileSync(envPath, backupPath);
            console.log(`[API] 📦 Backup created: ${backupPath}`);
        }

        fs.writeFileSync(envPath, newContent, 'utf8');
        console.log(`[API] ✅ Env updated by SUPER_ADMIN: ${changedKeys.join(', ')}`);

        return reply.send({
            success: true,
            updated_keys: changedKeys,
            message: 'Configuration sauvegardée. Redémarrage requis pour appliquer les changements.'
        });
    } catch (err) {
        console.error('[API] ❌ Failed to update .env:', err.message);
        return reply.status(500).send({ error: 'Failed to update configuration' });
    }
});

// GET /config/public - Public configuration for frontend SDK
server.get('/config/public', async (request, reply) => {
    return reply.send({
        facebook_app_id: process.env.FACEBOOK_APP_ID || null,
        facebook_config_id: process.env.FACEBOOK_CONFIG_ID || null,
        whatsapp_enabled: !!process.env.META_ACCESS_TOKEN,
        api_version: 'v18.0'
    });
});

// ============================================
// EMBEDDED SIGNUP (Facebook WhatsApp)
// ============================================

// POST /auth/whatsapp-signup - Exchange Facebook code for WhatsApp access
server.post('/auth/whatsapp-signup', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { code } = request.body;

    if (!code) {
        return reply.status(400).send({ error: 'Authorization code required' });
    }

    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
        return reply.status(500).send({ error: 'Facebook App not configured' });
    }

    try {
        // Step 1: Exchange code for access token
        const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token`;
        const tokenResponse = await axios.get(tokenUrl, {
            params: {
                client_id: FACEBOOK_APP_ID,
                client_secret: FACEBOOK_APP_SECRET,
                code: code
            }
        });

        const accessToken = tokenResponse.data.access_token;
        console.log('[API] 🔑 Facebook access token obtained');

        // Step 2: Get WhatsApp Business Account info
        const wabaUrl = `https://graph.facebook.com/v18.0/me/whatsapp_business_accounts`;
        const wabaResponse = await axios.get(wabaUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!wabaResponse.data.data || wabaResponse.data.data.length === 0) {
            return reply.status(400).send({ error: 'No WhatsApp Business Account found' });
        }

        const wabaId = wabaResponse.data.data[0].id;
        console.log(`[API] 📱 WABA ID found: ${wabaId}`);

        // Step 3: Get Phone Numbers associated with WABA
        const phonesUrl = `https://graph.facebook.com/v18.0/${wabaId}/phone_numbers`;
        const phonesResponse = await axios.get(phonesUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        let phoneNumberId = null;
        let displayPhoneNumber = null;

        if (phonesResponse.data.data && phonesResponse.data.data.length > 0) {
            phoneNumberId = phonesResponse.data.data[0].id;
            displayPhoneNumber = phonesResponse.data.data[0].display_phone_number;
            console.log(`[API] 📞 Phone Number ID: ${phoneNumberId} (${displayPhoneNumber})`);
        }

        // Step 4: Save to tenant
        await pool.query(
            `UPDATE tenants SET 
                waba_id = $1, 
                phone_number_id = $2, 
                whatsapp_access_token = $3,
                facebook_config = jsonb_set(COALESCE(facebook_config, '{}'), '{display_phone}', $4::jsonb)
            WHERE id = $5`,
            [wabaId, phoneNumberId, accessToken, JSON.stringify(displayPhoneNumber), request.tenantId]
        );

        console.log(`[API] ✅ WhatsApp credentials saved for tenant ${request.tenantId}`);

        return reply.send({
            success: true,
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
            display_phone: displayPhoneNumber,
            message: 'Compte WhatsApp connecté avec succès!'
        });

    } catch (err) {
        console.error('[API] ❌ WhatsApp signup failed:', err.response?.data || err.message);
        return reply.status(500).send({
            error: 'Failed to connect WhatsApp account',
            details: err.response?.data?.error?.message || err.message
        });
    }
});

// ============================================
// CONTACTS CRM ROUTES (V5 Marketing Module)
// ============================================

// GET /contacts - List all contacts
server.get('/contacts', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { limit = 100, offset = 0, search } = request.query;

    try {
        let query = `
            SELECT id, phone, name, email, tags, opted_out, created_at 
            FROM contacts 
            WHERE tenant_id = $1
        `;
        const params = [request.tenantId];

        if (search) {
            query += ` AND (phone ILIKE $2 OR name ILIKE $2)`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Get total count
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM contacts WHERE tenant_id = $1',
            [request.tenantId]
        );

        return reply.send({
            contacts: result.rows,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        console.error('[API] ❌ Failed to get contacts:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /contacts - Create a new contact
server.post('/contacts', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { phone, name, email, tags } = request.body || {};

    if (!phone) {
        return reply.status(400).send({ error: 'Phone number is required' });
    }

    // Normalize phone number
    const normalizedPhone = phone.replace(/\s/g, '').replace(/^00/, '+');

    try {
        const result = await pool.query(
            `INSERT INTO contacts (tenant_id, phone, name, email, tags) 
             VALUES ($1, $2, $3, $4, $5) 
             ON CONFLICT (tenant_id, phone) DO UPDATE SET 
                name = COALESCE(EXCLUDED.name, contacts.name),
                email = COALESCE(EXCLUDED.email, contacts.email),
                updated_at = NOW()
             RETURNING id, phone, name, email, tags, created_at`,
            [request.tenantId, normalizedPhone, name || null, email || null, tags || []]
        );
        console.log(`[API] 📇 Contact created: ${normalizedPhone}`);
        return reply.status(201).send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to create contact:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /contacts/import - Import contacts from conversations
server.post('/contacts/import', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        // Find all unique phone numbers from conversations that aren't already contacts
        const result = await pool.query(`
            INSERT INTO contacts (tenant_id, phone, name)
            SELECT DISTINCT 
                c.tenant_id,
                c.phone,
                c.contact_name as name
            FROM conversations c
            WHERE c.tenant_id = $1
            AND c.phone IS NOT NULL
            AND c.phone != ''
            ON CONFLICT (tenant_id, phone) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, contacts.name),
                updated_at = NOW()
            RETURNING id
        `, [request.tenantId]);

        const importedCount = result.rowCount;

        // Get total contacts count
        const totalResult = await pool.query(
            'SELECT COUNT(*) as total FROM contacts WHERE tenant_id = $1',
            [request.tenantId]
        );

        console.log(`[API] 📥 Imported ${importedCount} contacts from conversations`);

        return reply.send({
            success: true,
            imported: importedCount,
            total_contacts: parseInt(totalResult.rows[0].total),
            message: `${importedCount} contact(s) importé(s) depuis les discussions`
        });
    } catch (err) {
        console.error('[API] ❌ Failed to import contacts:', err.message);
        return reply.status(500).send({ error: 'Failed to import contacts' });
    }
});

// DELETE /contacts/:id - Delete a contact
server.delete('/contacts/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            'DELETE FROM contacts WHERE id = $1 AND tenant_id = $2 RETURNING id',
            [id, request.tenantId]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Contact not found' });
        }
        return reply.send({ success: true });
    } catch (err) {
        console.error('[API] ❌ Failed to delete contact:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// PATCH /contacts/:id/opt-out - Opt-out a contact
server.patch('/contacts/:id/opt-out', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { opted_out } = request.body;

    try {
        const result = await pool.query(
            'UPDATE contacts SET opted_out = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING id, phone, opted_out',
            [opted_out !== false, id, request.tenantId]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Contact not found' });
        }
        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to update contact:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// CAMPAIGN CONTACTS ROUTES (CRM Contacts)
// ============================================

// GET /campaign-contacts - List all CRM contacts
server.get('/campaign-contacts', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT id, phone, name, created_at 
             FROM campaign_contacts 
             WHERE tenant_id = $1 
             ORDER BY created_at DESC`,
            [request.tenantId]
        );
        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Failed to get campaign contacts:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /campaign-contacts - Add a new CRM contact
server.post('/campaign-contacts', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { phone, name } = request.body || {};

    if (!phone) {
        return reply.status(400).send({ error: 'Phone number is required' });
    }

    // Normalize phone number (remove spaces, ensure + prefix)
    const normalizedPhone = phone.replace(/\s/g, '').replace(/^00/, '+');

    try {
        const result = await pool.query(
            `INSERT INTO campaign_contacts (tenant_id, phone, name) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name
             RETURNING id, phone, name, created_at`,
            [request.tenantId, normalizedPhone, name || null]
        );
        console.log(`[API] 📇 Campaign contact added: ${normalizedPhone}`);
        return reply.status(201).send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to add campaign contact:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// DELETE /campaign-contacts/:id - Delete a CRM contact
server.delete('/campaign-contacts/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            'DELETE FROM campaign_contacts WHERE id = $1 AND tenant_id = $2 RETURNING id',
            [id, request.tenantId]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Contact not found' });
        }
        return reply.send({ success: true });
    } catch (err) {
        console.error('[API] ❌ Failed to delete campaign contact:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// CAMPAIGNS ROUTES
// ============================================

// GET /campaigns - List all campaigns
server.get('/campaigns', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.status, c.total_contacts, c.total_sent, c.total_failed, 
                    c.created_at, c.completed_at, t.name as template_name
             FROM campaigns c
             LEFT JOIN templates t ON c.template_id = t.id
             WHERE c.tenant_id = $1 
             ORDER BY c.created_at DESC`,
            [request.tenantId]
        );
        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Failed to get campaigns:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// GET /campaigns/analytics - Get campaign analytics dashboard data (MUST be before :id route)
server.get('/campaigns/analytics', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        // Overall KPIs across all campaigns
        const overallStats = await pool.query(
            `SELECT 
                COUNT(DISTINCT id) as total_campaigns,
                COALESCE(SUM(total_contacts), 0) as total_contacts,
                COALESCE(SUM(total_sent), 0) as total_sent,
                COALESCE(SUM(total_failed), 0) as total_failed,
                COALESCE(SUM(read_count), 0) as total_read,
                COALESCE(SUM(response_count), 0) as total_responses,
                COALESCE(SUM(conversion_count), 0) as total_conversions
             FROM campaigns 
             WHERE tenant_id = $1 AND status IN ('PROCESSING', 'COMPLETED')`,
            [request.tenantId]
        );

        const stats = overallStats.rows[0];

        // Calculate rates
        const deliveryRate = stats.total_sent > 0 ?
            ((stats.total_sent - stats.total_failed) / stats.total_sent * 100).toFixed(1) : 0;
        const openRate = stats.total_sent > 0 ?
            (stats.total_read / stats.total_sent * 100).toFixed(1) : 0;
        const responseRate = stats.total_sent > 0 ?
            (stats.total_responses / stats.total_sent * 100).toFixed(1) : 0;
        const conversionRate = stats.total_sent > 0 ?
            (stats.total_conversions / stats.total_sent * 100).toFixed(1) : 0;

        // Recent campaigns with their individual stats
        const recentCampaigns = await pool.query(
            `SELECT id, name, status, total_contacts, total_sent, total_failed,
                    read_count, response_count, conversion_count,
                    created_at, completed_at
             FROM campaigns 
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [request.tenantId]
        );

        // Campaign performance over time (last 30 days)
        const timelineData = await pool.query(
            `SELECT 
                DATE(created_at) as date,
                COUNT(*) as campaigns,
                SUM(total_sent) as sent,
                SUM(read_count) as read_count,
                SUM(response_count) as responses
             FROM campaigns 
             WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
             GROUP BY DATE(created_at)
             ORDER BY date`,
            [request.tenantId]
        );

        // A/B Test variant performance (if any)
        const variantStats = await pool.query(
            `SELECT cv.variant_letter, 
                    COUNT(*) as campaigns,
                    SUM(cv.sent) as total_sent,
                    SUM(cv.delivered) as total_delivered,
                    SUM(cv.read_count) as total_read,
                    SUM(cv.failed) as total_failed
             FROM campaign_variants cv
             JOIN campaigns c ON cv.campaign_id = c.id
             WHERE c.tenant_id = $1
             GROUP BY cv.variant_letter
             ORDER BY cv.variant_letter`,
            [request.tenantId]
        );

        return reply.send({
            kpis: {
                totalCampaigns: parseInt(stats.total_campaigns),
                totalContacts: parseInt(stats.total_contacts),
                totalSent: parseInt(stats.total_sent),
                totalFailed: parseInt(stats.total_failed),
                totalRead: parseInt(stats.total_read),
                totalResponses: parseInt(stats.total_responses),
                totalConversions: parseInt(stats.total_conversions),
                deliveryRate: parseFloat(deliveryRate),
                openRate: parseFloat(openRate),
                responseRate: parseFloat(responseRate),
                conversionRate: parseFloat(conversionRate)
            },
            recentCampaigns: recentCampaigns.rows.map(c => ({
                ...c,
                openRate: c.total_sent > 0 ? (c.read_count / c.total_sent * 100).toFixed(1) : 0,
                responseRate: c.total_sent > 0 ? (c.response_count / c.total_sent * 100).toFixed(1) : 0
            })),
            timeline: timelineData.rows,
            variantPerformance: variantStats.rows
        });
    } catch (err) {
        console.error('[API] ❌ Failed to get analytics:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /campaigns - Create a new campaign
server.post('/campaigns', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { name, template_id, target_filter, variants, ab_test_enabled } = request.body || {};

    if (!name) {
        return reply.status(400).send({ error: 'Campaign name is required' });
    }

    // Validate A/B test variants
    if (ab_test_enabled && (!variants || variants.length < 2)) {
        return reply.status(400).send({ error: 'A/B test requires at least 2 variants' });
    }

    try {
        // Count total contacts for this tenant (based on filter if provided)
        let contactCountQuery = 'SELECT COUNT(*) as count FROM contacts WHERE tenant_id = $1 AND opted_out = false';
        let contactParams = [request.tenantId];

        // Apply filters to get accurate count
        if (target_filter && Object.keys(target_filter).length > 0) {
            let paramIndex = 2;
            if (target_filter.tags && Array.isArray(target_filter.tags) && target_filter.tags.length > 0) {
                contactCountQuery += ` AND tags && $${paramIndex}`;
                contactParams.push(target_filter.tags);
                paramIndex++;
            }
            if (target_filter.location) {
                contactCountQuery += ` AND location ILIKE $${paramIndex}`;
                contactParams.push(`%${target_filter.location}%`);
                paramIndex++;
            }
            if (target_filter.last_interaction_days && parseInt(target_filter.last_interaction_days) > 0) {
                contactCountQuery += ` AND last_interaction >= NOW() - INTERVAL '${parseInt(target_filter.last_interaction_days)} days'`;
            }
        }

        const contactCount = await pool.query(contactCountQuery, contactParams);

        // Create campaign
        const result = await pool.query(
            `INSERT INTO campaigns (tenant_id, name, template_id, target_filter, total_contacts, ab_test_enabled) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING id, name, status, target_filter, total_contacts, total_sent, total_failed, created_at, ab_test_enabled`,
            [
                request.tenantId,
                name,
                ab_test_enabled ? null : (template_id || null), // Don't set template_id for A/B tests
                target_filter || {},
                parseInt(contactCount.rows[0].count),
                ab_test_enabled || false
            ]
        );

        const campaign = result.rows[0];

        // Create variants if A/B test
        if (ab_test_enabled && variants && variants.length > 0) {
            const variantLetters = ['A', 'B', 'C'];
            const splitPercent = Math.floor(100 / variants.length);

            for (let i = 0; i < variants.length && i < 3; i++) {
                const variant = variants[i];
                await pool.query(
                    `INSERT INTO campaign_variants (campaign_id, variant_letter, template_id, split_percent)
                     VALUES ($1, $2, $3, $4)`,
                    [campaign.id, variantLetters[i], variant.template_id, variant.split_percent || splitPercent]
                );
            }

            // Fetch created variants
            const createdVariants = await pool.query(
                `SELECT cv.*, t.name as template_name
                 FROM campaign_variants cv
                 LEFT JOIN templates t ON cv.template_id = t.id
                 WHERE cv.campaign_id = $1
                 ORDER BY cv.variant_letter`,
                [campaign.id]
            );
            campaign.variants = createdVariants.rows;
        }

        console.log(`[API] 📢 Campaign created: ${name}${ab_test_enabled ? ' (A/B Test)' : ''}`);
        return reply.status(201).send(campaign);
    } catch (err) {
        console.error('[API] ❌ Failed to create campaign:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// GET /campaigns/:id - Get campaign details with analytics
server.get('/campaigns/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.status, c.total_contacts, c.total_sent, c.total_failed, 
                    c.read_count, c.response_count, c.conversion_count,
                    c.created_at, c.completed_at, c.template_id, c.target_filter, c.scheduled_at,
                    c.ab_test_enabled, c.recurrence_type,
                    t.name as template_name, t.language as template_language
             FROM campaigns c
             LEFT JOIN templates t ON c.template_id = t.id
             WHERE c.id = $1 AND c.tenant_id = $2`,
            [id, request.tenantId]
        );
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Campaign not found' });
        }

        const campaign = result.rows[0];

        // Calculate analytics KPIs for this campaign
        const delivered = campaign.total_sent - campaign.total_failed;
        campaign.analytics = {
            delivered,
            deliveryRate: campaign.total_sent > 0 ? ((delivered / campaign.total_sent) * 100).toFixed(1) : 0,
            openRate: campaign.total_sent > 0 ? ((campaign.read_count || 0) / campaign.total_sent * 100).toFixed(1) : 0,
            responseRate: campaign.total_sent > 0 ? ((campaign.response_count || 0) / campaign.total_sent * 100).toFixed(1) : 0,
            conversionRate: campaign.total_sent > 0 ? ((campaign.conversion_count || 0) / campaign.total_sent * 100).toFixed(1) : 0
        };

        // Fetch variants if A/B test enabled (with their individual stats)
        if (campaign.ab_test_enabled) {
            const variants = await pool.query(
                `SELECT cv.*, t.name as template_name,
                        CASE WHEN cv.sent > 0 THEN ((cv.sent - cv.failed)::float / cv.sent * 100) ELSE 0 END as delivery_rate,
                        CASE WHEN cv.sent > 0 THEN (cv.read_count::float / cv.sent * 100) ELSE 0 END as open_rate
                 FROM campaign_variants cv
                 LEFT JOIN templates t ON cv.template_id = t.id
                 WHERE cv.campaign_id = $1
                 ORDER BY cv.variant_letter`,
                [id]
            );
            campaign.variants = variants.rows.map(v => ({
                ...v,
                delivery_rate: parseFloat(v.delivery_rate || 0).toFixed(1),
                open_rate: parseFloat(v.open_rate || 0).toFixed(1)
            }));
        }

        // Fetch recent campaign items with status
        const items = await pool.query(
            `SELECT ci.id, ci.phone, ci.status, ci.sent_at, ci.read_at, ci.response_at, ci.error_message
             FROM campaign_items ci
             WHERE ci.campaign_id = $1
             ORDER BY ci.sent_at DESC NULLS LAST
             LIMIT 50`,
            [id]
        );
        campaign.recent_items = items.rows;

        return reply.send(campaign);
    } catch (err) {
        console.error('[API] ❌ Failed to get campaign:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// PUT /campaigns/:id/filters - Update campaign target filters
server.put('/campaigns/:id/filters', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { target_filter } = request.body;

    try {
        const result = await pool.query(
            `UPDATE campaigns SET target_filter = $1 
             WHERE id = $2 AND tenant_id = $3 AND status = 'DRAFT'
             RETURNING id, target_filter`,
            [target_filter || {}, id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Campaign not found or not in DRAFT status' });
        }

        console.log(`[API] 🎯 Campaign ${id} filters updated:`, target_filter);
        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to update filters:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /campaigns/preview-contacts - Preview contacts matching filter criteria
server.post('/campaigns/preview-contacts', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { target_filter } = request.body;
    const filter = target_filter || {};

    try {
        let filterConditions = ['tenant_id = $1', 'opted_out = false'];
        let filterParams = [request.tenantId];
        let paramIndex = 2;

        if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
            filterConditions.push(`tags && $${paramIndex}`);
            filterParams.push(filter.tags);
            paramIndex++;
        }

        if (filter.location && filter.location.trim()) {
            filterConditions.push(`location ILIKE $${paramIndex}`);
            filterParams.push(`%${filter.location.trim()}%`);
            paramIndex++;
        }

        if (filter.country && filter.country.trim()) {
            filterConditions.push(`country = $${paramIndex}`);
            filterParams.push(filter.country.trim().toUpperCase());
            paramIndex++;
        }

        if (filter.last_interaction_days && parseInt(filter.last_interaction_days) > 0) {
            filterConditions.push(`last_interaction >= NOW() - INTERVAL '${parseInt(filter.last_interaction_days)} days'`);
        }

        const contactsQuery = `SELECT COUNT(*) as count FROM contacts WHERE ${filterConditions.join(' AND ')}`;
        const result = await pool.query(contactsQuery, filterParams);

        return reply.send({
            count: parseInt(result.rows[0].count),
            filter: filter
        });
    } catch (err) {
        console.error('[API] ❌ Failed to preview contacts:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// GET /contacts/tags - Get all unique tags for the tenant
server.get('/contacts/tags', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT unnest(tags) as tag FROM contacts WHERE tenant_id = $1`,
            [request.tenantId]
        );
        return reply.send(result.rows.map(r => r.tag).filter(Boolean));
    } catch (err) {
        console.error('[API] ❌ Failed to get tags:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// GET /contacts/locations - Get all unique locations for the tenant
server.get('/contacts/locations', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT location FROM contacts WHERE tenant_id = $1 AND location IS NOT NULL`,
            [request.tenantId]
        );
        return reply.send(result.rows.map(r => r.location).filter(Boolean));
    } catch (err) {
        console.error('[API] ❌ Failed to get locations:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /campaigns/:id/launch - Launch a campaign
server.post('/campaigns/:id/launch', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        // Get campaign details including A/B test flag
        const campaign = await pool.query(
            `SELECT c.id, c.name, c.status, c.template_id, c.target_filter, c.ab_test_enabled,
                    t.name as template_name, t.language
             FROM campaigns c
             LEFT JOIN templates t ON c.template_id = t.id
             WHERE c.id = $1 AND c.tenant_id = $2`,
            [id, request.tenantId]
        );

        if (campaign.rows.length === 0) {
            return reply.status(404).send({ error: 'Campaign not found' });
        }

        const campaignData = campaign.rows[0];

        if (campaignData.status !== 'DRAFT') {
            return reply.status(400).send({ error: 'Campaign already launched or completed' });
        }

        // For A/B tests, get variants; for regular, require template
        let variants = [];
        if (campaignData.ab_test_enabled) {
            const variantsResult = await pool.query(
                `SELECT cv.*, t.name as template_name, t.language
                 FROM campaign_variants cv
                 JOIN templates t ON cv.template_id = t.id
                 WHERE cv.campaign_id = $1
                 ORDER BY cv.variant_letter`,
                [id]
            );
            variants = variantsResult.rows;

            if (variants.length < 2) {
                return reply.status(400).send({ error: 'A/B test requires at least 2 variants with templates' });
            }
        } else if (!campaignData.template_id) {
            return reply.status(400).send({ error: 'No template selected for this campaign' });
        }

        // Build dynamic filter query based on target_filter
        const filter = campaignData.target_filter || {};
        let filterConditions = ['tenant_id = $1', 'opted_out = false'];
        let filterParams = [request.tenantId];
        let paramIndex = 2;

        // Filter by tags (ANY match)
        if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
            filterConditions.push(`tags && $${paramIndex}`);
            filterParams.push(filter.tags);
            paramIndex++;
        }

        // Filter by location
        if (filter.location && filter.location.trim()) {
            filterConditions.push(`location ILIKE $${paramIndex}`);
            filterParams.push(`%${filter.location.trim()}%`);
            paramIndex++;
        }

        // Filter by country
        if (filter.country && filter.country.trim()) {
            filterConditions.push(`country = $${paramIndex}`);
            filterParams.push(filter.country.trim().toUpperCase());
            paramIndex++;
        }

        // Filter by last interaction (within X days)
        if (filter.last_interaction_days && parseInt(filter.last_interaction_days) > 0) {
            filterConditions.push(`last_interaction >= NOW() - INTERVAL '${parseInt(filter.last_interaction_days)} days'`);
        }

        const contactsQuery = `SELECT id, phone, name FROM contacts 
             WHERE ${filterConditions.join(' AND ')}`;

        const contacts = await pool.query(contactsQuery, filterParams);

        if (contacts.rows.length === 0) {
            return reply.status(400).send({ error: 'No contacts match the filter criteria' });
        }

        // Update campaign status and start time
        await pool.query(
            `UPDATE campaigns 
             SET status = 'PROCESSING', 
                 total_contacts = $1,
                 started_at = NOW(),
                 stats = jsonb_build_object('pending', $1, 'queued', 0, 'sent', 0, 'delivered', 0, 'failed', 0)
             WHERE id = $2`,
            [contacts.rows.length, id]
        );

        // Create campaign_items and push to queue
        const redisPush = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
        let queuedCount = 0;

        // For A/B tests, prepare variant assignment thresholds
        let variantAssignments = [];
        if (campaignData.ab_test_enabled && variants.length > 0) {
            let cumulativePercent = 0;
            for (const v of variants) {
                cumulativePercent += v.split_percent;
                variantAssignments.push({
                    letter: v.variant_letter,
                    threshold: cumulativePercent,
                    template_name: v.template_name,
                    language: v.language || 'fr'
                });
            }
        }

        for (const contact of contacts.rows) {
            // Determine variant for A/B test
            let variantLetter = null;
            let templateName = campaignData.template_name;
            let templateLanguage = campaignData.language || 'fr';

            if (campaignData.ab_test_enabled && variantAssignments.length > 0) {
                const randomPercent = Math.random() * 100;
                for (const va of variantAssignments) {
                    if (randomPercent <= va.threshold) {
                        variantLetter = va.letter;
                        templateName = va.template_name;
                        templateLanguage = va.language;
                        break;
                    }
                }
            }

            // Create campaign_item entry with variant
            const itemResult = await pool.query(
                `INSERT INTO campaign_items (campaign_id, contact_id, status, variant_letter, queued_at)
                 VALUES ($1, $2, 'QUEUED', $3, NOW())
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                [id, contact.id, variantLetter]
            );

            if (itemResult.rows.length > 0) {
                const campaignItemId = itemResult.rows[0].id;

                const jobData = {
                    type: 'CAMPAIGN_SEND',
                    campaignItemId: campaignItemId,
                    campaignId: id,
                    tenantId: request.tenantId,
                    phone: contact.phone,
                    contactName: contact.name,
                    templateName: templateName,
                    templateLanguage: templateLanguage,
                    variantLetter: variantLetter
                };

                await redisPush.lpush('marketing_queue', JSON.stringify(jobData));
                queuedCount++;
            }
        }

        await redisPush.quit();

        console.log(`[API] 🚀 Campaign launched: ${campaignData.name}${campaignData.ab_test_enabled ? ' (A/B Test)' : ''} - ${queuedCount} contacts queued`);

        return reply.send({
            success: true,
            message: `Campagne lancée avec ${queuedCount} contacts${campaignData.ab_test_enabled ? ' (A/B Test)' : ''}`,
            campaign_id: id,
            total_contacts: queuedCount,
            ab_test_enabled: campaignData.ab_test_enabled
        });
    } catch (err) {
        console.error('[API] ❌ Failed to launch campaign:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /campaigns/:id/schedule - Schedule a campaign for later
server.post('/campaigns/:id/schedule', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { scheduled_at, recurrence_type } = request.body;

    if (!scheduled_at) {
        return reply.status(400).send({ error: 'scheduled_at is required' });
    }

    const scheduledDate = new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid date format' });
    }

    if (scheduledDate <= new Date()) {
        return reply.status(400).send({ error: 'Scheduled time must be in the future' });
    }

    // Validate recurrence_type
    const validRecurrence = ['none', 'daily', 'weekly', 'monthly'];
    const recurrence = recurrence_type && validRecurrence.includes(recurrence_type) ? recurrence_type : 'none';

    try {
        const result = await pool.query(
            `UPDATE campaigns 
             SET status = 'SCHEDULED', scheduled_at = $1, recurrence_type = $2 
             WHERE id = $3 AND tenant_id = $4 AND status = 'DRAFT'
             RETURNING id, name, scheduled_at, recurrence_type`,
            [scheduledDate, recurrence, id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Campaign not found or not in DRAFT status' });
        }

        const recurrenceLabels = {
            none: 'une seule fois',
            daily: 'tous les jours',
            weekly: 'toutes les semaines',
            monthly: 'tous les mois'
        };

        console.log(`[API] ⏰ Campaign scheduled: ${result.rows[0].name} at ${scheduledDate.toISOString()} (${recurrence})`);

        return reply.send({
            success: true,
            message: `Campagne programmée pour ${scheduledDate.toLocaleString('fr-FR')} (${recurrenceLabels[recurrence]})`,
            campaign: result.rows[0]
        });
    } catch (err) {
        console.error('[API] ❌ Failed to schedule campaign:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// POST /campaigns/:id/cancel-schedule - Cancel a scheduled campaign
server.post('/campaigns/:id/cancel-schedule', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            `UPDATE campaigns 
             SET status = 'DRAFT', scheduled_at = NULL 
             WHERE id = $1 AND tenant_id = $2 AND status = 'SCHEDULED'
             RETURNING id, name`,
            [id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Campaign not found or not scheduled' });
        }

        console.log(`[API] ❌ Schedule cancelled for: ${result.rows[0].name}`);

        return reply.send({
            success: true,
            message: 'Programmation annulée',
            campaign: result.rows[0]
        });
    } catch (err) {
        console.error('[API] ❌ Failed to cancel schedule:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// CAMPAIGN SCHEDULER (Auto-launch scheduled campaigns)
// ============================================
async function checkScheduledCampaigns() {
    try {
        // Find campaigns due to launch (including ab_test campaigns and recurrence info)
        const dueResult = await pool.query(
            `SELECT c.id, c.name, c.tenant_id, c.template_id, c.ab_test_enabled, c.target_filter, c.recurrence_type,
                    t.name as template_name, t.language
             FROM campaigns c
             LEFT JOIN templates t ON c.template_id = t.id
             WHERE c.status = 'SCHEDULED' 
             AND c.scheduled_at <= NOW()`
        );

        if (dueResult.rows.length === 0) return;

        console.log(`[Scheduler] ⏰ Found ${dueResult.rows.length} campaigns to launch`);

        for (const campaign of dueResult.rows) {
            try {
                // For A/B tests, get variants
                let variants = [];
                let templateName = campaign.template_name;
                let templateLanguage = campaign.language || 'fr';

                if (campaign.ab_test_enabled) {
                    const variantsResult = await pool.query(
                        `SELECT cv.*, t.name as template_name, t.language
                         FROM campaign_variants cv
                         JOIN templates t ON cv.template_id = t.id
                         WHERE cv.campaign_id = $1`,
                        [campaign.id]
                    );
                    variants = variantsResult.rows;

                    if (variants.length < 2) {
                        console.log(`[Scheduler] ⚠️ Campaign ${campaign.name}: A/B test missing variants`);
                        continue;
                    }
                } else if (!campaign.template_id) {
                    console.log(`[Scheduler] ⚠️ Campaign ${campaign.name}: No template`);
                    continue;
                }

                // Build filter conditions from target_filter
                const filter = campaign.target_filter || {};
                let filterConditions = ['tenant_id = $1', 'opted_out = false'];
                let filterParams = [campaign.tenant_id];
                let paramIndex = 2;

                if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
                    filterConditions.push(`tags && $${paramIndex}`);
                    filterParams.push(filter.tags);
                    paramIndex++;
                }
                if (filter.location && filter.location.trim()) {
                    filterConditions.push(`location ILIKE $${paramIndex}`);
                    filterParams.push(`%${filter.location.trim()}%`);
                    paramIndex++;
                }
                if (filter.last_interaction_days && parseInt(filter.last_interaction_days) > 0) {
                    filterConditions.push(`last_interaction >= NOW() - INTERVAL '${parseInt(filter.last_interaction_days)} days'`);
                }

                const contacts = await pool.query(
                    `SELECT id, phone, name FROM contacts WHERE ${filterConditions.join(' AND ')}`,
                    filterParams
                );

                if (contacts.rows.length === 0) {
                    await pool.query(
                        `UPDATE campaigns SET status = 'FAILED' WHERE id = $1`,
                        [campaign.id]
                    );
                    continue;
                }

                // Update campaign status
                await pool.query(
                    `UPDATE campaigns 
                     SET status = 'PROCESSING', 
                         total_contacts = $1,
                         started_at = NOW(),
                         last_run_at = NOW(),
                         stats = jsonb_build_object('pending', $1, 'queued', 0, 'sent', 0, 'delivered', 0, 'failed', 0)
                     WHERE id = $2`,
                    [contacts.rows.length, campaign.id]
                );

                // Prepare A/B variant assignments
                let variantAssignments = [];
                if (campaign.ab_test_enabled && variants.length > 0) {
                    let cumPercent = 0;
                    for (const v of variants) {
                        cumPercent += v.split_percent;
                        variantAssignments.push({
                            letter: v.variant_letter,
                            threshold: cumPercent,
                            template_name: v.template_name,
                            language: v.language || 'fr'
                        });
                    }
                }

                // Push to queue
                const redisPush = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

                for (const contact of contacts.rows) {
                    let variantLetter = null;
                    let tName = templateName;
                    let tLang = templateLanguage;

                    if (campaign.ab_test_enabled && variantAssignments.length > 0) {
                        const randPercent = Math.random() * 100;
                        for (const va of variantAssignments) {
                            if (randPercent <= va.threshold) {
                                variantLetter = va.letter;
                                tName = va.template_name;
                                tLang = va.language;
                                break;
                            }
                        }
                    }

                    const itemResult = await pool.query(
                        `INSERT INTO campaign_items (campaign_id, contact_id, status, variant_letter, queued_at)
                         VALUES ($1, $2, 'QUEUED', $3, NOW())
                         ON CONFLICT DO NOTHING
                         RETURNING id`,
                        [campaign.id, contact.id, variantLetter]
                    );

                    if (itemResult.rows.length > 0) {
                        await redisPush.lpush('marketing_queue', JSON.stringify({
                            type: 'CAMPAIGN_SEND',
                            campaignItemId: itemResult.rows[0].id,
                            campaignId: campaign.id,
                            tenantId: campaign.tenant_id,
                            phone: contact.phone,
                            contactName: contact.name,
                            templateName: tName,
                            templateLanguage: tLang,
                            variantLetter: variantLetter
                        }));
                    }
                }

                await redisPush.quit();

                // Handle recurrence - schedule next run
                if (campaign.recurrence_type && campaign.recurrence_type !== 'none') {
                    const now = new Date();
                    let nextRun = new Date(now);

                    switch (campaign.recurrence_type) {
                        case 'daily':
                            nextRun.setDate(nextRun.getDate() + 1);
                            break;
                        case 'weekly':
                            nextRun.setDate(nextRun.getDate() + 7);
                            break;
                        case 'monthly':
                            nextRun.setMonth(nextRun.getMonth() + 1);
                            break;
                    }

                    // Reset to SCHEDULED with new date (will be picked up again)
                    await pool.query(
                        `UPDATE campaigns 
                         SET scheduled_at = $1, status = 'SCHEDULED'
                         WHERE id = $2`,
                        [nextRun, campaign.id]
                    );
                    console.log(`[Scheduler] 🔄 Recurring campaign ${campaign.name}: next run at ${nextRun.toISOString()}`);
                }

                console.log(`[Scheduler] 🚀 Auto-launched campaign: ${campaign.name}`);
            } catch (err) {
                console.error(`[Scheduler] ❌ Failed to launch ${campaign.name}:`, err.message);
                await pool.query(
                    `UPDATE campaigns SET status = 'FAILED' WHERE id = $1`,
                    [campaign.id]
                );
            }
        }
    } catch (err) {
        console.error('[Scheduler] ❌ Scheduler error:', err.message);
    }
}

// ============================================
// EVENTS & TICKETING MODULE (V8.8)
// ============================================

// GET all events for tenant
server.get('/events', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        const result = await pool.query(
            `SELECT * FROM events 
             WHERE tenant_id = $1 
             ORDER BY date_start DESC`,
            [request.tenantId]
        );
        return reply.send(result.rows);
    } catch (err) {
        console.error('[API] ❌ Failed to get events:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// GET single event with tickets AND tiers
server.get('/events/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    try {
        const eventResult = await pool.query(
            `SELECT * FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );

        if (eventResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const ticketsResult = await pool.query(
            `SELECT t.*, c.name as contact_name, c.phone_number 
             FROM tickets t
             LEFT JOIN contacts c ON t.contact_id = c.id
             WHERE t.event_id = $1
             ORDER BY t.created_at DESC`,
            [id]
        );

        // Get tiers
        const tiersResult = await pool.query(
            `SELECT * FROM event_tiers WHERE event_id = $1 ORDER BY sort_order, price`,
            [id]
        );

        return reply.send({
            ...eventResult.rows[0],
            tickets: ticketsResult.rows,
            tiers: tiersResult.rows
        });
    } catch (err) {
        console.error('[API] ❌ Failed to get event:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ============================================
// EVENT TIERS (Multi-pricing: Early Bird, VIP, Standard)
// ============================================

// GET tiers for an event
server.get('/events/:id/tiers', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    try {
        const result = await pool.query(
            `SELECT et.*, 
                    (et.capacity - et.sold_count) as available_spots,
                    CASE 
                        WHEN et.available_from IS NOT NULL AND et.available_from > NOW() THEN 'upcoming'
                        WHEN et.available_until IS NOT NULL AND et.available_until < NOW() THEN 'expired'
                        WHEN et.capacity IS NOT NULL AND et.sold_count >= et.capacity THEN 'sold_out'
                        ELSE 'available'
                    END as status
             FROM event_tiers et 
             WHERE et.event_id = $1 
             ORDER BY et.sort_order, et.price`,
            [id]
        );
        return reply.send(result.rows);
    } catch (err) {
        return reply.status(500).send({ error: 'Erreur serveur' });
    }
});

// CREATE tier
server.post('/events/:id/tiers', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { name, description, price, capacity, available_from, available_until, perks, sort_order } = request.body || {};

    if (!name) {
        return reply.status(400).send({ error: 'Nom du tarif requis' });
    }

    try {
        // Verify event belongs to tenant
        const eventCheck = await pool.query(
            `SELECT id FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );
        if (eventCheck.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const result = await pool.query(
            `INSERT INTO event_tiers (event_id, name, description, price, capacity, available_from, available_until, perks, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [id, name, description || null, price || 0, capacity || null, available_from || null, available_until || null, JSON.stringify(perks || []), sort_order || 0]
        );

        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] Tier creation error:', err.message);
        return reply.status(500).send({ error: 'Erreur création tarif' });
    }
});

// UPDATE tier
server.put('/events/:eventId/tiers/:tierId', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { eventId, tierId } = request.params;
    const { name, description, price, capacity, available_from, available_until, perks, sort_order, is_active } = request.body || {};

    try {
        const result = await pool.query(
            `UPDATE event_tiers 
             SET name = COALESCE($1, name),
                 description = COALESCE($2, description),
                 price = COALESCE($3, price),
                 capacity = COALESCE($4, capacity),
                 available_from = COALESCE($5, available_from),
                 available_until = COALESCE($6, available_until),
                 perks = COALESCE($7, perks),
                 sort_order = COALESCE($8, sort_order),
                 is_active = COALESCE($9, is_active)
             WHERE id = $10 AND event_id = $11
             RETURNING *`,
            [name, description, price, capacity, available_from, available_until, perks ? JSON.stringify(perks) : null, sort_order, is_active, tierId, eventId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Tarif non trouvé' });
        }

        return reply.send(result.rows[0]);
    } catch (err) {
        return reply.status(500).send({ error: 'Erreur mise à jour' });
    }
});

// DELETE tier
server.delete('/events/:eventId/tiers/:tierId', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { eventId, tierId } = request.params;

    try {
        // Check if tier has tickets
        const ticketCheck = await pool.query(
            `SELECT COUNT(*) as count FROM tickets WHERE tier_id = $1`,
            [tierId]
        );

        if (parseInt(ticketCheck.rows[0].count) > 0) {
            return reply.status(400).send({ error: 'Impossible de supprimer un tarif avec des inscriptions' });
        }

        await pool.query(
            `DELETE FROM event_tiers WHERE id = $1 AND event_id = $2`,
            [tierId, eventId]
        );

        return reply.send({ success: true });
    } catch (err) {
        return reply.status(500).send({ error: 'Erreur suppression' });
    }
});

// Bulk create tiers (for quick setup)
server.post('/events/:id/tiers/bulk', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { tiers } = request.body || {};

    if (!Array.isArray(tiers) || tiers.length === 0) {
        return reply.status(400).send({ error: 'Tableau de tarifs requis' });
    }

    try {
        const results = [];
        for (let i = 0; i < tiers.length; i++) {
            const t = tiers[i];
            const result = await pool.query(
                `INSERT INTO event_tiers (event_id, name, description, price, capacity, available_from, available_until, perks, sort_order)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [id, t.name, t.description || null, t.price || 0, t.capacity || null, t.available_from || null, t.available_until || null, JSON.stringify(t.perks || []), i]
            );
            results.push(result.rows[0]);
        }

        return reply.send(results);
    } catch (err) {
        return reply.status(500).send({ error: 'Erreur création en masse' });
    }
});

// CREATE event (with Stripe product/price auto-creation)
server.post('/events', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const {
        title, description, date_start, date_end,
        price, currency, capacity, image_url,
        location_details, event_type, output_format
    } = request.body || {};

    if (!title || !date_start) {
        return reply.status(400).send({ error: 'title et date_start requis' });
    }

    try {
        let stripe_product_id = null;
        let stripe_price_id = null;

        // Get tenant Stripe config
        const stripeConfig = await pool.query(
            `SELECT stripe_secret_key FROM billing_configs WHERE tenant_id = $1`,
            [request.tenantId]
        );

        // If price > 0 and has Stripe, create product + price
        if (price > 0 && stripeConfig.rows.length > 0 && stripeConfig.rows[0].stripe_secret_key) {
            const Stripe = require('stripe');
            const stripe = new Stripe(stripeConfig.rows[0].stripe_secret_key);

            // Create product
            const product = await stripe.products.create({
                name: title,
                description: description || `Événement: ${title}`,
                images: image_url ? [image_url] : []
            });
            stripe_product_id = product.id;

            // Create price
            const stripePrice = await stripe.prices.create({
                product: product.id,
                unit_amount: Math.round(price * 100), // Convert to cents
                currency: (currency || 'EUR').toLowerCase()
            });
            stripe_price_id = stripePrice.id;

            console.log(`[API] 💳 Stripe product created: ${product.id}`);
        }

        const result = await pool.query(
            `INSERT INTO events (tenant_id, title, description, date_start, date_end, price, currency, capacity, image_url, stripe_product_id, stripe_price_id, location_details, event_type, output_format)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [request.tenantId, title, description, date_start, date_end || null, price || 0, currency || 'EUR', capacity || 100, image_url, stripe_product_id, stripe_price_id, location_details || null, event_type || 'STANDARD', output_format || 'TICKET']
        );

        console.log(`[API] 🎟️ Event created: ${title} (${output_format || 'TICKET'})`);
        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to create event:', err.message);
        return reply.status(500).send({ error: 'Erreur création événement' });
    }
});

// UPDATE event
server.put('/events/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { title, description, date_start, price, capacity, image_url, is_active } = request.body || {};

    try {
        const result = await pool.query(
            `UPDATE events SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                date_start = COALESCE($3, date_start),
                price = COALESCE($4, price),
                capacity = COALESCE($5, capacity),
                image_url = COALESCE($6, image_url),
                is_active = COALESCE($7, is_active),
                updated_at = NOW()
             WHERE id = $8 AND tenant_id = $9
             RETURNING *`,
            [title, description, date_start, price, capacity, image_url, is_active, id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        return reply.send(result.rows[0]);
    } catch (err) {
        console.error('[API] ❌ Failed to update event:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// DELETE event
server.delete('/events/:id', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            `DELETE FROM events WHERE id = $1 AND tenant_id = $2 RETURNING id, title`,
            [id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        console.log(`[API] 🗑️ Event deleted: ${result.rows[0].title}`);
        return reply.send({ success: true, deleted: result.rows[0] });
    } catch (err) {
        console.error('[API] ❌ Failed to delete event:', err.message);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// CREATE ticket/badge (called after Stripe payment or manually)
server.post('/events/:id/tickets', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { attendee_name, attendee_phone, contact_id, attendee_company, attendee_role } = request.body || {};

    try {
        // Check event exists and has capacity
        const eventResult = await pool.query(
            `SELECT * FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );

        if (eventResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const event = eventResult.rows[0];
        const isBadge = event.output_format === 'BADGE';

        if (event.sold_count >= event.capacity) {
            return reply.status(400).send({ error: 'Événement complet' });
        }

        // Generate unique QR code data
        const qr_code_data = `TICKET-${crypto.randomUUID()}`;

        // Create ticket with pro fields
        const ticketResult = await pool.query(
            `INSERT INTO tickets (event_id, contact_id, attendee_name, attendee_phone, attendee_company, attendee_role, qr_code_data, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'PAID')
             RETURNING *`,
            [id, contact_id, attendee_name, attendee_phone, attendee_company || null, attendee_role || null, qr_code_data]
        );

        const ticket = ticketResult.rows[0];

        // Increment sold count
        await pool.query(
            `UPDATE events SET sold_count = sold_count + 1, updated_at = NOW() WHERE id = $1`,
            [id]
        );

        // Generate QR Code image (smaller for badges)
        const qrSize = isBadge ? 120 : 250;
        const qrBuffer = await QRCode.toBuffer(qr_code_data, {
            width: qrSize,
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' }
        });

        let documentBuffer;
        let documentFilename;
        let documentUrl;

        if (isBadge) {
            // ============================================
            // BADGE TEMPLATE (Pro - Horizontal Nametag)
            // ============================================
            const firstName = (attendee_name || 'Invité').split(' ')[0];
            const lastName = (attendee_name || '').split(' ').slice(1).join(' ') || '';
            const company = attendee_company || '';
            const role = attendee_role || 'Participant';

            // Role badge color
            let roleBgColor = '#3B82F6';
            if (role.toLowerCase().includes('vip')) roleBgColor = '#F59E0B';
            if (role.toLowerCase().includes('speaker')) roleBgColor = '#8B5CF6';
            if (role.toLowerCase().includes('staff')) roleBgColor = '#EF4444';
            if (role.toLowerCase().includes('organis')) roleBgColor = '#10B981';

            const badgeSvg = `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
                <rect width="600" height="400" fill="#FAFAFA"/>
                <rect width="600" height="8" fill="#1E293B"/>
                <text x="30" y="45" font-family="Arial" font-size="14" fill="#64748B">${event.title.substring(0, 40)}</text>
                <text x="30" y="120" font-family="Arial" font-size="48" fill="#0F172A" font-weight="bold">${firstName.substring(0, 15)}</text>
                <text x="30" y="170" font-family="Arial" font-size="36" fill="#334155" font-weight="bold">${lastName.substring(0, 20)}</text>
                <text x="30" y="220" font-family="Arial" font-size="20" fill="#64748B">${company.substring(0, 30)}</text>
                <rect x="30" y="250" width="${Math.min(role.length * 12 + 30, 200)}" height="32" rx="16" fill="${roleBgColor}"/>
                <text x="45" y="272" font-family="Arial" font-size="14" fill="white" font-weight="bold">${role.substring(0, 15).toUpperCase()}</text>
                <text x="30" y="340" font-family="Arial" font-size="12" fill="#94A3B8">${new Date(event.date_start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${event.date_end ? ' - ' + new Date(event.date_end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''}</text>
                <text x="30" y="360" font-family="Arial" font-size="11" fill="#CBD5E1">${(event.location_details || '').substring(0, 50)}</text>
                <rect y="392" width="600" height="8" fill="#1E293B"/>
            </svg>`;

            documentBuffer = await sharp({
                create: { width: 600, height: 400, channels: 4, background: { r: 250, g: 250, b: 250, alpha: 1 } }
            })
                .composite([
                    { input: Buffer.from(badgeSvg), top: 0, left: 0 },
                    { input: qrBuffer, top: 270, left: 460 }
                ])
                .png()
                .toBuffer();

            documentFilename = `badge-${ticket.id}.png`;
        } else {
            // ============================================
            // TICKET TEMPLATE (Standard - Vertical)
            // ============================================
            const ticketSvg = `<svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#128C7E"/>
                        <stop offset="100%" style="stop-color:#075E54"/>
                    </linearGradient>
                </defs>
                <rect width="400" height="600" fill="url(#grad)"/>
                <rect x="20" y="20" width="360" height="560" rx="20" fill="white"/>
                <text x="200" y="70" font-family="Arial" font-size="28" fill="#128C7E" text-anchor="middle" font-weight="bold">BILLET</text>
                <text x="200" y="120" font-family="Arial" font-size="22" fill="#1F2937" text-anchor="middle" font-weight="bold">${event.title.substring(0, 25)}</text>
                <text x="200" y="160" font-family="Arial" font-size="16" fill="#6B7280" text-anchor="middle">${new Date(event.date_start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</text>
                <text x="200" y="185" font-family="Arial" font-size="14" fill="#9CA3AF" text-anchor="middle">${new Date(event.date_start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</text>
                <line x1="40" y1="480" x2="360" y2="480" stroke="#E5E7EB" stroke-width="2" stroke-dasharray="10,5"/>
                <text x="200" y="520" font-family="Arial" font-size="16" fill="#374151" text-anchor="middle" font-weight="bold">${(attendee_name || 'Invité').substring(0, 30)}</text>
                <text x="200" y="550" font-family="Arial" font-size="10" fill="#D1D5DB" text-anchor="middle">ID: ${ticket.id.substring(0, 8)}</text>
            </svg>`;

            documentBuffer = await sharp({
                create: { width: 400, height: 600, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
            })
                .composite([
                    { input: Buffer.from(ticketSvg), top: 0, left: 0 },
                    { input: qrBuffer, top: 210, left: 75 }
                ])
                .png()
                .toBuffer();

            documentFilename = `ticket-${ticket.id}.png`;
        }

        documentUrl = `/uploads/tickets/${documentFilename}`;

        // Save document to persistent storage
        const documentPath = path.join('/app/uploads/tickets', documentFilename);
        await fs.promises.mkdir('/app/uploads/tickets', { recursive: true });
        await fs.promises.writeFile(documentPath, documentBuffer);

        // Update ticket with URL
        const urlField = isBadge ? 'badge_url' : 'ticket_image_url';
        await pool.query(
            `UPDATE tickets SET ${urlField} = $1 WHERE id = $2`,
            [documentUrl, ticket.id]
        );

        console.log(`[API] ${isBadge ? '🪪 Badge' : '🎫 Ticket'} created for ${event.title}: ${ticket.id}`);

        // Send ticket via WhatsApp if phone number is provided
        if (attendee_phone && META_ACCESS_TOKEN && META_PHONE_ID) {
            try {
                // Format phone number (remove +, spaces, etc.)
                let formattedPhone = attendee_phone.replace(/\D/g, '');
                if (formattedPhone.startsWith('0')) {
                    formattedPhone = '33' + formattedPhone.substring(1); // France default
                }
                if (!formattedPhone.startsWith('33') && formattedPhone.length === 9) {
                    formattedPhone = '33' + formattedPhone;
                }

                // Step 1: Upload image to Meta Media API
                const FormData = require('form-data');
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
                console.log(`[API] 📤 Media uploaded: ${mediaId}`);

                // Step 2: Send image message via WhatsApp (conditional caption)
                const caption = isBadge
                    ? `👋 Bonjour ${attendee_name || ''},\n\nVoici votre *Badge d'Accès* pour *${event.title}*.\n\n📅 ${new Date(event.date_start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${event.date_end ? ' au ' + new Date(event.date_end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''}\n📍 ${event.location_details || ''}\n\n✅ Veuillez le présenter (ou l'imprimer) à l'accueil.\n\nÀ très bientôt ! 🎉`
                    : `🎟️ Voici votre *Billet* pour *${event.title}*\n\n📅 ${new Date(event.date_start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}\n\n✅ Présentez ce QR code à l'entrée.\n\nÀ bientôt ! 🎉`;

                await axios.post(
                    META_API_URL,
                    {
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: formattedPhone,
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

                console.log(`[API] 📱 ${isBadge ? 'Badge' : 'Ticket'} sent via WhatsApp to ${formattedPhone}`);
            } catch (whatsappErr) {
                console.error('[API] ⚠️ WhatsApp send failed:', whatsappErr.message);
            }
        }

        return reply.send({
            ...ticket,
            document_type: isBadge ? 'BADGE' : 'TICKET',
            document_url: documentUrl,
            event_title: event.title,
            whatsapp_sent: !!attendee_phone
        });
    } catch (err) {
        console.error('[API] ❌ Failed to create document:', err.message);
        return reply.status(500).send({ error: 'Erreur création document' });
    }
});

// ============================================
// V8.95 GUEST MANAGER - IMPORT ATTENDEES
// ============================================

// IMPORT attendees from CSV/JSON and queue badge sending
server.post('/events/:id/import-attendees', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { attendees, send_badges = true } = request.body || {};

    if (!attendees || !Array.isArray(attendees) || attendees.length === 0) {
        return reply.status(400).send({ error: 'attendees array required with at least one entry' });
    }

    try {
        // Check event exists
        const eventResult = await pool.query(
            `SELECT * FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );

        if (eventResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const event = eventResult.rows[0];
        const results = {
            imported: 0,
            skipped: 0,
            queued: 0,
            errors: []
        };

        for (const attendee of attendees) {
            try {
                const { name, phone, company, role } = attendee;

                if (!name || !phone) {
                    results.skipped++;
                    results.errors.push(`Missing name or phone for entry`);
                    continue;
                }

                // Format phone number
                let formattedPhone = phone.toString().replace(/\D/g, '');
                if (formattedPhone.startsWith('0')) {
                    formattedPhone = '33' + formattedPhone.substring(1);
                }
                if (!formattedPhone.startsWith('33') && formattedPhone.length === 9) {
                    formattedPhone = '33' + formattedPhone;
                }

                // Check if ticket already exists for this phone + event
                const existingTicket = await pool.query(
                    `SELECT id FROM tickets WHERE event_id = $1 AND attendee_phone = $2`,
                    [id, formattedPhone]
                );

                if (existingTicket.rows.length > 0) {
                    results.skipped++;
                    continue;
                }

                // Find or create contact
                let contactId = null;
                const existingContact = await pool.query(
                    `SELECT id FROM contacts WHERE tenant_id = $1 AND wa_id = $2`,
                    [request.tenantId, formattedPhone]
                );

                if (existingContact.rows.length > 0) {
                    contactId = existingContact.rows[0].id;
                } else {
                    const newContact = await pool.query(
                        `INSERT INTO contacts (tenant_id, wa_id, name) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (tenant_id, wa_id) DO UPDATE SET name = EXCLUDED.name
                         RETURNING id`,
                        [request.tenantId, formattedPhone, name]
                    );
                    contactId = newContact.rows[0].id;
                }

                // Generate QR code data
                const qr_code_data = `TICKET-${crypto.randomUUID()}`;

                // Create ticket with COMPLIMENTARY status
                const ticketResult = await pool.query(
                    `INSERT INTO tickets (event_id, contact_id, attendee_name, attendee_phone, attendee_company, attendee_role, qr_code_data, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLIMENTARY')
                     RETURNING *`,
                    [id, contactId, name, formattedPhone, company || null, role || null, qr_code_data]
                );

                const ticket = ticketResult.rows[0];
                results.imported++;

                // Increment sold count
                await pool.query(
                    `UPDATE events SET sold_count = sold_count + 1, updated_at = NOW() WHERE id = $1`,
                    [id]
                );

                // Queue badge sending job if send_badges is true
                if (send_badges && formattedPhone) {
                    await redisClient.lPush('marketing_queue', JSON.stringify({
                        type: 'SEND_EVENT_BADGE',
                        ticket_id: ticket.id,
                        event_id: id,
                        tenant_id: request.tenantId,
                        attendee_name: name,
                        attendee_phone: formattedPhone,
                        attendee_company: company || null,
                        attendee_role: role || null,
                        created_at: new Date().toISOString()
                    }));
                    results.queued++;
                }

            } catch (entryErr) {
                results.errors.push(`Error for ${attendee.name}: ${entryErr.message}`);
            }
        }

        console.log(`[API] 📥 Guest import for ${event.title}: ${results.imported} imported, ${results.queued} queued, ${results.skipped} skipped`);

        return reply.send({
            success: true,
            event_id: id,
            event_title: event.title,
            ...results
        });
    } catch (err) {
        console.error('[API] ❌ Failed to import attendees:', err.message);
        return reply.status(500).send({ error: 'Erreur import participants' });
    }
});

// GET pending badges queue status for an event
server.get('/events/:id/badge-queue', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        // Get tickets with sent status
        const result = await pool.query(
            `SELECT 
                COUNT(*) FILTER (WHERE sent_at IS NOT NULL) as sent,
                COUNT(*) FILTER (WHERE sent_at IS NULL AND status != 'CANCELLED') as pending,
                COUNT(*) as total
             FROM tickets 
             WHERE event_id = $1`,
            [id]
        );

        return reply.send(result.rows[0]);
    } catch (err) {
        return reply.status(500).send({ error: 'Erreur récupération statut' });
    }
});

// EVENTS ANALYTICS DASHBOARD
server.get('/events/analytics/dashboard', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    try {
        // 1. Overall Stats
        const overallStats = await pool.query(`
            SELECT 
                COUNT(DISTINCT e.id) as total_events,
                COUNT(DISTINCT CASE WHEN e.date_start > NOW() THEN e.id END) as upcoming_events,
                COUNT(t.id) as total_tickets,
                COUNT(CASE WHEN t.status = 'PAID' THEN 1 END) as paid_tickets,
                COUNT(CASE WHEN t.status = 'COMPLIMENTARY' THEN 1 END) as free_tickets,
                COUNT(CASE WHEN t.status = 'USED' THEN 1 END) as checked_in,
                COUNT(CASE WHEN t.status = 'CANCELLED' THEN 1 END) as cancelled,
                COALESCE(SUM(e.price) FILTER (WHERE t.status = 'PAID'), 0) as total_revenue
            FROM events e
            LEFT JOIN tickets t ON e.id = t.event_id
            WHERE e.tenant_id = $1
        `, [request.tenantId]);

        // 2. Conversion Funnel (page views -> registrations -> paid)
        const conversionFunnel = await pool.query(`
            SELECT 
                COUNT(*) as total_registrations,
                COUNT(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 END) as pending_payment,
                COUNT(CASE WHEN status IN ('PAID', 'COMPLIMENTARY', 'USED') THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as abandoned
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE e.tenant_id = $1
        `, [request.tenantId]);

        // 3. Registrations by Source
        const sourceBreakdown = await pool.query(`
            SELECT 
                COALESCE(source, 'direct') as source,
                COUNT(*) as count,
                ROUND(COUNT(*)::decimal / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) as percentage
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE e.tenant_id = $1
            GROUP BY source
            ORDER BY count DESC
            LIMIT 10
        `, [request.tenantId]);

        // 4. Hourly Registration Heatmap (day of week x hour)
        const heatmapData = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM t.created_at) as day_of_week,
                EXTRACT(HOUR FROM t.created_at) as hour,
                COUNT(*) as count
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE e.tenant_id = $1 AND t.created_at > NOW() - INTERVAL '30 days'
            GROUP BY day_of_week, hour
            ORDER BY day_of_week, hour
        `, [request.tenantId]);

        // 5. Daily Registration Trend (last 14 days)
        const dailyTrend = await pool.query(`
            SELECT 
                DATE(t.created_at) as date,
                COUNT(*) as registrations,
                COUNT(CASE WHEN t.status = 'PAID' THEN 1 END) as paid
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE e.tenant_id = $1 AND t.created_at > NOW() - INTERVAL '14 days'
            GROUP BY DATE(t.created_at)
            ORDER BY date
        `, [request.tenantId]);

        // 6. Top Events by Registration
        const topEvents = await pool.query(`
            SELECT 
                e.id,
                e.title,
                e.date_start,
                e.capacity,
                e.sold_count,
                COUNT(t.id) as total_tickets,
                COUNT(CASE WHEN t.status = 'USED' THEN 1 END) as checked_in,
                ROUND(e.sold_count::decimal / NULLIF(e.capacity, 0) * 100, 1) as fill_rate
            FROM events e
            LEFT JOIN tickets t ON e.id = t.event_id
            WHERE e.tenant_id = $1
            GROUP BY e.id
            ORDER BY total_tickets DESC
            LIMIT 5
        `, [request.tenantId]);

        // 7. UTM Campaign Performance
        const utmPerformance = await pool.query(`
            SELECT 
                COALESCE(utm_campaign, 'Aucune') as campaign,
                COALESCE(utm_source, 'direct') as source,
                COUNT(*) as registrations,
                COUNT(CASE WHEN status IN ('PAID', 'USED') THEN 1 END) as converted
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE e.tenant_id = $1 AND utm_campaign IS NOT NULL
            GROUP BY utm_campaign, utm_source
            ORDER BY registrations DESC
            LIMIT 10
        `, [request.tenantId]);

        return reply.send({
            overview: overallStats.rows[0],
            conversion: conversionFunnel.rows[0],
            sources: sourceBreakdown.rows,
            heatmap: heatmapData.rows,
            daily_trend: dailyTrend.rows,
            top_events: topEvents.rows,
            utm_campaigns: utmPerformance.rows
        });

    } catch (err) {
        console.error('[API] Analytics error:', err.message);
        return reply.status(500).send({ error: 'Erreur analytics' });
    }
});

// Single Event Analytics
server.get('/events/:id/analytics', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;

    try {
        // Event info
        const eventResult = await pool.query(
            `SELECT * FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );

        if (eventResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const event = eventResult.rows[0];

        // Ticket stats
        const ticketStats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'PAID' THEN 1 END) as paid,
                COUNT(CASE WHEN status = 'COMPLIMENTARY' THEN 1 END) as complimentary,
                COUNT(CASE WHEN status = 'USED' THEN 1 END) as checked_in,
                COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled,
                COUNT(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 END) as pending
            FROM tickets WHERE event_id = $1
        `, [id]);

        // Source breakdown
        const sources = await pool.query(`
            SELECT 
                COALESCE(source, 'direct') as source,
                COUNT(*) as count
            FROM tickets WHERE event_id = $1
            GROUP BY source
            ORDER BY count DESC
        `, [id]);

        // Hourly heatmap for this event
        const heatmap = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM created_at) as day,
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as count
            FROM tickets WHERE event_id = $1
            GROUP BY day, hour
        `, [id]);

        // Registration timeline
        const timeline = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as count
            FROM tickets WHERE event_id = $1
            GROUP BY DATE(created_at)
            ORDER BY date
        `, [id]);

        // Role distribution
        const roles = await pool.query(`
            SELECT 
                COALESCE(attendee_role, 'Participant') as role,
                COUNT(*) as count
            FROM tickets WHERE event_id = $1
            GROUP BY attendee_role
            ORDER BY count DESC
        `, [id]);

        // Company breakdown
        const companies = await pool.query(`
            SELECT 
                COALESCE(attendee_company, 'Non renseigné') as company,
                COUNT(*) as count
            FROM tickets WHERE event_id = $1
            GROUP BY attendee_company
            ORDER BY count DESC
            LIMIT 10
        `, [id]);

        return reply.send({
            event,
            stats: ticketStats.rows[0],
            fill_rate: Math.round((event.sold_count / event.capacity) * 100),
            sources: sources.rows,
            heatmap: heatmap.rows,
            timeline: timeline.rows,
            roles: roles.rows,
            companies: companies.rows
        });

    } catch (err) {
        console.error('[API] Event analytics error:', err.message);
        return reply.status(500).send({ error: 'Erreur analytics' });
    }
});

// SCAN ticket (venue access control)
server.post('/tickets/scan', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { ticket_id, qr_code_data } = request.body || {};

    if (!ticket_id && !qr_code_data) {
        return reply.status(400).send({ error: 'ticket_id ou qr_code_data requis' });
    }

    try {
        // Find ticket
        let ticketResult;
        if (ticket_id) {
            ticketResult = await pool.query(
                `SELECT t.*, e.title as event_title, e.tenant_id
                 FROM tickets t
                 JOIN events e ON t.event_id = e.id
                 WHERE t.id = $1`,
                [ticket_id]
            );
        } else {
            ticketResult = await pool.query(
                `SELECT t.*, e.title as event_title, e.tenant_id
                 FROM tickets t
                 JOIN events e ON t.event_id = e.id
                 WHERE t.qr_code_data = $1`,
                [qr_code_data]
            );
        }

        if (ticketResult.rows.length === 0) {
            return reply.send({
                valid: false,
                status: 'NOT_FOUND',
                message: 'Billet non trouvé ❌'
            });
        }

        const ticket = ticketResult.rows[0];

        // Check tenant
        if (ticket.tenant_id !== request.tenantId) {
            return reply.send({
                valid: false,
                status: 'INVALID',
                message: 'Billet invalide ❌'
            });
        }

        // Check status
        if (ticket.status === 'USED') {
            return reply.send({
                valid: false,
                status: 'ALREADY_USED',
                message: 'Déjà scanné ⚠️',
                attendee_name: ticket.attendee_name,
                event_title: ticket.event_title
            });
        }

        if (ticket.status === 'CANCELLED') {
            return reply.send({
                valid: false,
                status: 'CANCELLED',
                message: 'Billet annulé ❌'
            });
        }

        // Mark as used
        await pool.query(
            `UPDATE tickets SET status = 'USED', updated_at = NOW() WHERE id = $1`,
            [ticket.id]
        );

        console.log(`[API] ✅ Ticket scanned: ${ticket.id} for ${ticket.event_title}`);

        return reply.send({
            valid: true,
            status: 'VALID',
            message: 'Validé ✅',
            attendee_name: ticket.attendee_name,
            event_title: ticket.event_title
        });
    } catch (err) {
        console.error('[API] ❌ Failed to scan ticket:', err.message);
        return reply.status(500).send({ error: 'Erreur scan' });
    }
});

// Get Stripe checkout link for event
server.post('/events/:id/checkout', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const { success_url, cancel_url, attendee_name, attendee_phone } = request.body || {};

    try {
        // Get event
        const eventResult = await pool.query(
            `SELECT * FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );

        if (eventResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const event = eventResult.rows[0];

        if (!event.stripe_price_id) {
            return reply.status(400).send({ error: 'Pas de prix Stripe configuré' });
        }

        // Get Stripe config
        const stripeConfig = await pool.query(
            `SELECT stripe_secret_key FROM billing_configs WHERE tenant_id = $1`,
            [request.tenantId]
        );

        if (stripeConfig.rows.length === 0) {
            return reply.status(400).send({ error: 'Stripe non configuré' });
        }

        const Stripe = require('stripe');
        const stripe = new Stripe(stripeConfig.rows[0].stripe_secret_key);

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{
                price: event.stripe_price_id,
                quantity: 1
            }],
            success_url: success_url || `${process.env.FRONTEND_URL}/events/${id}/success`,
            cancel_url: cancel_url || `${process.env.FRONTEND_URL}/events/${id}`,
            metadata: {
                event_id: id,
                tenant_id: request.tenantId,
                attendee_name: attendee_name || '',
                attendee_phone: attendee_phone || ''
            }
        });

        return reply.send({
            checkout_url: session.url,
            session_id: session.id
        });
    } catch (err) {
        console.error('[API] ❌ Failed to create checkout:', err.message);
        return reply.status(500).send({ error: 'Erreur création paiement' });
    }
});

// ============================================
// V8.99 PUBLIC EVENT PAGES (No Auth Required)
// ============================================

// GET public event info (no auth)
server.get('/public/events/:id', async (request, reply) => {
    const { id } = request.params;

    try {
        const result = await pool.query(
            `SELECT id, title, description, date_start, date_end, price, currency, capacity, sold_count, 
                    image_url, location_details, event_type, output_format, is_active
             FROM events WHERE id = $1 AND is_active = true`,
            [id]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        // Get active tiers
        const tiersResult = await pool.query(
            `SELECT id, name, description, price, capacity, sold_count,
                    (capacity - sold_count) as available_spots,
                    available_from, available_until, perks,
                    CASE 
                        WHEN available_from IS NOT NULL AND available_from > NOW() THEN 'upcoming'
                        WHEN available_until IS NOT NULL AND available_until < NOW() THEN 'expired'
                        WHEN capacity IS NOT NULL AND sold_count >= capacity THEN 'sold_out'
                        ELSE 'available'
                    END as status
             FROM event_tiers 
             WHERE event_id = $1 AND is_active = true
             ORDER BY sort_order, price`,
            [id]
        );

        const event = result.rows[0];
        const tiers = tiersResult.rows;

        // If event has tiers, use tier pricing, otherwise use event price
        const hasTiers = tiers.length > 0;
        const availableTiers = tiers.filter(t => t.status === 'available');

        return reply.send({
            ...event,
            available_spots: event.capacity - event.sold_count,
            requires_company_info: ['SEMINAR', 'CONGRESS'].includes(event.event_type),
            has_tiers: hasTiers,
            tiers: tiers,
            min_price: hasTiers ? Math.min(...availableTiers.map(t => parseFloat(t.price) || 0)) : parseFloat(event.price) || 0,
            max_price: hasTiers ? Math.max(...availableTiers.map(t => parseFloat(t.price) || 0)) : parseFloat(event.price) || 0
        });
    } catch (err) {
        console.error('[API] ❌ Failed to fetch public event:', err.message);
        return reply.status(500).send({ error: 'Erreur serveur' });
    }
});

// ============================================
// EMBED WIDGET ENDPOINTS (no auth required)
// ============================================

// Serve embed script.js for external sites
server.get('/embed/:id/script.js', async (request, reply) => {
    const { id } = request.params;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

    const script = `
(function() {
    var containerId = 'vectra-event-${id}';
    var container = document.getElementById(containerId);
    if (!container) {
        console.error('Vectra: Container #' + containerId + ' not found');
        return;
    }
    
    var theme = container.getAttribute('data-theme') || 'light';
    var accent = container.getAttribute('data-accent') || '#8b5cf6';
    var width = container.getAttribute('data-width') || '100%';
    var height = container.getAttribute('data-height') || '500px';
    
    // Get UTM params from current page
    var urlParams = new URLSearchParams(window.location.search);
    var utm_source = urlParams.get('utm_source') || '';
    var utm_medium = urlParams.get('utm_medium') || '';
    var utm_campaign = urlParams.get('utm_campaign') || '';
    
    var embedUrl = '${frontendUrl}/embed/${id}?theme=' + theme + '&accent=' + encodeURIComponent(accent);
    embedUrl += '&utm_source=' + encodeURIComponent(utm_source || 'embed');
    embedUrl += '&utm_medium=' + encodeURIComponent(utm_medium || 'widget');
    embedUrl += '&utm_campaign=' + encodeURIComponent(utm_campaign);
    embedUrl += '&referrer=' + encodeURIComponent(window.location.href);
    
    var iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.style.width = width;
    iframe.style.height = height;
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.overflow = 'hidden';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('scrolling', 'no');
    
    container.appendChild(iframe);
    
    // Listen for success message
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'VECTRA_REGISTRATION_SUCCESS') {
            container.dispatchEvent(new CustomEvent('vectra:registration', { detail: e.data }));
        }
    });
})();
    `.trim();

    reply.header('Content-Type', 'application/javascript');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(script);
});

// Get embed snippet for an event (for copy-paste)
server.get('/events/:id/embed-code', {
    preHandler: [server.authenticate]
}, async (request, reply) => {
    const { id } = request.params;
    const apiUrl = process.env.API_URL || 'http://localhost:4000';

    try {
        const result = await pool.query(
            `SELECT title FROM events WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
        );

        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const snippetHtml = `<!-- Vectra Event Widget: ${result.rows[0].title} -->
<div id="vectra-event-${id}" 
     data-theme="light" 
     data-accent="#8b5cf6"
     data-width="100%" 
     data-height="500px">
</div>
<script src="${apiUrl}/embed/${id}/script.js" async></script>`;

        const snippetReact = `// React/Next.js Component
import { useEffect } from 'react';

export default function EventWidget() {
    useEffect(() => {
        const script = document.createElement('script');
        script.src = '${apiUrl}/embed/${id}/script.js';
        script.async = true;
        document.body.appendChild(script);
        return () => document.body.removeChild(script);
    }, []);

    return (
        <div id="vectra-event-${id}" 
             data-theme="light" 
             data-accent="#8b5cf6" />
    );
}`;

        return reply.send({
            event_id: id,
            title: result.rows[0].title,
            html: snippetHtml,
            react: snippetReact,
            options: {
                theme: ['light', 'dark'],
                accent: 'Any hex color (default: #8b5cf6)',
                width: 'CSS width (default: 100%)',
                height: 'CSS height (default: 500px)'
            }
        });
    } catch (err) {
        console.error('[API] Embed code error:', err.message);
        return reply.status(500).send({ error: 'Erreur serveur' });
    }
});

// POST public registration with Stripe checkout (no auth)
server.post('/public/events/:id/register', async (request, reply) => {
    const { id } = request.params;
    const { name, phone, email, company, role, tier_id, utm_source, utm_medium, utm_campaign, source, referrer } = request.body || {};

    if (!name || !phone) {
        return reply.status(400).send({ error: 'Nom et téléphone requis' });
    }

    try {
        // Get event with tenant info
        const eventResult = await pool.query(
            `SELECT e.*, t.id as tenant_id 
             FROM events e 
             JOIN tenants t ON e.tenant_id = t.id 
             WHERE e.id = $1 AND e.is_active = true`,
            [id]
        );

        if (eventResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Événement non trouvé' });
        }

        const event = eventResult.rows[0];
        let selectedTier = null;
        let finalPrice = parseFloat(event.price) || 0;
        let tierName = null;

        // If tier_id is provided, validate and use tier pricing
        if (tier_id) {
            const tierResult = await pool.query(
                `SELECT * FROM event_tiers WHERE id = $1 AND event_id = $2 AND is_active = true`,
                [tier_id, id]
            );

            if (tierResult.rows.length === 0) {
                return reply.status(400).send({ error: 'Tarif non disponible' });
            }

            selectedTier = tierResult.rows[0];

            // Check tier availability
            if (selectedTier.available_from && new Date(selectedTier.available_from) > new Date()) {
                return reply.status(400).send({ error: 'Ce tarif n\'est pas encore disponible' });
            }
            if (selectedTier.available_until && new Date(selectedTier.available_until) < new Date()) {
                return reply.status(400).send({ error: 'Ce tarif a expiré' });
            }
            if (selectedTier.capacity && selectedTier.sold_count >= selectedTier.capacity) {
                return reply.status(400).send({ error: 'Ce tarif est complet' });
            }

            finalPrice = parseFloat(selectedTier.price) || 0;
            tierName = selectedTier.name;
        }

        // Check event capacity
        if (event.sold_count >= event.capacity) {
            return reply.status(400).send({ error: 'Événement complet' });
        }

        // Validate company/role for pro events
        if (['SEMINAR', 'CONGRESS'].includes(event.event_type)) {
            if (!company || !role) {
                return reply.status(400).send({ error: 'Entreprise et fonction requises pour cet événement' });
            }
        }

        // Format phone
        let formattedPhone = phone.toString().replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '33' + formattedPhone.substring(1);
        }

        // Find or create contact
        let contactId = null;
        const existingContact = await pool.query(
            `SELECT id FROM contacts WHERE tenant_id = $1 AND wa_id = $2`,
            [event.tenant_id, formattedPhone]
        );

        if (existingContact.rows.length > 0) {
            contactId = existingContact.rows[0].id;
        } else {
            const newContact = await pool.query(
                `INSERT INTO contacts (tenant_id, wa_id, name) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (tenant_id, wa_id) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [event.tenant_id, formattedPhone, name]
            );
            contactId = newContact.rows[0].id;
        }

        // Generate QR code data
        const qr_code_data = `TICKET-${crypto.randomUUID()}`;

        // Determine source (UTM or referrer-based)
        const ticketSource = source || (utm_source ? `utm_${utm_source}` : 'direct');

        // Create ticket with PENDING_PAYMENT status + UTM tracking + tier info
        const ticketResult = await pool.query(
            `INSERT INTO tickets (event_id, contact_id, attendee_name, attendee_phone, attendee_email, attendee_company, attendee_role, qr_code_data, status, source, utm_source, utm_medium, utm_campaign, referrer, tier_id, tier_name, tier_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING_PAYMENT', $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING *`,
            [id, contactId, name, formattedPhone, email || null, company || null, role || null, qr_code_data, ticketSource, utm_source || null, utm_medium || null, utm_campaign || null, referrer || null, tier_id || null, tierName, finalPrice]
        );

        const ticket = ticketResult.rows[0];

        // If free (tier or event), mark as COMPLIMENTARY and trigger badge
        if (finalPrice === 0) {
            await pool.query(
                `UPDATE tickets SET status = 'COMPLIMENTARY' WHERE id = $1`,
                [ticket.id]
            );

            // Update tier sold_count if applicable
            if (tier_id) {
                await pool.query(
                    `UPDATE event_tiers SET sold_count = sold_count + 1 WHERE id = $1`,
                    [tier_id]
                );
            }

            // Queue badge sending
            await redisClient.lPush('marketing_queue', JSON.stringify({
                type: 'SEND_EVENT_BADGE',
                ticket_id: ticket.id,
                event_id: id,
                tenant_id: event.tenant_id,
                attendee_name: name,
                attendee_phone: formattedPhone,
                attendee_company: company || null,
                attendee_role: role || null,
                tier_name: tierName,
                created_at: new Date().toISOString()
            }));

            console.log(`[API] 🎟️ Free registration for ${name}${tierName ? ` (${tierName})` : ''} - Badge queued`);
            return reply.send({
                success: true,
                ticket_id: ticket.id,
                tier_name: tierName,
                status: 'COMPLIMENTARY',
                message: 'Inscription confirmée ! Votre badge arrive par WhatsApp.'
            });
        }

        // Paid event: Create Stripe Checkout Session
        const stripeConfig = await pool.query(
            `SELECT stripe_secret_key FROM billing_configs WHERE tenant_id = $1`,
            [event.tenant_id]
        );

        if (stripeConfig.rows.length === 0 || !stripeConfig.rows[0].stripe_secret_key) {
            return reply.status(500).send({ error: 'Configuration paiement manquante' });
        }

        const Stripe = require('stripe');
        const stripe = new Stripe(stripeConfig.rows[0].stripe_secret_key);

        const productName = tierName ? `${event.title} - ${tierName}` : event.title;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: (event.currency || 'EUR').toLowerCase(),
                    product_data: {
                        name: productName,
                        description: `Inscription - ${name}`,
                        images: event.image_url ? [event.image_url] : []
                    },
                    unit_amount: Math.round(finalPrice * 100)
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/e/${id}/success?ticket=${ticket.id}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/e/${id}?cancelled=true`,
            customer_email: email || undefined,
            metadata: {
                ticket_id: ticket.id.toString(),
                event_id: id.toString(),
                tenant_id: event.tenant_id,
                tier_id: tier_id ? tier_id.toString() : '',
                attendee_name: name,
                attendee_phone: formattedPhone
            }
        });

        console.log(`[API] 💳 Checkout created for ${name}${tierName ? ` (${tierName})` : ''} - ${finalPrice}€ - Ticket #${ticket.id}`);

        return reply.send({
            success: true,
            ticket_id: ticket.id,
            tier_name: tierName,
            price: finalPrice,
            checkout_url: session.url,
            session_id: session.id
        });

    } catch (err) {
        console.error('[API] ❌ Failed to register:', err.message);
        return reply.status(500).send({ error: 'Erreur inscription' });
    }
});

// Stripe Webhook for payment confirmation
server.post('/webhooks/stripe', {
    config: { rawBody: true }
}, async (request, reply) => {
    const sig = request.headers['stripe-signature'];

    try {
        // Get first tenant's stripe config for webhook secret
        const configResult = await pool.query(
            `SELECT stripe_secret_key, stripe_webhook_secret FROM billing_configs LIMIT 1`
        );

        if (configResult.rows.length === 0) {
            return reply.status(400).send({ error: 'No billing config' });
        }

        const { stripe_secret_key, stripe_webhook_secret } = configResult.rows[0];

        if (!stripe_webhook_secret) {
            console.log('[Webhook] ⚠️ No webhook secret configured, processing without verification');
        }

        const Stripe = require('stripe');
        const stripe = new Stripe(stripe_secret_key);

        let event;
        if (stripe_webhook_secret && sig) {
            event = stripe.webhooks.constructEvent(request.rawBody, sig, stripe_webhook_secret);
        } else {
            event = request.body;
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const { ticket_id, event_id, tenant_id, attendee_name, attendee_phone } = session.metadata || {};

            if (ticket_id) {
                // Update ticket to PAID
                await pool.query(
                    `UPDATE tickets SET status = 'PAID', stripe_session_id = $1 WHERE id = $2`,
                    [session.id, ticket_id]
                );

                // Get ticket details for badge
                const ticketResult = await pool.query(
                    `SELECT * FROM tickets WHERE id = $1`,
                    [ticket_id]
                );

                if (ticketResult.rows.length > 0) {
                    const ticket = ticketResult.rows[0];

                    // Queue badge sending
                    await redisClient.lPush('marketing_queue', JSON.stringify({
                        type: 'SEND_EVENT_BADGE',
                        ticket_id: parseInt(ticket_id),
                        event_id: parseInt(event_id),
                        tenant_id: tenant_id,
                        attendee_name: ticket.attendee_name,
                        attendee_phone: ticket.attendee_phone,
                        attendee_company: ticket.attendee_company,
                        attendee_role: ticket.attendee_role,
                        created_at: new Date().toISOString()
                    }));

                    console.log(`[Webhook] ✅ Payment confirmed for Ticket #${ticket_id} - Badge queued`);
                }

                // Increment sold count
                await pool.query(
                    `UPDATE events SET sold_count = sold_count + 1, updated_at = NOW() WHERE id = $1`,
                    [event_id]
                );
            }
        }

        return reply.send({ received: true });
    } catch (err) {
        console.error('[Webhook] ❌ Stripe webhook error:', err.message);
        return reply.status(400).send({ error: err.message });
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

        // ============================================
        // CAMPAIGN SCHEDULER (runs every minute)
        // ============================================
        setInterval(checkScheduledCampaigns, 60000); // Every minute
        console.log('[API] ⏰ Campaign scheduler started (checks every 60s)');
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

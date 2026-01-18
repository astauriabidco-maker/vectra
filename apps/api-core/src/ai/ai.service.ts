import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { RedisService } from '../redis/redis.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

// System prompt for Vectra AI Copilot
const SYSTEM_PROMPT = `You are a customer support agent for "Vectra", a premium CRM agency.

**Your Business Context:**
- Business Hours: Monday-Friday, 9am - 6pm. Closed on Weekends.
- Services: Custom CRM development, WhatsApp Automation, AI Chatbots.
- Tone: Professional, empathetic, concise, and helpful.
- Language: Reply in the same language as the customer (mostly French).

**Rules:**
1. Keep replies short (under 50 words) suitable for WhatsApp.
2. Never invent specific prices if you don't know them (ask to schedule a call instead).
3. Use emojis sparingly (1 or 2 max).
4. Base your reply on the conversation history provided below.
5. Reply with ONLY the suggested message text, no explanations or formatting.`;

@Injectable()
export class AiService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly integrationsService: IntegrationsService,
        private readonly redisService: RedisService,
    ) { }

    /**
     * Generate AI suggestion for a conversation based on recent messages
     */
    async generateSuggestion(conversationId: string, messageId: string): Promise<string | null> {
        try {
            // 1. Fetch conversation with workspaceId first
            const conversation = await this.prisma.conversation.findUnique({
                where: { id: conversationId },
                include: {
                    contact: {
                        include: {
                            identities: true,
                        },
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 10,
                    },
                },
            });

            if (!conversation || conversation.messages.length === 0) {
                console.log('⚠️ No conversation or messages found');
                return null;
            }

            // 2. Get Google Gemini API key from workspace integrations or env
            let apiKey: string | undefined;

            const googleIntegration = await this.integrationsService.getIntegration(
                conversation.workspaceId,
                'google'
            );

            if (googleIntegration?.enabled && googleIntegration.credentials.apiKey) {
                apiKey = googleIntegration.credentials.apiKey;
            } else {
                // Fallback to environment variable (support both naming conventions)
                apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            }

            if (!apiKey) {
                console.log('⚠️ Google Gemini API key not configured');
                return null;
            }

            // 3. Build conversation history for context
            const contactName = (conversation.contact.attributes as any)?.name || 'Client';
            const messagesHistory = conversation.messages
                .reverse()
                .map(msg => {
                    const role = msg.senderType === 'USER' ? `${contactName}` : 'Agent Vectra';
                    return `${role}: ${msg.contentText || '[media]'}`;
                })
                .join('\n');

            // 4. Construct final prompt with system context + conversation
            const fullPrompt = `${SYSTEM_PROMPT}

---
**Conversation History:**
${messagesHistory}
---

Based on this conversation, provide a helpful reply:`;

            // 5. Call Gemini API
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            const result = await model.generateContent(fullPrompt);
            const suggestion = result.response.text().trim();

            console.log(`✨ AI Suggestion generated: "${suggestion.substring(0, 50)}..."`);

            // 6. Update the message with suggestion
            await this.prisma.message.update({
                where: { id: messageId },
                data: { suggestedReply: suggestion },
            });

            // 7. Emit WebSocket event to notify frontend
            await this.redisService.publishEvent('vectra_events', {
                type: 'ai_suggestion',
                data: {
                    conversationId,
                    messageId,
                    suggestion,
                },
            });

            return suggestion;
        } catch (error) {
            console.error('❌ AI generation error:', error);
            return null;
        }
    }
}

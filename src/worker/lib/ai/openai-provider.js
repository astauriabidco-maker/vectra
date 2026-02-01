/**
 * OpenAI Provider
 * Implements AIProvider interface for OpenAI models (GPT-3.5, GPT-4)
 */

let OpenAI;
try {
    OpenAI = require('openai');
} catch (e) {
    console.log('[OpenAIProvider] openai not available - OpenAI disabled');
    OpenAI = null;
}
const { MODELS } = require('./types');

class OpenAIProvider {
    constructor() {
        this.name = 'OPENAI';
    }

    /**
     * Generate a response using OpenAI
     * @param {Array<{role: string, content: string}>} messages - Chat history
     * @param {string} systemPrompt - System instructions
     * @param {string} apiKey - OpenAI API key
     * @param {string} model - Model name (default: gpt-3.5-turbo)
     * @param {number} temperature - Creativity level (0.0-1.0)
     * @returns {Promise<string>} Generated response
     */
    async generateResponse(messages, systemPrompt, apiKey, model = MODELS.OPENAI.GPT35, temperature = 0.7) {
        if (!apiKey) {
            throw new Error('OpenAI API key is required');
        }

        const openai = new OpenAI({ apiKey });

        // Build messages array for OpenAI
        // OpenAI uses 'system', 'user', 'assistant' roles
        const openaiMessages = [];

        // Add system prompt first
        if (systemPrompt) {
            openaiMessages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        // Add conversation history
        messages.forEach(msg => {
            openaiMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });

        console.log('[OpenAIProvider] 🤖 Generating response...');
        const completion = await openai.chat.completions.create({
            model,
            messages: openaiMessages,
            max_tokens: 500,
            temperature
        });

        const response = completion.choices[0]?.message?.content || '';
        console.log('[OpenAIProvider] ✅ Response generated');
        return response.trim();
    }
}

module.exports = OpenAIProvider;

/**
 * Google Gemini AI Provider
 * Implements AIProvider interface for Google's Gemini models
 */

let GoogleGenerativeAI;
try {
    GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch (e) {
    console.log('[GeminiProvider] @google/generative-ai not available - Gemini disabled');
    GoogleGenerativeAI = null;
}
const { MODELS } = require('./types');

class GeminiProvider {
    constructor() {
        this.name = 'GEMINI';
    }

    /**
     * Generate a response using Gemini
     * @param {Array<{role: string, content: string}>} messages - Chat history
     * @param {string} systemPrompt - System instructions
     * @param {string} apiKey - Gemini API key
     * @param {string} model - Model name (default: gemini-2.0-flash)
     * @param {number} temperature - Creativity level (0.0-1.0)
     * @returns {Promise<string>} Generated response
     */
    async generateResponse(messages, systemPrompt, apiKey, model = MODELS.GEMINI.DEFAULT, temperature = 0.7) {
        if (!apiKey) {
            throw new Error('Gemini API key is required');
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const geminiModel = genAI.getGenerativeModel({
            model,
            generationConfig: {
                temperature: temperature
            }
        });

        // Build conversation history for Gemini
        // Gemini uses 'user' and 'model' roles
        const history = messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        // Create chat with system instruction (must be Content object)
        const chat = geminiModel.startChat({
            history: history.slice(0, -1), // All but last message
            systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined
        });

        // Get last user message
        const lastMessage = messages[messages.length - 1];
        const userMessage = lastMessage?.content || '';

        console.log('[GeminiProvider] 🤖 Generating response...');
        const result = await chat.sendMessage(userMessage);
        const response = result.response.text();

        console.log('[GeminiProvider] ✅ Response generated');
        return response.trim();
    }
}

module.exports = GeminiProvider;

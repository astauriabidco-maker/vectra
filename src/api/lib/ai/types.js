/**
 * AI Library - Types & Interfaces
 * Strategy Pattern for multi-provider AI
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'user' | 'assistant' | 'system'} role
 * @property {string} content
 */

/**
 * @typedef {Object} AIProvider
 * @property {function(ChatMessage[], string, string): Promise<string>} generateResponse
 */

module.exports = {
    // Type definitions for JSDoc
    PROVIDERS: {
        GEMINI: 'GEMINI',
        OPENAI: 'OPENAI'
    },
    MODELS: {
        GEMINI: {
            DEFAULT: 'gemini-2.0-flash',
            PRO: 'gemini-pro'
        },
        OPENAI: {
            GPT35: 'gpt-3.5-turbo',
            GPT4: 'gpt-4',
            GPT4O: 'gpt-4o'
        }
    }
};

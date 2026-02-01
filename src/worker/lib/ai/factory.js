/**
 * AI Factory
 * Returns the appropriate AI provider based on configuration
 */

const GeminiProvider = require('./gemini-provider');
const OpenAIProvider = require('./openai-provider');
const { PROVIDERS } = require('./types');

class AIFactory {
    static providers = {
        [PROVIDERS.GEMINI]: new GeminiProvider(),
        [PROVIDERS.OPENAI]: new OpenAIProvider()
    };

    /**
     * Get the appropriate AI provider
     * @param {string} providerName - 'GEMINI' or 'OPENAI'
     * @returns {GeminiProvider|OpenAIProvider} The provider instance
     */
    static getProvider(providerName) {
        const provider = this.providers[providerName?.toUpperCase()];

        if (!provider) {
            console.warn(`[AIFactory] ⚠️ Unknown provider: ${providerName}, defaulting to GEMINI`);
            return this.providers[PROVIDERS.GEMINI];
        }

        return provider;
    }

    /**
     * Generate a response using the specified provider
     * @param {Object} config - AI configuration
     * @param {string} config.provider - Provider name
     * @param {string} config.api_key - API key
     * @param {string} config.model - Model name
     * @param {string} config.system_prompt - System prompt
     * @param {number} config.creativity_level - Temperature (0.0-1.0)
     * @param {Array<{role: string, content: string}>} messages - Chat messages
     * @returns {Promise<string>} Generated response
     */
    static async generate(config, messages) {
        const provider = this.getProvider(config.provider);
        const temperature = config.creativity_level ?? 0.7;

        return provider.generateResponse(
            messages,
            config.system_prompt,
            config.api_key,
            config.model,
            temperature
        );
    }
}

module.exports = AIFactory;

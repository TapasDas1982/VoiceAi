/**
 * Simplified Configuration Management
 * Single responsibility: Centralize all application configuration
 */

const fs = require('fs');
const path = require('path');

class Config {
    constructor() {
        this.config = {};
        this.envLoaded = false;
        this.loadConfiguration();
    }

    /**
     * Load configuration from environment and files
     */
    loadConfiguration() {
        try {
            // Load .env file if exists
            this.loadEnvFile();
            
            // Build configuration object
            this.config = {
                // Server Configuration
                server: {
                    port: this.getEnvValue('PORT', 3000),
                    host: this.getEnvValue('HOST', 'localhost')
                },
                
                // SIP Configuration
                sip: {
                    serverHost: this.getEnvValue('SIP_SERVER', '122.163.120.156:5060').split(':')[0],
                    serverPort: parseInt(this.getEnvValue('SIP_SERVER', '122.163.120.156:5060').split(':')[1]) || 5060,
                    localHost: this.getEnvValue('SIP_LOCAL_HOST', 'localhost'),
                    localPort: this.getEnvValue('SIP_CLIENT_PORT', 5061),
                    extension: this.getEnvValue('SIP_AUTHORIZATION_USER', '31'),
                    password: this.getEnvValue('SIP_PASSWORD', ''),
                    domain: this.getEnvValue('SIP_DOMAIN', this.getEnvValue('SIP_SERVER', '122.163.120.156:5060').split(':')[0])
                },
                
                // RTP/Audio Configuration
                audio: {
                    rtpPort: this.getEnvValue('RTP_PORT', 5004),
                    sampleRate: this.getEnvValue('AUDIO_SAMPLE_RATE', 8000),
                    channels: this.getEnvValue('AUDIO_CHANNELS', 1),
                    bitDepth: this.getEnvValue('AUDIO_BIT_DEPTH', 16),
                    codecPreference: this.getEnvValue('AUDIO_CODEC', 'PCM16')
                },
                
                // OpenAI Configuration
                openai: {
                    apiKey: this.getEnvValue('OPENAI_API_KEY', ''),
                    model: this.getEnvValue('OPENAI_MODEL', 'gpt-4o-realtime-preview-2024-10-01'),
                    voice: this.getEnvValue('OPENAI_VOICE', 'alloy'),
                    instructions: this.getEnvValue('AI_INSTRUCTIONS', 'You are a helpful voice assistant.'),
                    maxTokens: this.getEnvValue('OPENAI_MAX_TOKENS', 4096),
                    temperature: this.getEnvValue('OPENAI_TEMPERATURE', 0.7)
                },
                
                // Application Behavior
                app: {
                    logLevel: this.getEnvValue('LOG_LEVEL', 'info'),
                    enableDashboard: this.getEnvValue('ENABLE_DASHBOARD', true),
                    enableMetrics: this.getEnvValue('ENABLE_METRICS', true),
                    autoReconnect: this.getEnvValue('AUTO_RECONNECT', true),
                    maxReconnectAttempts: this.getEnvValue('MAX_RECONNECT_ATTEMPTS', 10),
                    reconnectDelay: this.getEnvValue('RECONNECT_DELAY', 1000)
                },
                
                // Security Configuration
                security: {
                    enableAuth: this.getEnvValue('ENABLE_AUTH', false),
                    authToken: this.getEnvValue('AUTH_TOKEN', ''),
                    allowedIPs: this.getEnvValue('ALLOWED_IPS', '').split(',').filter(ip => ip.trim()),
                    enableSSL: this.getEnvValue('ENABLE_SSL', false),
                    sslCert: this.getEnvValue('SSL_CERT_PATH', ''),
                    sslKey: this.getEnvValue('SSL_KEY_PATH', '')
                }
            };
            
            console.log('✅ Configuration loaded successfully');
            this.validateConfiguration();
            
        } catch (error) {
            console.error('❌ Configuration loading failed:', error.message);
            throw error;
        }
    }

    /**
     * Load .env file
     */
    loadEnvFile() {
        const envPath = path.join(process.cwd(), '.env');
        
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const lines = envContent.split('\n');
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    if (key && valueParts.length > 0) {
                        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                        process.env[key.trim()] = value;
                    }
                }
            }
            
            this.envLoaded = true;
            console.log('📄 Environment file loaded');
        } else {
            console.log('⚠️ No .env file found, using environment variables and defaults');
        }
    }

    /**
     * Get environment value with type conversion and defaults
     */
    getEnvValue(key, defaultValue) {
        const value = process.env[key];
        
        if (value === undefined || value === '') {
            return defaultValue;
        }
        
        // Type conversion based on default value type
        if (typeof defaultValue === 'boolean') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        
        if (typeof defaultValue === 'number') {
            const numValue = Number(value);
            return isNaN(numValue) ? defaultValue : numValue;
        }
        
        return value;
    }

    /**
     * Validate configuration
     */
    validateConfiguration() {
        const errors = [];
        
        // Validate required SIP settings
        if (!this.config.sip.extension) {
            errors.push('SIP extension is required');
        }
        
        if (!this.config.sip.serverHost) {
            errors.push('SIP server host is required');
        }
        
        // Validate port ranges
        if (this.config.sip.localPort < 1024 || this.config.sip.localPort > 65535) {
            errors.push('SIP local port must be between 1024 and 65535');
        }
        
        if (this.config.audio.rtpPort < 1024 || this.config.audio.rtpPort > 65535) {
            errors.push('RTP port must be between 1024 and 65535');
        }
        
        // Validate OpenAI settings if provided
        if (this.config.openai.apiKey && !this.config.openai.apiKey.startsWith('sk-')) {
            console.warn('⚠️ OpenAI API key format may be invalid');
        }
        
        // Validate SSL settings if enabled
        if (this.config.security.enableSSL) {
            if (!fs.existsSync(this.config.security.sslCert)) {
                errors.push('SSL certificate file not found');
            }
            if (!fs.existsSync(this.config.security.sslKey)) {
                errors.push('SSL key file not found');
            }
        }
        
        if (errors.length > 0) {
            console.error('❌ Configuration validation errors:');
            errors.forEach(error => console.error(`  - ${error}`));
            throw new Error('Configuration validation failed');
        }
        
        console.log('✅ Configuration validation passed');
    }

    /**
     * Get configuration section
     */
    get(section) {
        if (section) {
            return this.config[section];
        }
        return this.config;
    }

    /**
     * Get specific configuration value
     */
    getValue(path) {
        const parts = path.split('.');
        let value = this.config;
        
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return undefined;
            }
        }
        
        return value;
    }

    /**
     * Check if feature is enabled
     */
    isEnabled(feature) {
        switch (feature) {
            case 'openai':
                return !!this.config.openai.apiKey;
            case 'dashboard':
                return this.config.app.enableDashboard;
            case 'metrics':
                return this.config.app.enableMetrics;
            case 'auth':
                return this.config.security.enableAuth;
            case 'ssl':
                return this.config.security.enableSSL;
            default:
                return false;
        }
    }

    /**
     * Get SIP configuration for SIP client
     */
    getSIPConfig() {
        return {
            serverHost: this.config.sip.serverHost,
            serverPort: this.config.sip.serverPort,
            localHost: this.config.sip.localHost,
            localPort: this.config.sip.localPort,
            extension: this.config.sip.extension,
            password: this.config.sip.password,
            domain: this.config.sip.domain
        };
    }

    /**
     * Get AI configuration for AI processor
     */
    getAIConfig() {
        return {
            openaiApiKey: this.config.openai.apiKey,
            aiModel: this.config.openai.model,
            aiVoice: this.config.openai.voice,
            aiInstructions: this.config.openai.instructions,
            maxTokens: this.config.openai.maxTokens,
            temperature: this.config.openai.temperature,
            autoReconnect: this.config.app.autoReconnect,
            maxReconnectAttempts: this.config.app.maxReconnectAttempts,
            reconnectDelay: this.config.app.reconnectDelay
        };
    }

    /**
     * Get audio configuration for audio handler
     */
    getAudioConfig() {
        return {
            rtpPort: this.config.audio.rtpPort,
            sampleRate: this.config.audio.sampleRate,
            channels: this.config.audio.channels,
            bitDepth: this.config.audio.bitDepth,
            codecPreference: this.config.audio.codecPreference
        };
    }

    /**
     * Print configuration summary (without sensitive data)
     */
    printSummary() {
        console.log('\n📋 Configuration Summary:');
        console.log(`  Server: ${this.config.server.host}:${this.config.server.port}`);
        console.log(`  SIP: ${this.config.sip.extension}@${this.config.sip.serverHost}:${this.config.sip.serverPort}`);
        console.log(`  RTP Port: ${this.config.audio.rtpPort}`);
        console.log(`  OpenAI: ${this.isEnabled('openai') ? 'Enabled' : 'Disabled'}`);
        console.log(`  Dashboard: ${this.isEnabled('dashboard') ? 'Enabled' : 'Disabled'}`);
        console.log(`  SSL: ${this.isEnabled('ssl') ? 'Enabled' : 'Disabled'}`);
        console.log('');
    }

    /**
     * Reload configuration
     */
    reload() {
        console.log('🔄 Reloading configuration...');
        this.loadConfiguration();
    }
}

// Export singleton instance
module.exports = new Config();
import dotenv from 'dotenv';
import winston from 'winston';

// Load environment variables
dotenv.config();

/**
 * Configuration management for LiveKit Agents VoiceAI system
 */
class Config {
  constructor() {
    this.validateEnvironment();
    this.setupLogging();
  }

  /**
   * LiveKit server configuration
   */
  get livekit() {
    return {
      url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
      apiKey: process.env.LIVEKIT_API_KEY || '',
      apiSecret: process.env.LIVEKIT_API_SECRET || '',
      room: process.env.LIVEKIT_ROOM || 'voice-ai-room'
    };
  }

  /**
   * OpenAI configuration
   */
  get openai() {
    return {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      voice: process.env.OPENAI_VOICE || 'alloy',
      instructions: process.env.AI_INSTRUCTIONS || 
        'You are a friendly and professional voice assistant. When a caller connects, greet them warmly and ask how you can help them today. Keep your responses conversational, helpful, and concise. Always speak in a natural, human-like manner suitable for voice conversation.',
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 4096,
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7
    };
  }

  /**
   * Audio processing configuration
   */
  get audio() {
    return {
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
      channels: parseInt(process.env.AUDIO_CHANNELS) || 1,
      bitDepth: parseInt(process.env.AUDIO_BIT_DEPTH) || 16,
      vadSensitivity: parseFloat(process.env.VAD_SENSITIVITY) || 0.5,
      enableEchoCancellation: process.env.ENABLE_ECHO_CANCELLATION !== 'false',
      enableNoiseSuppression: process.env.ENABLE_NOISE_SUPPRESSION !== 'false',
      enableAutoGainControl: process.env.ENABLE_AUTO_GAIN_CONTROL !== 'false'
    };
  }

  /**
   * Agent behavior configuration
   */
  get agent() {
    return {
      name: process.env.AGENT_NAME || 'VoiceAI Assistant',
      enableGreeting: process.env.ENABLE_GREETING !== 'false',
      greetingMessage: process.env.GREETING_MESSAGE || 
        "Hello! I'm your AI voice assistant. How can I help you today?",
      maxSessionDuration: parseInt(process.env.MAX_SESSION_DURATION) || 3600000, // 1 hour
      enableTranscription: process.env.ENABLE_TRANSCRIPTION !== 'false',
      enableFunctionCalling: process.env.ENABLE_FUNCTION_CALLING === 'true'
    };
  }

  /**
   * Logging configuration
   */
  get logging() {
    return {
      level: process.env.LOG_LEVEL || 'info',
      enableFileLogging: process.env.ENABLE_FILE_LOGGING !== 'false',
      logFile: process.env.LOG_FILE || 'voiceai-agent.log',
      enableConsoleLogging: process.env.ENABLE_CONSOLE_LOGGING !== 'false'
    };
  }

  /**
   * Server configuration for dashboard/monitoring
   */
  get server() {
    return {
      port: parseInt(process.env.PORT) || 3000,
      host: process.env.HOST || 'localhost',
      enableDashboard: process.env.ENABLE_DASHBOARD !== 'false',
      enableMetrics: process.env.ENABLE_METRICS !== 'false'
    };
  }

  /**
   * Telephony integration configuration (for SIP bridge if needed)
   */
  get telephony() {
    return {
      enableSipBridge: process.env.ENABLE_SIP_BRIDGE === 'true',
      sipServerUrl: process.env.SIP_SERVER_URL || '',
      sipUsername: process.env.SIP_AUTHORIZATION_USER || process.env.SIP_USERNAME || '',
      sipPassword: process.env.SIP_PASSWORD || ''
    };
  }

  /**
   * Validate required environment variables
   */
  validateEnvironment() {
    const required = [
      'LIVEKIT_URL',
      'LIVEKIT_API_KEY', 
      'LIVEKIT_API_SECRET',
      'OPENAI_API_KEY'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:');
      missing.forEach(key => console.error(`  - ${key}`));
      console.error('\nPlease check your .env file and ensure all required variables are set.');
      process.exit(1);
    }

    // Validate OpenAI API key format
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-')) {
      console.warn('⚠️  OpenAI API key format may be invalid (should start with "sk-")');
    }

    console.log('✅ Environment validation passed');
  }

  /**
   * Setup logging configuration
   */
  setupLogging() {
    const transports = [];
    
    if (this.logging.enableConsoleLogging) {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }
    
    if (this.logging.enableFileLogging) {
      transports.push(new winston.transports.File({
        filename: this.logging.logFile,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      }));
    }

    // Configure global logger
    winston.configure({
      level: this.logging.level,
      transports
    });
  }

  /**
   * Print configuration summary
   */
  printSummary() {
    console.log('\n🔧 VoiceAI LiveKit Agents Configuration:');
    console.log(`   LiveKit URL: ${this.livekit.url}`);
    console.log(`   OpenAI Model: ${this.openai.model}`);
    console.log(`   OpenAI Voice: ${this.openai.voice}`);
    console.log(`   Agent Name: ${this.agent.name}`);
    console.log(`   Audio Sample Rate: ${this.audio.sampleRate}Hz`);
    console.log(`   Log Level: ${this.logging.level}`);
    console.log(`   Dashboard: ${this.server.enableDashboard ? 'Enabled' : 'Disabled'}`);
    console.log(`   SIP Bridge: ${this.telephony.enableSipBridge ? 'Enabled' : 'Disabled'}`);
    console.log('');
  }

  /**
   * Get all configuration as object
   */
  getAll() {
    return {
      livekit: this.livekit,
      openai: this.openai,
      audio: this.audio,
      agent: this.agent,
      logging: this.logging,
      server: this.server,
      telephony: this.telephony
    };
  }
}

// Create and export singleton instance
const config = new Config();
export default config;
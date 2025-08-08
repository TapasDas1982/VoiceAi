/**
 * Simplified AI Processor - OpenAI Integration Only
 * Single responsibility: Handle AI conversation and audio processing
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class AIProcessor extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        
        // Simple state tracking
        this.conversationActive = false;
        this.audioBuffer = [];
    }

    /**
     * Start AI processor and connect to OpenAI
     */
    async start() {
        if (!this.config.openaiApiKey) {
            console.log('⚠️ OpenAI API key not provided - AI features disabled');
            return false;
        }

        try {
            await this.connect();
            console.log('✅ AI Processor started successfully');
            return true;
        } catch (error) {
            console.error('❌ AI Processor start failed:', error.message);
            return false;
        }
    }

    /**
     * Connect to OpenAI Realtime API
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
            
            this.ws = new WebSocket(url, {
                headers: {
                    'Authorization': `Bearer ${this.config.openaiApiKey}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            this.ws.on('open', () => {
                console.log('🤖 Connected to OpenAI Realtime API');
                this.connected = true;
                this.reconnectAttempts = 0;
                this.initializeSession();
                resolve();
            });

            this.ws.on('message', (data) => {
                this.handleAIMessage(data);
            });

            this.ws.on('error', (error) => {
                console.error('🤖 OpenAI WebSocket error:', error.message);
                this.connected = false;
                
                if (this.reconnectAttempts === 0) {
                    reject(error);
                } else {
                    this.scheduleReconnect();
                }
            });

            this.ws.on('close', (code, reason) => {
                console.log(`🤖 OpenAI connection closed: ${code} ${reason}`);
                this.connected = false;
                
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.scheduleReconnect();
                }
            });

            // Connection timeout
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Connection timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Initialize OpenAI session
     */
    initializeSession() {
        const sessionConfig = {
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: this.config.aiInstructions || 'You are a helpful voice assistant.',
                voice: this.config.aiVoice || 'alloy',
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 200
                }
            }
        };

        this.sendToAI(sessionConfig);
    }

    /**
     * Handle incoming AI messages
     */
    handleAIMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'session.created':
                    console.log('🤖 AI session created');
                    this.emit('sessionReady');
                    break;
                    
                case 'session.updated':
                    console.log('🤖 AI session updated');
                    break;
                    
                case 'conversation.item.created':
                    this.handleConversationItem(message);
                    break;
                    
                case 'response.audio.delta':
                    this.handleAudioResponse(message);
                    break;
                    
                case 'response.audio.done':
                    this.handleAudioComplete(message);
                    break;
                    
                case 'response.text.delta':
                    this.handleTextResponse(message);
                    break;
                    
                case 'error':
                    console.error('🤖 AI Error:', message.error);
                    this.emit('aiError', message.error);
                    break;
                    
                default:
                    console.log(`🤖 Unhandled AI message type: ${message.type}`);
            }
        } catch (error) {
            console.error('Error parsing AI message:', error);
        }
    }

    /**
     * Handle conversation items
     */
    handleConversationItem(message) {
        console.log('🤖 Conversation item created');
        this.emit('conversationItem', message.item);
    }

    /**
     * Handle audio response chunks
     */
    handleAudioResponse(message) {
        if (message.delta) {
            // Convert base64 audio to buffer
            const audioChunk = Buffer.from(message.delta, 'base64');
            this.audioBuffer.push(audioChunk);
            this.emit('audioChunk', audioChunk);
        }
    }

    /**
     * Handle complete audio response
     */
    handleAudioComplete(message) {
        console.log('🤖 Audio response complete');
        
        if (this.audioBuffer.length > 0) {
            const completeAudio = Buffer.concat(this.audioBuffer);
            this.audioBuffer = [];
            this.emit('audioComplete', completeAudio);
        }
    }

    /**
     * Handle text response
     */
    handleTextResponse(message) {
        if (message.delta) {
            this.emit('textResponse', message.delta);
        }
    }

    /**
     * Start conversation for incoming call
     */
    startConversation(callId) {
        if (!this.connected) {
            console.log('⚠️ AI not connected - conversation cannot start');
            return false;
        }

        this.conversationActive = true;
        
        // Create conversation
        const createConversation = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: 'Hello, I\'m calling. Please respond.'
                }]
            }
        };

        this.sendToAI(createConversation);
        
        // Request response
        this.sendToAI({ type: 'response.create' });
        
        this.emit('conversationStarted', callId);
        return true;
    }

    /**
     * Send audio data to AI
     */
    sendAudio(audioData) {
        if (!this.connected || !this.conversationActive) {
            return false;
        }

        const audioMessage = {
            type: 'input_audio_buffer.append',
            audio: audioData.toString('base64')
        };

        this.sendToAI(audioMessage);
        return true;
    }

    /**
     * Send text to AI
     */
    sendText(text) {
        if (!this.connected || !this.conversationActive) {
            return false;
        }

        const textMessage = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: text
                }]
            }
        };

        this.sendToAI(textMessage);
        this.sendToAI({ type: 'response.create' });
        return true;
    }

    /**
     * End conversation
     */
    endConversation(callId) {
        this.conversationActive = false;
        this.audioBuffer = [];
        this.emit('conversationEnded', callId);
        console.log('🤖 Conversation ended');
    }

    /**
     * Send message to AI
     */
    sendToAI(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    /**
     * Schedule reconnection
     */
    scheduleReconnect() {
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            console.log(`🤖 Reconnecting to OpenAI (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            setTimeout(() => {
                this.connect().catch(error => {
                    console.error('🤖 Reconnection failed:', error.message);
                });
            }, this.reconnectDelay);
            
            // Exponential backoff
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        } else {
            console.error('🤖 Max reconnection attempts reached');
            this.emit('maxReconnectReached');
        }
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            connected: this.connected,
            conversationActive: this.conversationActive,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    /**
     * Stop AI processor
     */
    stop() {
        this.conversationActive = false;
        this.audioBuffer = [];
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.connected = false;
        console.log('🤖 AI Processor stopped');
    }
}

module.exports = AIProcessor;
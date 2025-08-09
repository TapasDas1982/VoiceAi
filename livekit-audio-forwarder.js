import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { AccessToken } from 'livekit-server-sdk';

/**
 * LiveKit Audio Forwarder - Streams audio from RTP to LiveKit rooms
 * Handles bidirectional audio between SIP calls and LiveKit AI agents
 */
class LiveKitAudioForwarder extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            livekitUrl: config.livekitUrl || process.env.LIVEKIT_URL,
            livekitApiKey: config.livekitApiKey || process.env.LIVEKIT_API_KEY,
            livekitApiSecret: config.livekitApiSecret || process.env.LIVEKIT_API_SECRET,
            sampleRate: config.sampleRate || 8000, // G.711 sample rate
            channels: config.channels || 1, // Mono
            ...config
        };
        
        this.activeConnections = new Map(); // callId -> connection info
        this.audioBuffers = new Map(); // callId -> audio buffer
        
        console.log(`[LiveKitAudioForwarder] Initialized with LiveKit URL: ${this.config.livekitUrl}`);
    }
    
    /**
     * Create audio connection for a call
     */
    async createAudioConnection(callId, roomName, participantToken) {
        try {
            console.log(`[LiveKitAudioForwarder] 🔗 Creating audio connection for call ${callId} -> room ${roomName}`);
            
            // Create WebSocket connection to LiveKit
            const wsUrl = this.config.livekitUrl.replace('http', 'ws') + '/rtc';
            const ws = new WebSocket(wsUrl, {
                headers: {
                    'Authorization': `Bearer ${participantToken}`
                }
            });
            
            const connection = {
                callId,
                roomName,
                ws,
                participantToken,
                isConnected: false,
                audioQueue: [],
                createdAt: new Date(),
                packetsForwarded: 0,
                bytesForwarded: 0
            };
            
            // Set up WebSocket event handlers
            ws.on('open', () => {
                console.log(`[LiveKitAudioForwarder] ✅ WebSocket connected for call ${callId}`);
                connection.isConnected = true;
                this.initializeAudioTrack(connection);
                this.emit('connected', { callId, roomName });
            });
            
            ws.on('message', (data) => {
                this.handleLiveKitMessage(connection, data);
            });
            
            ws.on('error', (error) => {
                console.error(`[LiveKitAudioForwarder] WebSocket error for call ${callId}:`, error);
                this.emit('error', { callId, error });
            });
            
            ws.on('close', () => {
                console.log(`[LiveKitAudioForwarder] WebSocket closed for call ${callId}`);
                connection.isConnected = false;
                this.activeConnections.delete(callId);
                this.emit('disconnected', { callId, roomName });
            });
            
            this.activeConnections.set(callId, connection);
            
            // Initialize audio buffer for this call
            this.audioBuffers.set(callId, []);
            
            return connection;
            
        } catch (error) {
            console.error(`[LiveKitAudioForwarder] Error creating audio connection for call ${callId}:`, error);
            throw error;
        }
    }
    
    /**
     * Initialize audio track for LiveKit
     */
    async initializeAudioTrack(connection) {
        try {
            // Send join request
            const joinMessage = {
                case: 'join',
                join: {
                    room: connection.roomName,
                    participant: {
                        identity: `sip-caller-${connection.callId}`,
                        name: `SIP Caller ${connection.callId}`,
                        metadata: JSON.stringify({
                            source: 'sip',
                            callId: connection.callId
                        })
                    },
                    autoSubscribe: true,
                    publishOnly: false
                }
            };
            
            this.sendLiveKitMessage(connection, joinMessage);
            
            // Prepare audio track configuration
            const audioTrackConfig = {
                case: 'addTrack',
                addTrack: {
                    cid: `audio-${connection.callId}`,
                    name: 'sip-audio',
                    type: 'AUDIO',
                    source: 'MICROPHONE',
                    disableDtx: false,
                    encryption: 'NONE'
                }
            };
            
            // Send after a short delay to ensure join is processed
            setTimeout(() => {
                this.sendLiveKitMessage(connection, audioTrackConfig);
                console.log(`[LiveKitAudioForwarder] 🎤 Audio track initialized for call ${connection.callId}`);
            }, 100);
            
        } catch (error) {
            console.error(`[LiveKitAudioForwarder] Error initializing audio track:`, error);
        }
    }
    
    /**
     * Forward audio data to LiveKit
     */
    forwardAudioToLiveKit(callId, pcmData, timestamp) {
        const connection = this.activeConnections.get(callId);
        
        if (!connection || !connection.isConnected) {
            console.warn(`[LiveKitAudioForwarder] No active connection for call ${callId}`);
            return;
        }
        
        try {
            // Convert PCM to WebRTC audio format
            const audioFrame = this.createAudioFrame(pcmData, timestamp);
            
            // Send audio frame to LiveKit
            const audioMessage = {
                case: 'audioFrame',
                audioFrame: {
                    trackId: `audio-${callId}`,
                    data: audioFrame,
                    timestamp: timestamp,
                    sampleRate: this.config.sampleRate,
                    channels: this.config.channels
                }
            };
            
            this.sendLiveKitMessage(connection, audioMessage);
            
            // Update statistics
            connection.packetsForwarded++;
            connection.bytesForwarded += pcmData.length * 2; // 16-bit samples
            
            console.log(`[LiveKitAudioForwarder] 🎵 Audio forwarded to LiveKit: ${pcmData.length} samples, call ${callId}`);
            
        } catch (error) {
            console.error(`[LiveKitAudioForwarder] Error forwarding audio for call ${callId}:`, error);
        }
    }
    
    /**
     * Create audio frame from PCM data
     */
    createAudioFrame(pcmData, timestamp) {
        // Convert Int16Array to Buffer for WebRTC
        const buffer = Buffer.alloc(pcmData.length * 2);
        
        for (let i = 0; i < pcmData.length; i++) {
            buffer.writeInt16LE(pcmData[i], i * 2);
        }
        
        return buffer;
    }
    
    /**
     * Handle incoming messages from LiveKit
     */
    handleLiveKitMessage(connection, data) {
        try {
            // Check if data is binary (audio data) or text (JSON messages)
            if (Buffer.isBuffer(data)) {
                // Handle binary audio data
                this.handleIncomingAudioData(connection, data);
                return;
            }
            
            // Try to parse as JSON for text messages
            let message;
            try {
                const dataStr = data.toString();
                // Skip if data looks like binary (contains non-printable characters)
                if (!/^[\x20-\x7E\s]*$/.test(dataStr)) {
                    console.log(`[LiveKitAudioForwarder] Received binary data for call ${connection.callId}`);
                    return;
                }
                message = JSON.parse(dataStr);
            } catch (parseError) {
                console.log(`[LiveKitAudioForwarder] Received non-JSON data for call ${connection.callId}`);
                return;
            }
            
            switch (message.case) {
                case 'joinResponse':
                    console.log(`[LiveKitAudioForwarder] ✅ Joined LiveKit room: ${connection.roomName}`);
                    break;
                    
                case 'trackPublished':
                    console.log(`[LiveKitAudioForwarder] 🎤 Audio track published for call ${connection.callId}`);
                    break;
                    
                case 'audioFrame':
                    // Handle incoming audio from LiveKit (AI agent response)
                    this.handleIncomingAudio(connection, message.audioFrame);
                    break;
                    
                case 'participantUpdate':
                    console.log(`[LiveKitAudioForwarder] 👤 Participant update in room ${connection.roomName}`);
                    break;
                    
                default:
                    console.log(`[LiveKitAudioForwarder] Received message: ${message.case}`);
            }
            
        } catch (error) {
            console.error(`[LiveKitAudioForwarder] Error handling LiveKit message:`, error);
        }
    }
    
    /**
     * Handle incoming binary audio data from LiveKit
     */
    handleIncomingAudioData(connection, binaryData) {
        try {
            console.log(`[LiveKitAudioForwarder] 🎵 Received binary audio data for call ${connection.callId}, size: ${binaryData.length} bytes`);
            
            // Forward binary audio data to RTP media bridge if needed
            if (this.rtpMediaBridge) {
                this.rtpMediaBridge.forwardAudioToSIP(connection.callId, binaryData);
            }
            
        } catch (error) {
            console.error(`[LiveKitAudioForwarder] Error handling binary audio data:`, error);
        }
    }
    
    /**
     * Handle incoming audio from LiveKit (AI agent)
     */
    handleIncomingAudio(connection, audioFrame) {
        try {
            // Convert WebRTC audio back to G.711 for SIP
            const pcmData = new Int16Array(audioFrame.data.buffer);
            const g711Data = this.convertPCMToG711(pcmData, 'PCMU'); // Default to μ-law
            
            // Emit audio for RTP transmission back to SIP
            this.emit('audioFromLiveKit', {
                callId: connection.callId,
                g711Data,
                timestamp: audioFrame.timestamp,
                codec: 'PCMU'
            });
            
            console.log(`[LiveKitAudioForwarder] 🔊 Audio received from LiveKit: ${pcmData.length} samples, call ${connection.callId}`);
            
        } catch (error) {
            console.error(`[LiveKitAudioForwarder] Error handling incoming audio:`, error);
        }
    }
    
    /**
     * Convert PCM to G.711 (for outbound audio to SIP)
     */
    convertPCMToG711(pcmData, codec) {
        const g711Data = new Uint8Array(pcmData.length);
        
        for (let i = 0; i < pcmData.length; i++) {
            if (codec === 'PCMU') {
                g711Data[i] = this.linearToMulaw(pcmData[i]);
            } else if (codec === 'PCMA') {
                g711Data[i] = this.linearToAlaw(pcmData[i]);
            }
        }
        
        return g711Data;
    }
    
    /**
     * Linear PCM to μ-law conversion
     */
    linearToMulaw(sample) {
        const BIAS = 0x84;
        const CLIP = 32635;
        
        if (sample >= 0) {
            sample += BIAS;
            if (sample > CLIP) sample = CLIP;
        } else {
            sample = -sample + BIAS;
            if (sample > CLIP) sample = CLIP;
            sample |= 0x8000;
        }
        
        let exponent = 7;
        let mantissa = (sample >> (exponent + 3)) & 0x0F;
        
        for (let i = 0; i < 8; i++) {
            if (sample <= (0x1F << (exponent + 3))) {
                break;
            }
            exponent--;
        }
        
        mantissa = (sample >> (exponent + 3)) & 0x0F;
        const mulaw = ~((exponent << 4) | mantissa);
        
        return mulaw & 0xFF;
    }
    
    /**
     * Linear PCM to A-law conversion
     */
    linearToAlaw(sample) {
        const sign = (sample < 0) ? 0x80 : 0x00;
        if (sample < 0) sample = -sample;
        
        if (sample >= 32635) sample = 32635;
        
        let exponent = 7;
        for (let i = 0; i < 8; i++) {
            if (sample <= (0x0F << (exponent + 3))) {
                break;
            }
            exponent--;
        }
        
        const mantissa = (sample >> (exponent + 3)) & 0x0F;
        const alaw = sign | (exponent << 4) | mantissa;
        
        return alaw ^ 0x55;
    }
    
    /**
     * Send message to LiveKit
     */
    sendLiveKitMessage(connection, message) {
        if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify(message));
        } else {
            console.warn(`[LiveKitAudioForwarder] Cannot send message, WebSocket not ready for call ${connection.callId}`);
        }
    }
    
    /**
     * Remove audio connection
     */
    async removeAudioConnection(callId) {
        const connection = this.activeConnections.get(callId);
        
        if (connection) {
            console.log(`[LiveKitAudioForwarder] 🔌 Removing audio connection for call ${callId}`);
            
            // Send leave message
            if (connection.isConnected) {
                const leaveMessage = {
                    case: 'leave',
                    leave: {}
                };
                this.sendLiveKitMessage(connection, leaveMessage);
            }
            
            // Close WebSocket
            if (connection.ws) {
                connection.ws.close();
            }
            
            // Clean up
            this.activeConnections.delete(callId);
            this.audioBuffers.delete(callId);
            
            console.log(`[LiveKitAudioForwarder] Connection stats: ${connection.packetsForwarded} packets, ${connection.bytesForwarded} bytes`);
        }
    }
    
    /**
     * Get forwarder statistics
     */
    getStats() {
        return {
            activeConnections: this.activeConnections.size,
            connections: Array.from(this.activeConnections.values()).map(conn => ({
                callId: conn.callId,
                roomName: conn.roomName,
                isConnected: conn.isConnected,
                packetsForwarded: conn.packetsForwarded,
                bytesForwarded: conn.bytesForwarded,
                duration: Date.now() - conn.createdAt.getTime()
            }))
        };
    }
    
    /**
     * Stop all audio connections
     */
    async stop() {
        console.log(`[LiveKitAudioForwarder] Stopping all audio connections...`);
        
        const promises = Array.from(this.activeConnections.keys()).map(callId => 
            this.removeAudioConnection(callId)
        );
        
        await Promise.all(promises);
        console.log(`[LiveKitAudioForwarder] ✅ All audio connections stopped`);
    }
}

export { LiveKitAudioForwarder };
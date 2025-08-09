import dgram from 'dgram';
import { EventEmitter } from 'events';
import { Transform } from 'stream';

/**
 * RTP Media Bridge - Handles audio streaming between SIP and LiveKit
 * Captures RTP packets, processes G.711 audio, and forwards to LiveKit
 */
class RTPMediaBridge extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            rtpPort: config.rtpPort || 10000,
            rtpHost: config.rtpHost || '0.0.0.0',
            codecSupport: ['PCMU', 'PCMA'], // G.711 codecs
            bufferSize: config.bufferSize || 1024,
            ...config
        };
        
        this.rtpSocket = null;
        this.activeSessions = new Map(); // callId -> session info
        this.isRunning = false;
        
        console.log(`[RTPMediaBridge] Initialized with config:`, {
            rtpPort: this.config.rtpPort,
            rtpHost: this.config.rtpHost,
            codecSupport: this.config.codecSupport
        });
    }
    
    /**
     * Start RTP media bridge server
     */
    async start() {
        if (this.isRunning) {
            console.log('[RTPMediaBridge] Already running');
            return;
        }
        
        return new Promise((resolve, reject) => {
            this.rtpSocket = dgram.createSocket('udp4');
            
            this.rtpSocket.on('message', (buffer, rinfo) => {
                this.handleRTPPacket(buffer, rinfo);
            });
            
            this.rtpSocket.on('error', (error) => {
                console.error('[RTPMediaBridge] RTP socket error:', error);
                this.emit('error', error);
            });
            
            this.rtpSocket.on('close', () => {
                console.warn('[RTPMediaBridge] RTP socket closed');
                this.isRunning = false;
                this.emit('close');
            });
            
            this.rtpSocket.bind(this.config.rtpPort, this.config.rtpHost, () => {
                this.isRunning = true;
                console.log(`[RTPMediaBridge] ✅ RTP server listening on ${this.config.rtpHost}:${this.config.rtpPort}`);
                resolve();
            });
            
            this.rtpSocket.on('error', reject);
        });
    }
    
    /**
     * Handle incoming RTP packet
     */
    handleRTPPacket(buffer, rinfo) {
        try {
            const rtpHeader = this.parseRTPHeader(buffer);
            
            if (!rtpHeader) {
                console.warn('[RTPMediaBridge] Invalid RTP packet received');
                return;
            }
            
            console.log(`[RTPMediaBridge] 🎵 RTP packet received: PT=${rtpHeader.payloadType}, Seq=${rtpHeader.sequenceNumber}, TS=${rtpHeader.timestamp}, Size=${buffer.length}`);
            
            // Extract audio payload (skip RTP header)
            const audioPayload = buffer.slice(rtpHeader.headerLength);
            
            // Process audio based on payload type
            this.processAudioPayload(rtpHeader, audioPayload, rinfo);
            
            // Emit RTP packet event for monitoring
            this.emit('rtpPacket', {
                header: rtpHeader,
                payload: audioPayload,
                source: rinfo
            });
            
        } catch (error) {
            console.error('[RTPMediaBridge] Error handling RTP packet:', error);
        }
    }
    
    /**
     * Parse RTP header from buffer
     */
    parseRTPHeader(buffer) {
        if (buffer.length < 12) {
            return null; // Minimum RTP header size
        }
        
        const version = (buffer[0] >> 6) & 0x03;
        const padding = (buffer[0] >> 5) & 0x01;
        const extension = (buffer[0] >> 4) & 0x01;
        const csrcCount = buffer[0] & 0x0F;
        
        const marker = (buffer[1] >> 7) & 0x01;
        const payloadType = buffer[1] & 0x7F;
        
        const sequenceNumber = buffer.readUInt16BE(2);
        const timestamp = buffer.readUInt32BE(4);
        const ssrc = buffer.readUInt32BE(8);
        
        // Calculate header length
        let headerLength = 12 + (csrcCount * 4);
        
        if (extension) {
            if (buffer.length < headerLength + 4) {
                return null;
            }
            const extensionLength = buffer.readUInt16BE(headerLength + 2) * 4;
            headerLength += 4 + extensionLength;
        }
        
        return {
            version,
            padding,
            extension,
            csrcCount,
            marker,
            payloadType,
            sequenceNumber,
            timestamp,
            ssrc,
            headerLength
        };
    }
    
    /**
     * Process audio payload based on codec
     */
    processAudioPayload(rtpHeader, audioPayload, rinfo) {
        let codecName = 'UNKNOWN';
        
        // Map payload type to codec
        switch (rtpHeader.payloadType) {
            case 0:
                codecName = 'PCMU'; // G.711 μ-law
                break;
            case 8:
                codecName = 'PCMA'; // G.711 A-law
                break;
            default:
                console.warn(`[RTPMediaBridge] Unsupported payload type: ${rtpHeader.payloadType}`);
                return;
        }
        
        console.log(`[RTPMediaBridge] 🎧 Processing ${codecName} audio: ${audioPayload.length} bytes`);
        
        // Convert G.711 to PCM for further processing
        const pcmData = this.convertG711ToPCM(audioPayload, codecName);
        
        // Emit processed audio for LiveKit forwarding
        this.emit('audioData', {
            codec: codecName,
            pcmData,
            rtpHeader,
            source: rinfo,
            timestamp: Date.now()
        });
    }
    
    /**
     * Convert G.711 (PCMU/PCMA) to PCM
     */
    convertG711ToPCM(g711Data, codec) {
        const pcmData = new Int16Array(g711Data.length);
        
        for (let i = 0; i < g711Data.length; i++) {
            if (codec === 'PCMU') {
                // μ-law to linear PCM conversion
                pcmData[i] = this.mulawToLinear(g711Data[i]);
            } else if (codec === 'PCMA') {
                // A-law to linear PCM conversion
                pcmData[i] = this.alawToLinear(g711Data[i]);
            }
        }
        
        return pcmData;
    }
    
    /**
     * μ-law to linear PCM conversion
     */
    mulawToLinear(mulaw) {
        const BIAS = 0x84;
        const CLIP = 32635;
        
        mulaw = ~mulaw;
        const sign = (mulaw & 0x80);
        const exponent = (mulaw >> 4) & 0x07;
        const mantissa = mulaw & 0x0F;
        
        let sample = mantissa << (exponent + 3);
        sample += BIAS;
        if (exponent !== 0) {
            sample += (1 << (exponent + 2));
        }
        
        return sign ? -sample : sample;
    }
    
    /**
     * A-law to linear PCM conversion
     */
    alawToLinear(alaw) {
        alaw ^= 0x55;
        const sign = alaw & 0x80;
        const exponent = (alaw >> 4) & 0x07;
        const mantissa = alaw & 0x0F;
        
        let sample = mantissa << 4;
        if (exponent !== 0) {
            sample += 0x100;
            sample <<= (exponent - 1);
        } else {
            sample += 0x08;
        }
        
        return sign ? -sample : sample;
    }
    
    /**
     * Create audio session for a call
     */
    createAudioSession(callId, roomName, remoteEndpoint) {
        const session = {
            callId,
            roomName,
            remoteEndpoint,
            createdAt: new Date(),
            packetsReceived: 0,
            bytesReceived: 0,
            lastActivity: new Date()
        };
        
        this.activeSessions.set(callId, session);
        console.log(`[RTPMediaBridge] 📞 Audio session created for call ${callId} -> room ${roomName}`);
        
        return session;
    }
    
    /**
     * Remove audio session
     */
    removeAudioSession(callId) {
        const session = this.activeSessions.get(callId);
        if (session) {
            this.activeSessions.delete(callId);
            console.log(`[RTPMediaBridge] 📞 Audio session removed for call ${callId}`);
            console.log(`[RTPMediaBridge] Session stats: ${session.packetsReceived} packets, ${session.bytesReceived} bytes`);
        }
    }
    
    /**
     * Send RTP packet (for outbound audio)
     */
    sendRTPPacket(audioData, payloadType, sequenceNumber, timestamp, ssrc, destination) {
        const rtpHeader = this.createRTPHeader(payloadType, sequenceNumber, timestamp, ssrc);
        const rtpPacket = Buffer.concat([rtpHeader, audioData]);
        
        this.rtpSocket.send(rtpPacket, destination.port, destination.address, (error) => {
            if (error) {
                console.error('[RTPMediaBridge] Error sending RTP packet:', error);
            }
        });
    }
    
    /**
     * Create RTP header
     */
    createRTPHeader(payloadType, sequenceNumber, timestamp, ssrc) {
        const header = Buffer.alloc(12);
        
        // Version (2), Padding (0), Extension (0), CSRC count (0)
        header[0] = 0x80;
        
        // Marker (0), Payload type
        header[1] = payloadType & 0x7F;
        
        // Sequence number
        header.writeUInt16BE(sequenceNumber, 2);
        
        // Timestamp
        header.writeUInt32BE(timestamp, 4);
        
        // SSRC
        header.writeUInt32BE(ssrc, 8);
        
        return header;
    }
    
    /**
     * Get bridge statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            activeSessions: this.activeSessions.size,
            rtpPort: this.config.rtpPort,
            sessions: Array.from(this.activeSessions.values()).map(session => ({
                callId: session.callId,
                roomName: session.roomName,
                packetsReceived: session.packetsReceived,
                bytesReceived: session.bytesReceived,
                duration: Date.now() - session.createdAt.getTime()
            }))
        };
    }
    
    /**
     * Stop RTP media bridge
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        
        return new Promise((resolve) => {
            if (this.rtpSocket) {
                this.rtpSocket.close(() => {
                    console.log('[RTPMediaBridge] ✅ RTP server stopped');
                    this.isRunning = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

export { RTPMediaBridge };
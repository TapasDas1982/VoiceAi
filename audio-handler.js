/**
 * Simplified Audio Handler - RTP and Audio Processing Only
 * Single responsibility: Handle audio streaming and RTP communication
 */

const dgram = require('dgram');
const EventEmitter = require('events');

class AudioHandler extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.rtpSocket = null;
        this.activeStreams = new Map();
        this.sequenceNumber = 1;
        this.timestamp = 0;
        this.ssrc = Math.floor(Math.random() * 0xFFFFFFFF);
        
        // Audio format settings
        this.sampleRate = 8000; // Standard for telephony
        this.channels = 1; // Mono
        this.bitDepth = 16; // 16-bit PCM
    }

    /**
     * Start audio handler
     */
    async start() {
        try {
            await this.createRTPSocket();
            console.log('🎵 Audio Handler started successfully');
            return true;
        } catch (error) {
            console.error('❌ Audio Handler start failed:', error.message);
            return false;
        }
    }

    /**
     * Create RTP socket for audio streaming
     */
    createRTPSocket() {
        return new Promise((resolve, reject) => {
            this.rtpSocket = dgram.createSocket('udp4');
            
            this.rtpSocket.on('message', (msg, rinfo) => {
                this.handleRTPPacket(msg, rinfo);
            });
            
            this.rtpSocket.on('error', (err) => {
                console.error('RTP Socket error:', err);
                this.emit('error', err);
            });
            
            this.rtpSocket.bind(this.config.rtpPort || 5004, () => {
                console.log(`🎵 RTP Socket listening on port ${this.config.rtpPort || 5004}`);
                resolve();
            });
        });
    }

    /**
     * Start audio stream for a call
     */
    startStream(callId, remoteHost, remotePort) {
        const stream = {
            callId,
            remoteHost,
            remotePort,
            startTime: Date.now(),
            packetsReceived: 0,
            packetsSent: 0,
            lastActivity: Date.now()
        };
        
        this.activeStreams.set(callId, stream);
        console.log(`🎵 Audio stream started for call ${callId}`);
        
        this.emit('streamStarted', callId, stream);
        return stream;
    }

    /**
     * Handle incoming RTP packets
     */
    handleRTPPacket(packet, rinfo) {
        try {
            // Parse RTP header (12 bytes minimum)
            if (packet.length < 12) {
                return; // Invalid RTP packet
            }
            
            const header = this.parseRTPHeader(packet);
            const audioData = packet.slice(12); // Audio payload after header
            
            // Find associated call stream
            const stream = this.findStreamByRemote(rinfo.address, rinfo.port);
            if (stream) {
                stream.packetsReceived++;
                stream.lastActivity = Date.now();
                
                // Emit audio data for AI processing
                this.emit('audioReceived', stream.callId, audioData, header);
            }
            
        } catch (error) {
            console.error('Error handling RTP packet:', error);
        }
    }

    /**
     * Parse RTP header
     */
    parseRTPHeader(packet) {
        const header = {
            version: (packet[0] >> 6) & 0x03,
            padding: (packet[0] >> 5) & 0x01,
            extension: (packet[0] >> 4) & 0x01,
            csrcCount: packet[0] & 0x0F,
            marker: (packet[1] >> 7) & 0x01,
            payloadType: packet[1] & 0x7F,
            sequenceNumber: packet.readUInt16BE(2),
            timestamp: packet.readUInt32BE(4),
            ssrc: packet.readUInt32BE(8)
        };
        
        return header;
    }

    /**
     * Send audio data via RTP
     */
    sendAudio(callId, audioData) {
        const stream = this.activeStreams.get(callId);
        if (!stream) {
            console.error(`No active stream for call ${callId}`);
            return false;
        }
        
        try {
            // Create RTP packet
            const rtpPacket = this.createRTPPacket(audioData);
            
            // Send to remote endpoint
            this.rtpSocket.send(rtpPacket, stream.remotePort, stream.remoteHost, (err) => {
                if (err) {
                    console.error('Failed to send RTP packet:', err);
                } else {
                    stream.packetsSent++;
                    stream.lastActivity = Date.now();
                }
            });
            
            return true;
        } catch (error) {
            console.error('Error sending audio:', error);
            return false;
        }
    }

    /**
     * Create RTP packet
     */
    createRTPPacket(audioData) {
        const header = Buffer.alloc(12);
        
        // RTP Header fields
        header[0] = 0x80; // Version 2, no padding, no extension, no CSRC
        header[1] = 0x0B; // No marker, payload type 11 (PCM16/L16)
        header.writeUInt16BE(this.sequenceNumber++, 2);
        header.writeUInt32BE(this.timestamp, 4);
        header.writeUInt32BE(this.ssrc, 8);
        
        // Update timestamp (assuming 20ms packets at 8kHz)
        this.timestamp += 160;
        
        // Combine header and payload
        return Buffer.concat([header, audioData]);
    }

    /**
     * Convert audio format for AI processing
     */
    convertAudioForAI(audioData) {
        // Audio is already in PCM16 format, compatible with OpenAI Realtime API
        // OpenAI Realtime API requires PCM16 format (16-bit signed little-endian)
        
        try {
            // Ensure audio data length is even for 16-bit samples
            if (audioData.length % 2 !== 0) {
                // Pad to even length for 16-bit samples
                audioData = Buffer.concat([audioData, Buffer.alloc(1)]);
            }
            
            return audioData;
        } catch (error) {
            console.error('Audio conversion error:', error);
            return audioData;
        }
    }

    /**
     * Convert audio from AI for RTP transmission
     */
    convertAudioFromAI(audioData) {
        // Audio from OpenAI Realtime API is already in PCM16 format
        // No conversion needed as we're using PCM16 throughout the pipeline
        
        try {
            // Ensure audio data length is even for 16-bit samples
            if (audioData.length % 2 !== 0) {
                // Pad to even length for 16-bit samples
                audioData = Buffer.concat([audioData, Buffer.alloc(1)]);
            }
            
            return audioData;
        } catch (error) {
            console.error('Audio conversion error:', error);
            return audioData;
        }
    }

    /**
     * Find stream by remote address
     */
    findStreamByRemote(address, port) {
        for (const stream of this.activeStreams.values()) {
            if (stream.remoteHost === address && stream.remotePort === port) {
                return stream;
            }
        }
        return null;
    }

    /**
     * End audio stream
     */
    endStream(callId) {
        const stream = this.activeStreams.get(callId);
        if (stream) {
            this.activeStreams.delete(callId);
            console.log(`🎵 Audio stream ended for call ${callId}`);
            
            const stats = {
                duration: Date.now() - stream.startTime,
                packetsReceived: stream.packetsReceived,
                packetsSent: stream.packetsSent
            };
            
            this.emit('streamEnded', callId, stats);
            return stats;
        }
        return null;
    }

    /**
     * Get stream statistics
     */
    getStreamStats(callId) {
        const stream = this.activeStreams.get(callId);
        if (stream) {
            return {
                callId: stream.callId,
                duration: Date.now() - stream.startTime,
                packetsReceived: stream.packetsReceived,
                packetsSent: stream.packetsSent,
                lastActivity: stream.lastActivity,
                isActive: Date.now() - stream.lastActivity < 5000
            };
        }
        return null;
    }

    /**
     * Get all active streams
     */
    getActiveStreams() {
        const streams = [];
        for (const [callId, stream] of this.activeStreams) {
            streams.push(this.getStreamStats(callId));
        }
        return streams;
    }

    /**
     * Clean up inactive streams
     */
    cleanupInactiveStreams() {
        const now = Date.now();
        const timeout = 30000; // 30 seconds
        
        for (const [callId, stream] of this.activeStreams) {
            if (now - stream.lastActivity > timeout) {
                console.log(`🎵 Cleaning up inactive stream for call ${callId}`);
                this.endStream(callId);
            }
        }
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            activeStreams: this.activeStreams.size,
            rtpSocketActive: this.rtpSocket !== null,
            sequenceNumber: this.sequenceNumber,
            timestamp: this.timestamp
        };
    }

    /**
     * Stop audio handler
     */
    stop() {
        // End all active streams
        for (const callId of this.activeStreams.keys()) {
            this.endStream(callId);
        }
        
        // Close RTP socket
        if (this.rtpSocket) {
            this.rtpSocket.close();
            this.rtpSocket = null;
        }
        
        console.log('🎵 Audio Handler stopped');
    }
}

module.exports = AudioHandler;
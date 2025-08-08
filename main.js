/**
 * VoiceAI - Simplified Main Entry Point
 * Single responsibility: Orchestrate all components with clean integration
 */

const config = require('./config');
const SIPClient = require('./sip-client');
const AIProcessor = require('./ai-processor');
const AudioHandler = require('./audio-handler');
const http = require('http');
const path = require('path');
const fs = require('fs');

class VoiceAI {
    constructor() {
        this.config = config;
        this.sipClient = null;
        this.aiProcessor = null;
        this.audioHandler = null;
        this.httpServer = null;
        this.running = false;
        
        // Simple state tracking
        this.activeCalls = new Map();
        this.startTime = Date.now();
        
        // Bind methods
        this.handleShutdown = this.handleShutdown.bind(this);
    }

    /**
     * Start the VoiceAI system
     */
    async start() {
        try {
            console.log('🚀 Starting VoiceAI System...');
            this.config.printSummary();
            
            // Initialize components in order
            await this.initializeAudioHandler();
            await this.initializeAIProcessor();
            
            // Try to initialize SIP client, but don't fail if no server available
            const skipSip = this.config.getEnvValue('SKIP_SIP_REGISTRATION', 'false') === 'true';
            if (skipSip) {
                console.log('⚠️  Skipping SIP registration (SKIP_SIP_REGISTRATION=true)');
                console.log('📞 Running in test mode without SIP server');
            } else {
                try {
                    await this.initializeSIPClient();
                } catch (error) {
                    console.log('⚠️  SIP registration failed, continuing in test mode');
                    console.log('💡 Set SKIP_SIP_REGISTRATION=true to suppress this warning');
                    console.log('📞 System will run without SIP functionality');
                }
            }
            
            await this.initializeHTTPServer();
            
            // Setup component integration
            this.setupEventHandlers();
            
            // Setup graceful shutdown
            this.setupShutdownHandlers();
            
            this.running = true;
            console.log('✅ VoiceAI System started successfully');
            
            if (this.sipClient && this.sipClient.registered) {
                console.log(`📞 Ready to accept calls on extension ${this.config.getValue('sip.extension')}`);
            } else {
                console.log('🧪 Running in test mode - OpenAI integration ready');
                console.log('💡 Connect to a SIP trunk to enable voice calls');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to start VoiceAI System:', error.message);
            await this.stop();
            return false;
        }
    }

    /**
     * Initialize Audio Handler
     */
    async initializeAudioHandler() {
        console.log('🎵 Initializing Audio Handler...');
        
        this.audioHandler = new AudioHandler(this.config.getAudioConfig());
        const success = await this.audioHandler.start();
        
        if (!success) {
            throw new Error('Audio Handler initialization failed');
        }
    }

    /**
     * Initialize AI Processor
     */
    async initializeAIProcessor() {
        console.log('🤖 Initializing AI Processor...');
        
        this.aiProcessor = new AIProcessor(this.config.getAIConfig());
        const success = await this.aiProcessor.start();
        
        if (!success && this.config.isEnabled('openai')) {
            console.warn('⚠️ AI Processor failed to start, but continuing without AI features');
        }
    }

    /**
     * Initialize SIP Client
     */
    async initializeSIPClient() {
        console.log('📞 Initializing SIP Client...');
        
        this.sipClient = new SIPClient(this.config.getSIPConfig());
        const success = await this.sipClient.start();
        
        if (!success) {
            throw new Error('SIP Client initialization failed');
        }
    }

    /**
     * Initialize HTTP Server (for dashboard and API)
     */
    async initializeHTTPServer() {
        if (!this.config.isEnabled('dashboard')) {
            console.log('📊 Dashboard disabled, skipping HTTP server');
            return;
        }
        
        console.log('📊 Initializing HTTP Server...');
        
        this.httpServer = http.createServer((req, res) => {
            this.handleHTTPRequest(req, res);
        });
        
        return new Promise((resolve, reject) => {
            this.httpServer.listen(this.config.getValue('server.port'), (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`📊 Dashboard available at http://localhost:${this.config.getValue('server.port')}`);
                    resolve();
                }
            });
        });
    }

    /**
     * Setup event handlers between components
     */
    setupEventHandlers() {
        // SIP Client Events
        this.sipClient.on('incomingCall', (callId, sipMessage) => {
            this.handleIncomingCall(callId, sipMessage);
        });
        
        this.sipClient.on('callEnded', (callId) => {
            this.handleCallEnded(callId);
        });
        
        this.sipClient.on('callEstablished', (callId) => {
            this.handleCallEstablished(callId);
        });
        
        // Audio Handler Events
        this.audioHandler.on('audioReceived', (callId, audioData, header) => {
            this.handleAudioReceived(callId, audioData, header);
        });
        
        this.audioHandler.on('streamStarted', (callId, stream) => {
            console.log(`🎵 Audio stream started for call ${callId}`);
        });
        
        this.audioHandler.on('streamEnded', (callId, stats) => {
            console.log(`🎵 Audio stream ended for call ${callId}`, stats);
        });
        
        // AI Processor Events
        if (this.aiProcessor) {
            this.aiProcessor.on('audioChunk', (audioChunk) => {
                this.handleAIAudioResponse(audioChunk);
            });
            
            this.aiProcessor.on('audioComplete', (completeAudio) => {
                this.handleAIAudioComplete(completeAudio);
            });
            
            this.aiProcessor.on('textResponse', (text) => {
                console.log('🤖 AI Text Response:', text);
            });
            
            this.aiProcessor.on('conversationStarted', (callId) => {
                console.log(`🤖 AI conversation started for call ${callId}`);
            });
            
            this.aiProcessor.on('conversationEnded', (callId) => {
                console.log(`🤖 AI conversation ended for call ${callId}`);
            });
        }
    }

    /**
     * Handle incoming call
     */
    handleIncomingCall(callId, sipMessage) {
        console.log(`📞 Handling incoming call: ${callId}`);
        
        // Create call record
        const call = {
            id: callId,
            startTime: Date.now(),
            sipMessage,
            audioStreamActive: false,
            aiConversationActive: false
        };
        
        this.activeCalls.set(callId, call);
        
        // Start audio stream (extract RTP info from SIP message)
        const rtpInfo = this.extractRTPInfo(sipMessage);
        if (rtpInfo) {
            this.audioHandler.startStream(callId, rtpInfo.host, rtpInfo.port);
            call.audioStreamActive = true;
        }
        
        // Start AI conversation if available
        if (this.aiProcessor && this.aiProcessor.getStatus().connected) {
            this.aiProcessor.startConversation(callId);
            call.aiConversationActive = true;
        } else {
            console.log('⚠️ AI not available for call, audio-only mode');
        }
    }

    /**
     * Handle call established (after ACK received)
     */
    handleCallEstablished(callId) {
        console.log(`📞 Call established: ${callId}`);
        
        const call = this.activeCalls.get(callId);
        if (call) {
            console.log(`📞 Call ${callId} is now fully established and ready for audio`);
            // Call is now fully established, audio should start flowing
        }
    }

    /**
     * Handle call ended
     */
    handleCallEnded(callId) {
        console.log(`📞 Call ended: ${callId}`);
        
        const call = this.activeCalls.get(callId);
        if (call) {
            // End audio stream
            if (call.audioStreamActive) {
                this.audioHandler.endStream(callId);
            }
            
            // End AI conversation
            if (call.aiConversationActive && this.aiProcessor) {
                this.aiProcessor.endConversation(callId);
            }
            
            // Calculate call duration
            const duration = Date.now() - call.startTime;
            console.log(`📞 Call ${callId} duration: ${Math.round(duration / 1000)}s`);
            
            this.activeCalls.delete(callId);
        }
    }

    /**
     * Handle received audio data
     */
    handleAudioReceived(callId, audioData, header) {
        const call = this.activeCalls.get(callId);
        if (!call) return;
        
        // Convert audio for AI processing
        const aiAudioData = this.audioHandler.convertAudioForAI(audioData);
        
        // Send to AI if conversation is active
        if (call.aiConversationActive && this.aiProcessor) {
            this.aiProcessor.sendAudio(aiAudioData);
        }
    }

    /**
     * Handle AI audio response chunk
     */
    handleAIAudioResponse(audioChunk) {
        // Find active call to send audio to
        for (const [callId, call] of this.activeCalls) {
            if (call.aiConversationActive && call.audioStreamActive) {
                // Convert AI audio for RTP transmission
                const rtpAudioData = this.audioHandler.convertAudioFromAI(audioChunk);
                this.audioHandler.sendAudio(callId, rtpAudioData);
                break; // Send to first active call for now
            }
        }
    }

    /**
     * Handle complete AI audio response
     */
    handleAIAudioComplete(completeAudio) {
        console.log(`🤖 AI audio response complete: ${completeAudio.length} bytes`);
    }

    /**
     * Extract RTP information from SIP message
     */
    extractRTPInfo(sipMessage) {
        try {
            // Simple SDP parsing to extract RTP connection info
            const lines = sipMessage.split('\r\n');
            let host = null;
            let port = null;
            
            for (const line of lines) {
                if (line.startsWith('c=IN IP4 ')) {
                    host = line.split(' ')[2];
                }
                if (line.startsWith('m=audio ')) {
                    port = parseInt(line.split(' ')[1]);
                }
            }
            
            return host && port ? { host, port } : null;
        } catch (error) {
            console.error('Error extracting RTP info:', error);
            return null;
        }
    }

    /**
     * Handle HTTP requests (simple dashboard)
     */
    handleHTTPRequest(req, res) {
        const url = req.url;
        
        if (url === '/' || url === '/dashboard') {
            this.serveDashboard(res);
        } else if (url === '/api/status') {
            this.serveStatus(res);
        } else if (url === '/api/calls') {
            this.serveCalls(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    }

    /**
     * Serve simple dashboard
     */
    serveDashboard(res) {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>VoiceAI Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
        .online { background-color: #d4edda; border: 1px solid #c3e6cb; }
        .offline { background-color: #f8d7da; border: 1px solid #f5c6cb; }
        .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>🎙️ VoiceAI Dashboard</h1>
    <div id="status">Loading...</div>
    <h2>Active Calls</h2>
    <div id="calls">Loading...</div>
    
    <script>
        function updateDashboard() {
            fetch('/api/status')
                .then(r => r.json())
                .then(data => {
                    document.getElementById('status').innerHTML = 
                        '<div class="status ' + (data.sip.registered ? 'online' : 'offline') + '">SIP: ' + (data.sip.registered ? 'Registered' : 'Not Registered') + '</div>' +
                        '<div class="status ' + (data.ai.connected ? 'online' : 'warning') + '">AI: ' + (data.ai.connected ? 'Connected' : 'Disconnected') + '</div>' +
                        '<div class="status online">Audio: Active</div>' +
                        '<p>Uptime: ' + Math.round(data.uptime / 1000) + 's | Active Calls: ' + data.activeCalls + '</p>';
                });
            
            fetch('/api/calls')
                .then(r => r.json())
                .then(data => {
                    if (data.length === 0) {
                        document.getElementById('calls').innerHTML = '<p>No active calls</p>';
                    } else {
                        let table = '<table><tr><th>Call ID</th><th>Duration</th><th>Audio</th><th>AI</th></tr>';
                        data.forEach(call => {
                            table += '<tr><td>' + call.id + '</td><td>' + Math.round(call.duration / 1000) + 's</td><td>' + (call.audioStreamActive ? '✅' : '❌') + '</td><td>' + (call.aiConversationActive ? '✅' : '❌') + '</td></tr>';
                        });
                        table += '</table>';
                        document.getElementById('calls').innerHTML = table;
                    }
                });
        }
        
        updateDashboard();
        setInterval(updateDashboard, 2000);
    </script>
</body>
</html>`;
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    /**
     * Serve system status API
     */
    serveStatus(res) {
        const status = {
            uptime: Date.now() - this.startTime,
            activeCalls: this.activeCalls.size,
            sip: this.sipClient ? this.sipClient.getStatus() : { registered: false },
            ai: this.aiProcessor ? this.aiProcessor.getStatus() : { connected: false },
            audio: this.audioHandler ? this.audioHandler.getStatus() : { activeStreams: 0 }
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
    }

    /**
     * Serve active calls API
     */
    serveCalls(res) {
        const calls = [];
        for (const [callId, call] of this.activeCalls) {
            calls.push({
                id: callId,
                duration: Date.now() - call.startTime,
                audioStreamActive: call.audioStreamActive,
                aiConversationActive: call.aiConversationActive
            });
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(calls, null, 2));
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupShutdownHandlers() {
        process.on('SIGINT', this.handleShutdown);
        process.on('SIGTERM', this.handleShutdown);
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            this.handleShutdown();
        });
    }

    /**
     * Handle graceful shutdown
     */
    async handleShutdown() {
        if (!this.running) return;
        
        console.log('\n🛑 Shutting down VoiceAI System...');
        this.running = false;
        
        await this.stop();
        process.exit(0);
    }

    /**
     * Stop the VoiceAI system
     */
    async stop() {
        try {
            // End all active calls
            for (const callId of this.activeCalls.keys()) {
                this.handleCallEnded(callId);
            }
            
            // Stop components in reverse order
            if (this.httpServer) {
                this.httpServer.close();
                console.log('📊 HTTP Server stopped');
            }
            
            if (this.sipClient) {
                this.sipClient.stop();
                console.log('📞 SIP Client stopped');
            }
            
            if (this.aiProcessor) {
                this.aiProcessor.stop();
                console.log('🤖 AI Processor stopped');
            }
            
            if (this.audioHandler) {
                this.audioHandler.stop();
                console.log('🎵 Audio Handler stopped');
            }
            
            console.log('✅ VoiceAI System stopped gracefully');
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error.message);
        }
    }

    /**
     * Get system status
     */
    getStatus() {
        return {
            running: this.running,
            uptime: Date.now() - this.startTime,
            activeCalls: this.activeCalls.size,
            components: {
                sip: this.sipClient ? this.sipClient.getStatus() : null,
                ai: this.aiProcessor ? this.aiProcessor.getStatus() : null,
                audio: this.audioHandler ? this.audioHandler.getStatus() : null
            }
        };
    }
}

// Start the system if this file is run directly
if (require.main === module) {
    const voiceAI = new VoiceAI();
    voiceAI.start().catch(error => {
        console.error('Failed to start VoiceAI:', error);
        process.exit(1);
    });
}

module.exports = VoiceAI;
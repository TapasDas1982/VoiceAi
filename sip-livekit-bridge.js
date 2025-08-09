import { SIPSessionManager } from './sip-session.js';
import dgram from 'dgram';
import { EventEmitter } from 'events';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import WebSocket from 'ws';
import crypto from 'crypto';

/**
 * SIP Extension to LiveKit Bridge
 * Acts as a SIP extension (like MicroSIP) that registers with UCM and routes calls to LiveKit AI Agent
 */
class SIPLiveKitBridge extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            sipPort: config.sipPort || 5060,
            sipHost: config.sipHost || '0.0.0.0',
            publicIp: config.publicIp || '122.163.120.156',
            sipAuthUser: config.sipAuthUser || '31',
            sipPassword: config.sipPassword || 'Twist@2025',
            sipServer: config.sipServer || '122.163.120.156:5060',
            livekitUrl: config.livekitUrl,
            livekitApiKey: config.livekitApiKey,
            livekitApiSecret: config.livekitApiSecret,
            ...config
        };
        
        this.sipSocket = null;
        this.sessionManager = new SIPSessionManager();
        this.activeCalls = new Map();
        this.livekitRoomService = null;
        
        // SIP Extension Registration State
        this.registrationState = 'UNREGISTERED';
        this.registrationCallId = null;
        this.registrationCSeq = 1;
        this.registrationTimer = null;
        this.registrationExpires = 3600; // 1 hour
        this.healthCheckTimer = null;
        this.lastRegistrationTime = null
        
        console.log('[SIPLiveKitBridge] Initialized as SIP Extension with config:', {
            sipPort: this.config.sipPort,
            sipHost: this.config.sipHost,
            publicIp: this.config.publicIp,
            sipAuthUser: this.config.sipAuthUser,
            sipPassword: this.config.sipPassword ? '***' : 'NOT SET',
            sipServer: this.config.sipServer
        });
        
        // Debug: Show actual environment variables
        console.log('[SIPLiveKitBridge] 🔍 Debug - Environment variables:');
        console.log(`  SIP_AUTHORIZATION_USER: ${process.env.SIP_AUTHORIZATION_USER || 'NOT SET'}`);
        console.log(`  SIP_AUTH_USER: ${process.env.SIP_AUTH_USER || 'NOT SET'}`);
        console.log(`  SIP_PASSWORD: ${process.env.SIP_PASSWORD ? '***' : 'NOT SET'}`);
        console.log(`  SIP_SERVER: ${process.env.SIP_SERVER || 'NOT SET'}`);
    }
    
    /**
     * Start the SIP bridge as a SIP extension
     */
    async start() {
        try {
            // Initialize LiveKit Room Service
            this.livekitRoomService = new RoomServiceClient(
                this.config.livekitUrl,
                this.config.livekitApiKey,
                this.config.livekitApiSecret
            );
            
            // Start SIP server
            await this.startSIPServer();
            
            // Register as SIP extension with UCM
            await this.registerWithUCM();
            
            // Start health check monitor
            this.startHealthCheckMonitor();
            
            console.log('[SIPLiveKitBridge] ✅ SIP Extension started successfully');
            console.log('[SIPLiveKitBridge] 📞 Registered as extension', this.config.sipAuthUser, 'with UCM');
            
        } catch (error) {
            console.error('[SIPLiveKitBridge] Failed to start:', error);
            throw error;
        }
    }
    
    /**
     * Start SIP server to listen for incoming calls
     */
    async startSIPServer() {
        return new Promise((resolve, reject) => {
            this.sipSocket = dgram.createSocket('udp4');
            
            this.sipSocket.on('message', (message, rinfo) => {
                this.handleSIPMessage(message.toString(), rinfo);
            });
            
            this.sipSocket.on('error', (error) => {
                console.error('[SIPLiveKitBridge] Socket error:', error);
                // Attempt to recover from socket errors
                this.handleSocketError(error);
            });
            
            this.sipSocket.on('close', () => {
                console.warn('[SIPLiveKitBridge] ⚠️ UDP socket closed unexpectedly');
                this.handleSocketClose();
            });
            
            this.sipSocket.bind(this.config.sipPort, this.config.sipHost, () => {
                // Set local IP and port for SIP headers
                this.localIP = this.config.publicIp;
                this.sipPort = this.config.sipPort;
                
                // Configure socket for better NAT traversal and connection persistence (after binding)
                try {
                    this.sipSocket.setTTL(64);
                    this.sipSocket.setBroadcast(false);
                    this.sipSocket.setRecvBufferSize(65536);
                    this.sipSocket.setSendBufferSize(65536);
                    console.log('[SIPLiveKitBridge] ✅ Socket configured for NAT traversal');
                } catch (error) {
                    console.warn('[SIPLiveKitBridge] Could not configure socket options:', error.message);
                }
                
                console.log(`[SIPLiveKitBridge] 🎯 SIP server listening on ${this.config.sipHost}:${this.config.sipPort}`);
                
                // Start aggressive NAT keep-alive immediately after binding
                this.startNATKeepAlive();
                
                resolve();
            });
        });
    }
    
    /**
     * Handle incoming SIP messages
     */
    async handleSIPMessage(rawMessage, rinfo) {
        try {
            console.log(`[SIPLiveKitBridge] 📨 Received SIP message from ${rinfo.address}:${rinfo.port}`);
            console.log('Message:', rawMessage.substring(0, 200) + '...');
            
            const message = this.parseSIPMessage(rawMessage);
            
            // Check if this is a SIP response (starts with SIP/2.0)
            if (rawMessage.startsWith('SIP/2.0')) {
                await this.handleSIPResponse(message, rinfo);
            }
            // Handle SIP requests (for calls)
            else if (message.method === 'INVITE') {
                await this.handleInvite(message, rinfo);
            } else if (message.method === 'ACK') {
                await this.handleAck(message, rinfo);
            } else if (message.method === 'BYE') {
                await this.handleBye(message, rinfo);
            } else if (message.method === 'CANCEL') {
                await this.handleCancel(message, rinfo);
            } else if (message.method === 'OPTIONS') {
                await this.handleOptions(message, rinfo);
            } else if (message.method === 'NOTIFY') {
                await this.handleNotify(message, rinfo);
            } else {
                console.log(`[SIPLiveKitBridge] Unhandled SIP method: ${message.method}`);
            }
            
        } catch (error) {
            console.error('[SIPLiveKitBridge] Error handling SIP message:', error);
        }
    }
    
    /**
     * Simple SIP message parser
     */
    parseSIPMessage(message) {
        const lines = message.split('\r\n');
        const firstLine = lines[0];
        const headers = {};
        let sdp = '';
        
        let method, uri, version, statusCode, reasonPhrase;
        
        // Parse first line
        if (firstLine.startsWith('SIP/2.0')) {
            // This is a response
            const parts = firstLine.split(' ');
            version = parts[0];
            statusCode = parseInt(parts[1]);
            reasonPhrase = parts.slice(2).join(' ');
            method = statusCode; // For compatibility with existing code
        } else {
            // This is a request
            const parts = firstLine.split(' ');
            method = parts[0];
            uri = parts[1];
            version = parts[2];
        }
        
        // Parse headers
        let inSDP = false;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            
            if (line === '') {
                inSDP = true;
                continue;
            }
            
            if (inSDP) {
                sdp += line + '\r\n';
            } else {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    const headerName = line.substring(0, colonIndex).trim();
                    const headerValue = line.substring(colonIndex + 1).trim();
                    headers[headerName.toLowerCase()] = headerValue;
                }
            }
        }
        
        // Extract common headers
        const callId = headers['call-id'] || '';
        const fromHeader = headers['from'] || '';
        const toHeader = headers['to'] || '';
        const viaHeader = headers['via'] || '';
        const cseq = headers['cseq'] || '';
        
        // Extract tags
        const fromTag = this.extractTag(fromHeader);
        const toTag = this.extractTag(toHeader);
        
        return {
            method,
            uri,
            version,
            statusCode,
            reasonPhrase,
            headers,
            sdp: sdp.trim(),
            callId,
            fromHeader,
            toHeader,
            viaHeader,
            cseq,
            fromTag,
            toTag
        };
    }
    
    /**
     * Extract tag from header
     */
    extractTag(header) {
        const tagMatch = header.match(/tag=([^;]+)/);
        return tagMatch ? tagMatch[1] : null;
    }
    
    /**
     * Register with UCM server as SIP extension
     */
    async registerWithUCM() {
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        this.registrationCallId = this.generateCallId();
        
        const registerMessage = [
            `REGISTER sip:${sipServerHost} SIP/2.0`,
            `Via: SIP/2.0/UDP ${this.config.publicIp}:${this.config.sipPort};branch=z9hG4bK${this.generateBranch()}`,
            `From: <sip:${this.config.sipAuthUser}@${sipServerHost}>;tag=${this.generateTag()}`,
            `To: <sip:${this.config.sipAuthUser}@${sipServerHost}>`,
            `Call-ID: ${this.registrationCallId}`,
            `CSeq: ${this.registrationCSeq} REGISTER`,
            `Contact: <sip:${this.config.sipAuthUser}@${this.config.publicIp}:${this.config.sipPort}>`,
            `Expires: ${this.registrationExpires}`,
            'User-Agent: VoiceAI-SIP-Extension/1.0',
            'Content-Length: 0',
            '',
            ''
        ].join('\r\n');
        
        console.log(`[SIPLiveKitBridge] 📤 Sending REGISTER to ${sipServerHost}:${sipServerPort}`);
        
        this.sipSocket.send(registerMessage, parseInt(sipServerPort), sipServerHost, (error) => {
            if (error) {
                console.error('[SIPLiveKitBridge] Error sending REGISTER:', error);
                this.registrationState = 'FAILED';
            } else {
                console.log('[SIPLiveKitBridge] ✅ REGISTER sent successfully');
                this.registrationState = 'REGISTERING';
            }
        });
    }
    
    /**
     * Handle SIP responses (mainly for registration)
     */
    async handleSIPResponse(response, rinfo) {
        const statusCode = parseInt(response.method); // In responses, method contains status code
        const callId = response.callId;
        
        console.log(`[SIPLiveKitBridge] 📨 Received ${statusCode} response for Call-ID: ${callId}`);
        console.log(`[SIPLiveKitBridge] 🔍 Debug - Registration Call-ID: ${this.registrationCallId}, Response Call-ID: ${callId}, Match: ${callId === this.registrationCallId}`);
        
        // Handle registration responses
        if (callId === this.registrationCallId) {
            if (statusCode === 200) {
                this.registrationState = 'REGISTERED';
                this.lastRegistrationTime = Date.now();
                console.log('[SIPLiveKitBridge] ✅ Successfully registered as extension', this.config.sipAuthUser);
                console.log(`[SIPLiveKitBridge] 📅 Registration timestamp: ${new Date(this.lastRegistrationTime).toISOString()}`);
                
                // Schedule re-registration
                this.scheduleReRegistration();
                
            } else if (statusCode === 401 || statusCode === 407) {
                console.log('[SIPLiveKitBridge] 🔐 Authentication required, sending authenticated REGISTER');
                await this.handleAuthenticationChallenge(response, rinfo);
                
            } else {
                console.error(`[SIPLiveKitBridge] ❌ Registration failed with status: ${statusCode}`);
                this.registrationState = 'FAILED';
            }
        }
    }
    
    /**
     * Handle authentication challenge for registration - RESTORED MD5 AUTH
     */
    async handleAuthenticationChallenge(response, rinfo) {
        const wwwAuth = response.headers['www-authenticate'] || response.headers['proxy-authenticate'];
        if (!wwwAuth) {
            console.error('[SIPLiveKitBridge] No authentication header found');
            return;
        }
        
        console.log(`[SIPLiveKitBridge] 🔍 WWW-Authenticate: ${wwwAuth}`);
        
        // Parse authentication parameters
        const realm = this.extractAuthParam(wwwAuth, 'realm');
        const nonce = this.extractAuthParam(wwwAuth, 'nonce');
        const algorithm = this.extractAuthParam(wwwAuth, 'algorithm') || 'MD5';
        const qop = this.extractAuthParam(wwwAuth, 'qop');
        const opaque = this.extractAuthParam(wwwAuth, 'opaque');
        
        console.log(`[SIPLiveKitBridge] 🔐 Auth params - Realm: ${realm}, QOP: ${qop}`);
        
        // Generate authentication response like MicroSIP
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        const uri = `sip:${sipServerHost}`;
        const method = 'REGISTER';
        
        const ha1 = this.md5(`${this.config.sipAuthUser}:${realm}:${this.config.sipPassword}`);
        const ha2 = this.md5(`${method}:${uri}`);
        
        let authResponse;
        let authHeader;
        
        if (qop && qop.includes('auth')) {
            // QOP authentication
            const cnonce = Math.random().toString(36).substring(2, 15);
            const nc = '00000001';
            authResponse = this.md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
            authHeader = `Digest username="${this.config.sipAuthUser}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${authResponse}", algorithm=${algorithm}, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
            if (opaque) {
                authHeader += `, opaque="${opaque}"`;
            }
        } else {
            // Basic digest authentication
            authResponse = this.md5(`${ha1}:${nonce}:${ha2}`);
            authHeader = `Digest username="${this.config.sipAuthUser}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${authResponse}", algorithm=${algorithm}`;
            if (opaque) {
                authHeader += `, opaque="${opaque}"`;
            }
        }
        
        console.log(`[SIPLiveKitBridge] 🔐 Generated response: ${authResponse}`);
        
        // Send authenticated REGISTER with proper format
        this.registrationCSeq++;
        // Generate new call ID for authenticated request
        this.registrationCallId = this.generateCallId();
        
        const registerMessage = [
             `REGISTER sip:${sipServerHost} SIP/2.0`,
             `Via: SIP/2.0/UDP ${this.localIP}:${this.sipPort};branch=z9hG4bK${this.generateBranch()}`,
             `From: <sip:${this.config.sipAuthUser}@${sipServerHost}>;tag=${this.generateTag()}`,
             `To: <sip:${this.config.sipAuthUser}@${sipServerHost}>`,
             `Call-ID: ${this.registrationCallId}`,
             `CSeq: ${this.registrationCSeq} REGISTER`,
             `Contact: <sip:${this.config.sipAuthUser}@${this.localIP}:${this.sipPort}>;expires=3600`,
             `Authorization: ${authHeader}`,
             `Max-Forwards: 70`,
             `User-Agent: VoiceAI-SIP-Bridge/1.0`,
             `Content-Length: 0`,
             '',
             ''
         ].join('\r\n');
        
        console.log('[SIPLiveKitBridge] 📤 Sending authenticated REGISTER');
        console.log(`[SIPLiveKitBridge] 🔍 Debug - New registration Call-ID for auth: ${this.registrationCallId}`);
        console.log('[SIPLiveKitBridge] 🔍 REGISTER Message:');
        console.log(registerMessage);
         this.sipSocket.send(Buffer.from(registerMessage), parseInt(sipServerPort) || 5060, sipServerHost);
         console.log('[SIPLiveKitBridge] ✅ Authenticated REGISTER sent');
    }
    
    /**
     * Schedule re-registration before expiration
     */
    scheduleReRegistration() {
        if (this.registrationTimer) {
            clearTimeout(this.registrationTimer);
        }
        
        // Re-register at 50% of expiration time for more active connection
        const reRegisterTime = (this.registrationExpires * 0.5) * 1000;
        
        this.registrationTimer = setTimeout(() => {
            console.log('[SIPLiveKitBridge] 🔄 Proactive re-registration to maintain active connection');
            this.registerWithUCM();
        }, reRegisterTime);
        
        console.log(`[SIPLiveKitBridge] ⏰ Re-registration scheduled in ${reRegisterTime/1000} seconds`);
    }
    
    /**
     * Start health check monitor for registration status
     */
    startHealthCheckMonitor() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        this.healthCheckTimer = setInterval(() => {
            this.checkRegistrationHealth();
            
            // Emit self-status for external monitoring
            const status = this.getClientStatus();
            this.emit('clientStatus', status);
        }, 5000); // Check every 5 seconds for more active monitoring
        
        console.log('[SIPLiveKitBridge] 🏥 Active connection health monitor started (5-second intervals)');
        console.log('[SIPLiveKitBridge] 🔍 Self-liveness monitoring enabled - client will actively report its status');
    }
    
    /**
     * Check registration health and trigger re-registration if needed
     */
    checkRegistrationHealth() {
        const now = Date.now();
        const timeSinceLastRegistration = this.lastRegistrationTime ? now - this.lastRegistrationTime : null;
        
        // Perform comprehensive self-liveness check
        const livenessStatus = this.performSelfLivenessCheck();
        
        console.log(`[SIPLiveKitBridge] 🏥 Health check - State: ${this.registrationState}, Last registration: ${timeSinceLastRegistration ? Math.floor(timeSinceLastRegistration/1000) + 's ago' : 'never'}`);
        console.log(`[SIPLiveKitBridge] 🔍 Self-liveness check: ${livenessStatus.status} - ${livenessStatus.message}`);
        
        // More aggressive health checking for active connection
        if (this.registrationState === 'UNREGISTERED' || 
            this.registrationState === 'FAILED' ||
            (this.registrationState === 'REGISTERING' && timeSinceLastRegistration && timeSinceLastRegistration > 30000) || // Stuck in registering for >30s
            (this.lastRegistrationTime && timeSinceLastRegistration > (this.registrationExpires * 1000 * 0.6)) || // 60% of expiration time for proactive refresh
            !livenessStatus.isAlive) { // Failed self-liveness check
            
            console.log('[SIPLiveKitBridge] 🚨 Registration health check failed - triggering proactive re-registration');
            this.registerWithUCM();
        } else if (this.registrationState === 'REGISTERED') {
            // Send periodic OPTIONS ping to verify connection is truly active
            if (timeSinceLastRegistration && timeSinceLastRegistration > 300000) { // Every 5 minutes
                this.sendKeepAlive();
            }
            console.log('[SIPLiveKitBridge] ✅ Registration health check passed');
        }
    }
    
    /**
     * Handle INVITE request - incoming call
     */
    async handleInvite(request, rinfo) {
        const callId = request.callId;
        const fromTag = request.fromTag;
        
        try {
            console.log(`[SIPLiveKitBridge] 📞 Incoming call: ${callId}`);
            
            // Create session
            const session = this.sessionManager.createSession(callId, null, fromTag);
            session.setState('PROCEEDING', 'INVITE received');
            
            // Send 100 Trying
            this.sendResponse(request, 100, 'Trying', rinfo);
            
            // Create LiveKit room
            const roomName = `sip-call-${callId.replace(/[^a-zA-Z0-9]/g, '')}`;
            console.log(`[SIPLiveKitBridge] Creating LiveKit room: ${roomName}`);
            
            try {
                await this.livekitRoomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300,
                    maxParticipants: 10
                });
                console.log(`[SIPLiveKitBridge] ✅ LiveKit room created: ${roomName}`);
            } catch (roomError) {
                if (roomError.message.includes('already exists')) {
                    console.log(`[SIPLiveKitBridge] Room ${roomName} already exists, continuing...`);
                } else {
                    throw roomError;
                }
            }
            
            // Generate participant token for AI agent
            const aiToken = await this.generateParticipantToken(roomName, 'ai-agent');
            
            // Send 180 Ringing
            this.sendResponse(request, 180, 'Ringing', rinfo);
            
            // Generate response SDP
            const responseSdp = this.generateResponseSDP();
            
            // Send 200 OK
            const responseHeaders = {
                'Contact': `<sip:${this.config.sipAuthUser}@${this.config.publicIp}:${this.config.sipPort}>`,
                'Content-Type': 'application/sdp'
            };
            
            this.sendResponse(request, 200, 'OK', rinfo, responseHeaders, responseSdp);
            
            // Store call information
            this.activeCalls.set(callId, {
                session,
                roomName,
                aiToken,
                rinfo,
                createdAt: new Date()
            });
            
            session.setState('CONFIRMED', 'Call established');
            
            console.log(`[SIPLiveKitBridge] ✅ Call ${callId} connected to LiveKit room ${roomName}`);
            
            // Emit call connected event
            this.emit('callConnected', {
                callId,
                roomName,
                aiToken
            });
            
        } catch (error) {
            console.error(`[SIPLiveKitBridge] Error handling INVITE:`, error);
            this.sendResponse(request, 500, 'Internal Server Error', rinfo);
        }
    }
    
    /**
     * Handle ACK request
     */
    async handleAck(request, rinfo) {
        const callId = request.callId;
        console.log(`[SIPLiveKitBridge] 📞 ACK received for call: ${callId}`);
        
        const call = this.activeCalls.get(callId);
        if (call) {
            call.session.setState('ESTABLISHED', 'ACK received');
            console.log(`[SIPLiveKitBridge] ✅ Call ${callId} fully established`);
        }
    }
    
    /**
     * Handle BYE request - call termination
     */
    async handleBye(request, rinfo) {
        const callId = request.callId;
        console.log(`[SIPLiveKitBridge] 📞 BYE received for call: ${callId}`);
        
        // Send 200 OK
        this.sendResponse(request, 200, 'OK', rinfo);
        
        // Cleanup call
        await this.cleanupCall(callId);
    }
    
    /**
     * Handle CANCEL request
     */
    async handleCancel(request, rinfo) {
        const callId = request.callId;
        console.log(`[SIPLiveKitBridge] 📞 CANCEL received for call: ${callId}`);
        
        // Send 200 OK
        this.sendResponse(request, 200, 'OK', rinfo);
        
        // Cleanup call
        await this.cleanupCall(callId);
    }
    
    /**
     * Handle OPTIONS request
     */
    async handleOptions(request, rinfo) {
        console.log(`[SIPLiveKitBridge] 📞 Received OPTIONS from ${rinfo.address}:${rinfo.port}`);
        
        // Send 200 OK with supported methods and capabilities
        const additionalHeaders = {
            'Allow': 'INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER, NOTIFY',
            'Accept': 'application/sdp',
            'Accept-Encoding': 'identity',
            'Accept-Language': 'en',
            'Supported': 'replaces, timer'
        };
        
        this.sendResponse(request, 200, 'OK', rinfo, additionalHeaders);
        console.log(`[SIPLiveKitBridge] ✅ Responded to OPTIONS with 200 OK`);
    }

    /**
     * Handle NOTIFY request
     */
    async handleNotify(request, rinfo) {
        console.log(`[SIPLiveKitBridge] 📞 Received NOTIFY from ${rinfo.address}:${rinfo.port}`);
        
        // Extract event type from Event header
        const eventHeader = request.headers['event'] || request.headers['Event'];
        console.log(`[SIPLiveKitBridge] 📞 NOTIFY Event: ${eventHeader}`);
        
        // Send 200 OK to acknowledge the NOTIFY
        this.sendResponse(request, 200, 'OK', rinfo);
        console.log(`[SIPLiveKitBridge] ✅ Responded to NOTIFY with 200 OK`);
    }
    
    /**
     * Generate participant token for LiveKit
     */
    async generateParticipantToken(roomName, participantName) {
        const token = new AccessToken(
            this.config.livekitApiKey,
            this.config.livekitApiSecret,
            {
                identity: participantName,
                name: participantName
            }
        );
        
        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true
        });
        
        return await token.toJwt();
    }
    
    /**
     * Generate response SDP
     */
    generateResponseSDP() {
        const sessionId = Date.now();
        const version = sessionId;
        
        return [
            'v=0',
            `o=VoiceAI ${sessionId} ${version} IN IP4 ${this.config.publicIp}`,
            's=VoiceAI SIP Session',
            `c=IN IP4 ${this.config.publicIp}`,
            't=0 0',
            'm=audio 10000 RTP/AVP 0 8',
            'a=rtpmap:0 PCMU/8000',
            'a=rtpmap:8 PCMA/8000',
            'a=sendrecv'
        ].join('\r\n');
    }
    
    /**
     * Send SIP response
     */
    sendResponse(request, statusCode, reasonPhrase, rinfo, additionalHeaders = {}, body = '') {
        const toTag = this.generateTag();
        
        const headers = [
            `SIP/2.0 ${statusCode} ${reasonPhrase}`,
            request.viaHeader ? `Via: ${request.viaHeader}` : '',
            `From: ${request.fromHeader}`,
            `To: ${request.toHeader}${statusCode >= 200 && !request.toTag ? `;tag=${toTag}` : ''}`,
            `Call-ID: ${request.callId}`,
            `CSeq: ${request.cseq}`,
            'User-Agent: VoiceAI-SIP-Bridge/1.0'
        ].filter(h => h);
        
        // Add additional headers
        Object.entries(additionalHeaders).forEach(([key, value]) => {
            headers.push(`${key}: ${value}`);
        });
        
        // Add content length
        headers.push(`Content-Length: ${body.length}`);
        headers.push('');
        
        if (body) {
            headers.push(body);
        }
        
        const response = headers.join('\r\n');
        
        this.sipSocket.send(response, rinfo.port, rinfo.address, (error) => {
            if (error) {
                console.error('[SIPLiveKitBridge] Error sending response:', error);
            } else {
                console.log(`[SIPLiveKitBridge] 📤 Sent ${statusCode} ${reasonPhrase} to ${rinfo.address}:${rinfo.port}`);
            }
        });
    }
    
    /**
     * Generate random tag
     */
    generateTag() {
        return Math.random().toString(36).substring(2, 15);
    }
    
    /**
     * Generate Call-ID
     */
    generateCallId() {
        return Math.random().toString(36).substring(2, 15) + '@' + this.config.publicIp;
    }
    
    /**
     * Generate branch parameter
     */
    generateBranch() {
        return Math.random().toString(36).substring(2, 15);
    }
    
    /**
     * Extract authentication parameter from header
     */
    extractAuthParam(authHeader, param) {
        // First try to match quoted values
        const quotedRegex = new RegExp(`${param}="([^"]+)"`);
        const quotedMatch = authHeader.match(quotedRegex);
        if (quotedMatch) {
            console.log(`[SIPLiveKitBridge] 🔍 Extracted ${param}: "${quotedMatch[1]}"`);
            return quotedMatch[1];
        }
        
        // Fallback to unquoted values
        const unquotedRegex = new RegExp(`${param}=([^\s,]+)`);
        const unquotedMatch = authHeader.match(unquotedRegex);
        if (unquotedMatch) {
            console.log(`[SIPLiveKitBridge] 🔍 Extracted ${param}: ${unquotedMatch[1]}`);
            return unquotedMatch[1];
        }
        
        console.log(`[SIPLiveKitBridge] ⚠️ Could not extract ${param} from: ${authHeader}`);
        return null;
    }
    
    /**
     * MD5 hash function for SIP digest authentication
     */
    md5(str) {
        return crypto.createHash('md5').update(str).digest('hex');
    }
    
    /**
     * Cleanup call resources
     */
    async cleanupCall(callId) {
        const call = this.activeCalls.get(callId);
        if (call) {
            try {
                // Delete LiveKit room
                await this.livekitRoomService.deleteRoom(call.roomName);
                console.log(`[SIPLiveKitBridge] 🗑️ Deleted LiveKit room: ${call.roomName}`);
            } catch (error) {
                console.error(`[SIPLiveKitBridge] Error deleting room ${call.roomName}:`, error);
            }
            
            // Remove from active calls
            this.activeCalls.delete(callId);
            
            // Update session state
            call.session.setState('TERMINATED', 'Call ended');
            
            console.log(`[SIPLiveKitBridge] 🧹 Cleaned up call: ${callId}`);
            
            // Emit call ended event
            this.emit('callEnded', { callId, roomName: call.roomName });
        }
    }
    
    /**
     * Get bridge statistics
     */
    getStats() {
        return {
            activeCalls: this.activeCalls.size,
            totalSessions: this.sessionManager ? this.sessionManager.getStats().totalSessions : 0,
            registrationState: this.registrationState,
            uptime: process.uptime()
        };
    }
    
    /**
     * Shutdown the bridge
     */
    async shutdown() {
        console.log('[SIPLiveKitBridge] 🛑 Shutting down...');
        
        // Unregister from UCM
        if (this.registrationState === 'REGISTERED') {
            await this.unregisterFromUCM();
        }
        
        // Clear registration timer
        if (this.registrationTimer) {
            clearTimeout(this.registrationTimer);
            this.registrationTimer = null;
        }
        
        // Clear health check timer
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        
        // Clear NAT keep-alive timer
        if (this.natKeepAliveInterval) {
            clearInterval(this.natKeepAliveInterval);
            this.natKeepAliveInterval = null;
        }
        
        // Cleanup all active calls
        for (const callId of this.activeCalls.keys()) {
            await this.cleanupCall(callId);
        }
        
        // Close SIP socket
        if (this.sipSocket) {
            this.sipSocket.close();
            this.sipSocket = null;
        }
        
        console.log('[SIPLiveKitBridge] ✅ Shutdown complete');
    }
    
    /**
     * Test call to SIP trunk 16 with message
     */
    async testCallToTrunk16(message = 'Hi from VoiceAI Extension 31') {
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        const callId = this.generateCallId();
        const fromTag = this.generateTag();
        const branch = this.generateBranch();
        
        const inviteMessage = [
            `INVITE sip:16@${sipServerHost} SIP/2.0`,
            `Via: SIP/2.0/UDP ${this.config.publicIp}:${this.config.sipPort};branch=z9hG4bK${branch}`,
            `From: <sip:${this.config.sipAuthUser}@${sipServerHost}>;tag=${fromTag}`,
            `To: <sip:16@${sipServerHost}>`,
            `Call-ID: ${callId}`,
            `CSeq: 1 INVITE`,
            `Contact: <sip:${this.config.sipAuthUser}@${this.config.publicIp}:${this.config.sipPort}>`,
            `Content-Type: application/sdp`,
            `User-Agent: VoiceAI-SIP-Extension/1.0`,
            `Content-Length: 0`,
            '',
            ''
        ].join('\r\n');
        
        console.log(`[SIPLiveKitBridge] 📞 Testing call to SIP trunk 16 with message: "${message}"`);
        console.log(`[SIPLiveKitBridge] 📤 Sending INVITE to 16@${sipServerHost}`);
        
        this.sipSocket.send(inviteMessage, parseInt(sipServerPort), sipServerHost, (error) => {
            if (error) {
                console.error('[SIPLiveKitBridge] Error sending INVITE to trunk 16:', error);
            } else {
                console.log('[SIPLiveKitBridge] ✅ INVITE sent to trunk 16');
            }
        });
        
        return callId;
    }
    
    /**
     * Unregister from UCM server
     */
    async unregisterFromUCM() {
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        this.registrationCSeq++;
        
        const unregisterMessage = [
            `REGISTER sip:${sipServerHost} SIP/2.0`,
            `Via: SIP/2.0/UDP ${this.config.publicIp}:${this.config.sipPort};branch=z9hG4bK${this.generateBranch()}`,
            `From: <sip:${this.config.sipAuthUser}@${sipServerHost}>;tag=${this.generateTag()}`,
            `To: <sip:${this.config.sipAuthUser}@${sipServerHost}>`,
            `Call-ID: ${this.registrationCallId}`,
            `CSeq: ${this.registrationCSeq} REGISTER`,
            `Contact: <sip:${this.config.sipAuthUser}@${this.config.publicIp}:${this.config.sipPort}>`,
            'Expires: 0',
            'User-Agent: VoiceAI-SIP-Extension/1.0',
            'Content-Length: 0',
            '',
            ''
        ].join('\r\n');
        
        console.log('[SIPLiveKitBridge] 📤 Sending UNREGISTER');
        
        this.sipSocket.send(unregisterMessage, parseInt(sipServerPort), sipServerHost, (error) => {
            if (error) {
                console.error('[SIPLiveKitBridge] Error sending UNREGISTER:', error);
            } else {
                console.log('[SIPLiveKitBridge] ✅ UNREGISTER sent');
                this.registrationState = 'UNREGISTERED';
            }
        });
    }
    
    /**
     * Perform comprehensive self-liveness check
     */
    performSelfLivenessCheck() {
        const now = Date.now();
        const checks = {
            socketActive: false,
            registrationValid: false,
            timingHealthy: false,
            networkReachable: false
        };
        
        let issues = [];
        
        // Check 1: Socket is active and bound
        if (this.sipSocket && this.sipSocket._handle) {
            checks.socketActive = true;
        } else {
            issues.push('Socket not active');
        }
        
        // Check 2: Registration state is valid
        if (this.registrationState === 'REGISTERED' && this.lastRegistrationTime) {
            const timeSinceRegistration = now - this.lastRegistrationTime;
            const expiryTime = this.registrationExpires * 1000;
            
            if (timeSinceRegistration < expiryTime) {
                checks.registrationValid = true;
            } else {
                issues.push('Registration expired');
            }
        } else {
            issues.push(`Invalid registration state: ${this.registrationState}`);
        }
        
        // Check 3: Timing is healthy (not stuck)
        if (this.lastRegistrationTime) {
            const timeSinceRegistration = now - this.lastRegistrationTime;
            if (timeSinceRegistration < 30000 || this.registrationState === 'REGISTERED') {
                checks.timingHealthy = true;
            } else {
                issues.push('Timing unhealthy - stuck in registration');
            }
        } else {
            issues.push('No registration timestamp');
        }
        
        // Check 4: Network configuration is reachable
        if (this.config.sipServer && this.localIP && this.sipPort) {
            checks.networkReachable = true;
        } else {
            issues.push('Network configuration incomplete');
        }
        
        const isAlive = Object.values(checks).every(check => check === true);
        const status = isAlive ? 'ALIVE' : 'DEGRADED';
        const message = isAlive ? 'All systems operational' : `Issues: ${issues.join(', ')}`;
        
        
        return {
            isAlive,
            status,
            message,
            checks,
            issues,
            timestamp: now
        };
    }
    
    /**
     * Get comprehensive client status report
     */
    getClientStatus() {
        const livenessCheck = this.performSelfLivenessCheck();
        const now = Date.now();
        const timeSinceRegistration = this.lastRegistrationTime ? now - this.lastRegistrationTime : null;
        
        return {
            liveness: livenessCheck,
            registration: {
                state: this.registrationState,
                lastRegistrationTime: this.lastRegistrationTime,
                timeSinceRegistration: timeSinceRegistration ? Math.floor(timeSinceRegistration / 1000) : null,
                expiresIn: this.registrationExpires ? Math.floor((this.registrationExpires * 1000 - (timeSinceRegistration || 0)) / 1000) : null,
                extension: this.config.sipAuthUser
            },
            network: {
                localIP: this.localIP,
                localPort: this.sipPort,
                sipServer: this.config.sipServer,
                socketActive: this.sipSocket && this.sipSocket._handle ? true : false
            },
            monitoring: {
                healthCheckActive: !!this.healthCheckTimer,
                reRegistrationScheduled: !!this.registrationTimer
            },
            timestamp: now
        };
    }

    /**
     * Send OPTIONS keep-alive to verify connection is active
     */
    sendKeepAlive() {
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        const callId = this.generateCallId();
        
        const optionsMessage = [
            `OPTIONS sip:${sipServerHost} SIP/2.0`,
            `Via: SIP/2.0/UDP ${this.config.publicIp}:${this.config.sipPort};branch=z9hG4bK${this.generateBranch()}`,
            `From: <sip:${this.config.sipAuthUser}@${sipServerHost}>;tag=${this.generateTag()}`,
            `To: <sip:${sipServerHost}>`,
            `Call-ID: ${callId}`,
            `CSeq: 1 OPTIONS`,
            `Contact: <sip:${this.config.sipAuthUser}@${this.config.publicIp}:${this.config.sipPort}>`,
            'User-Agent: VoiceAI-SIP-Extension/1.0',
            'Content-Length: 0',
            '',
            ''
        ].join('\r\n');
        
        console.log('[SIPLiveKitBridge] 📡 Sending keep-alive OPTIONS ping');
        
        this.sipSocket.send(optionsMessage, parseInt(sipServerPort), sipServerHost, (error) => {
            if (error) {
                console.error('[SIPLiveKitBridge] Error sending keep-alive OPTIONS:', error);
            } else {
                console.log('[SIPLiveKitBridge] ✅ Keep-alive OPTIONS sent');
            }
        });
    }
    
    /**
     * Start aggressive NAT keep-alive mechanism
     */
    startNATKeepAlive() {
        // Clear any existing NAT keep-alive
        if (this.natKeepAliveInterval) {
            clearInterval(this.natKeepAliveInterval);
        }
        
        // Send NAT keep-alive packets every 30 seconds (more aggressive than OPTIONS)
        this.natKeepAliveInterval = setInterval(() => {
            this.sendNATKeepAlive();
        }, 30000);
        
        console.log('[SIPLiveKitBridge] 🔄 NAT keep-alive started (30-second intervals)');
        
        // Send initial NAT keep-alive immediately
        setTimeout(() => this.sendNATKeepAlive(), 1000);
    }
    
    /**
     * Send lightweight NAT keep-alive packet to maintain UDP binding
     */
    sendNATKeepAlive() {
        if (!this.sipSocket || this.sipSocket.destroyed) {
            console.warn('[SIPLiveKitBridge] Cannot send NAT keep-alive: socket not available');
            return;
        }
        
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        
        // Send minimal UDP packet to keep NAT binding alive
        const keepAlivePacket = Buffer.from('\r\n\r\n'); // CRLF keep-alive as per RFC 5626
        
        this.sipSocket.send(keepAlivePacket, parseInt(sipServerPort), sipServerHost, (error) => {
            if (error) {
                console.error('[SIPLiveKitBridge] NAT keep-alive error:', error);
                // Attempt socket recovery on persistent errors
                this.handleSocketError(error);
            } else {
                console.log('[SIPLiveKitBridge] 🔄 NAT keep-alive sent');
            }
        });
    }
    
    /**
     * Handle socket errors with recovery attempts
     */
    handleSocketError(error) {
        console.error('[SIPLiveKitBridge] Socket error detected:', error.message);
        
        // Count consecutive errors
        this.socketErrorCount = (this.socketErrorCount || 0) + 1;
        
        if (this.socketErrorCount >= 3) {
            console.warn('[SIPLiveKitBridge] ⚠️ Multiple socket errors detected, attempting recovery');
            this.attemptSocketRecovery();
        }
    }
    
    /**
     * Handle unexpected socket closure
     */
    handleSocketClose() {
        console.warn('[SIPLiveKitBridge] Socket closed, attempting recovery in 5 seconds');
        
        // Clear existing timers
        if (this.natKeepAliveInterval) {
            clearInterval(this.natKeepAliveInterval);
        }
        
        // Attempt to restart socket after delay
        setTimeout(() => {
            this.attemptSocketRecovery();
        }, 5000);
    }
    
    /**
     * Attempt to recover from socket issues
     */
    async attemptSocketRecovery() {
        try {
            console.log('[SIPLiveKitBridge] 🔧 Attempting socket recovery...');
            
            // Close existing socket if still open
            if (this.sipSocket && !this.sipSocket.destroyed) {
                this.sipSocket.close();
            }
            
            // Reset error count
            this.socketErrorCount = 0;
            
            // Restart SIP server
            await this.startSIPServer();
            
            // Re-register with UCM
            setTimeout(() => {
                console.log('[SIPLiveKitBridge] 🔄 Re-registering after socket recovery');
                this.registerWithUCM();
            }, 2000);
            
            console.log('[SIPLiveKitBridge] ✅ Socket recovery completed');
            
        } catch (error) {
            console.error('[SIPLiveKitBridge] Socket recovery failed:', error);
            
            // Schedule another recovery attempt
            setTimeout(() => {
                this.attemptSocketRecovery();
            }, 10000);
        }
    }
}

export { SIPLiveKitBridge };
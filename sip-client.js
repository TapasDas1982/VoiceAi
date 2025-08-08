/**
 * Simplified SIP Client - Core SIP Functionality Only
 * Single responsibility: Handle SIP protocol communication
 */

const dgram = require('dgram');
const EventEmitter = require('events');

class SIPClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.socket = null;
        this.registered = false;
        this.callSequence = 1;
        this.activeCalls = new Map();
        
        // Simple state tracking
        this.state = 'idle';
    }

    /**
     * Handle SIP authentication challenge (401 Unauthorized)
     */
    handleAuthenticationChallenge(response, resolve, reject) {
        try {
            console.log('🔍 Processing authentication challenge...');
            console.log('📋 Using credentials: username=' + this.config.extension + ', password=' + (this.config.password ? '[SET]' : '[NOT SET]'));
            
            // Parse WWW-Authenticate header
            const authHeader = this.extractHeader(response, 'WWW-Authenticate');
            if (!authHeader) {
                reject(new Error('No WWW-Authenticate header found'));
                return;
            }
            
            console.log('🔐 WWW-Authenticate header:', authHeader);

            // Extract authentication parameters
            const realm = this.extractAuthParam(authHeader, 'realm');
            const nonce = this.extractAuthParam(authHeader, 'nonce');
            const algorithm = this.extractAuthParam(authHeader, 'algorithm') || 'MD5';
            const qop = this.extractAuthParam(authHeader, 'qop');
            const opaque = this.extractAuthParam(authHeader, 'opaque');
            
            console.log('🔑 Auth params - realm:', realm, 'nonce:', nonce, 'algorithm:', algorithm, 'qop:', qop, 'opaque:', opaque);
            
            if (!realm || !nonce) {
                reject(new Error('Invalid authentication challenge'));
                return;
            }

            // Generate digest response
            const authData = this.generateDigestAuth(realm, nonce, algorithm, qop);
            let authHeaderValue = `Digest username="${this.config.extension}", realm="${realm}", nonce="${nonce}", uri="sip:${this.config.serverHost}:${this.config.serverPort}", response="${authData.response}", algorithm=${algorithm}`;
            
            // Add qop-specific parameters if required
            if (qop && qop.includes('auth')) {
                authHeaderValue += `, qop=auth, nc=${authData.nc}, cnonce="${authData.cnonce}"`;
            }
            
            // Add opaque if provided
            if (opaque) {
                authHeaderValue += `, opaque="${opaque}"`;
            }
            
            console.log('🔐 Generated auth header:', authHeaderValue);
            
            // Send authenticated REGISTER
            const registerMessage = this.buildRegisterMessage(`Authorization: ${authHeaderValue}`);
            console.log('📤 Sending authenticated REGISTER message');
            this.sendSIPMessage(registerMessage);
            
            // Set up timeout for authenticated response
            const timeout = setTimeout(() => {
                reject(new Error('Authentication timeout'));
            }, 10000);
            
            // Listen for final response
            const onAuthResponse = (authResp) => {
                console.log('📥 Received auth response:', authResp.substring(0, 200) + '...');
                
                if (authResp.includes('200 OK') && authResp.includes('REGISTER')) {
                    clearTimeout(timeout);
                    this.registered = true;
                    console.log('✅ SIP Registration successful with authentication');
                    this.removeListener('sipResponse', onAuthResponse);
                    
                    // Start registration refresh timer (refresh every 300 seconds)
                    this.startRegistrationRefresh();
                    
                    // Start NAT keep-alive mechanism
                    this.startNATKeepAlive();
                    
                    resolve();
                } else if (authResp.includes('403 Forbidden') || authResp.includes('401 Unauthorized')) {
                    clearTimeout(timeout);
                    this.removeListener('sipResponse', onAuthResponse);
                    reject(new Error('Authentication failed - invalid credentials'));
                } else if (authResp.includes('REGISTER')) {
                    console.log('⚠️ Unexpected REGISTER response:', authResp.split('\r\n')[0]);
                }
            };
            
            this.on('sipResponse', onAuthResponse);
            
        } catch (error) {
            reject(new Error(`Authentication error: ${error.message}`));
        }
    }

    /**
     * Extract authentication parameter from WWW-Authenticate header
     */
    extractAuthParam(authHeader, param) {
        // Handle quoted values
        const quotedRegex = new RegExp(`${param}="([^"]+)"`, 'i');
        const quotedMatch = authHeader.match(quotedRegex);
        if (quotedMatch) {
            return quotedMatch[1];
        }
        
        // Handle unquoted values
        const unquotedRegex = new RegExp(`${param}=([^\s,]+)`, 'i');
        const unquotedMatch = authHeader.match(unquotedRegex);
        return unquotedMatch ? unquotedMatch[1] : null;
    }

    /**
     * Generate MD5 digest authentication response
     */
    generateDigestAuth(realm, nonce, algorithm, qop) {
        const crypto = require('crypto');
        
        const username = this.config.extension;
        const password = this.config.password;
        const method = 'REGISTER';
        const uri = `sip:${this.config.serverHost}:${this.config.serverPort}`;
        
        // Calculate HA1 = MD5(username:realm:password)
        const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
        
        // Calculate HA2 = MD5(method:uri)
        const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
        
        let response;
        let nc = '00000001';
        let cnonce = null;
        
        if (qop && qop.includes('auth')) {
            // Generate client nonce
            cnonce = crypto.randomBytes(8).toString('hex');
            
            // Calculate response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
            response = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`).digest('hex');
            
            return { response, nc, cnonce };
        } else {
            // Calculate response = MD5(HA1:nonce:HA2)
            response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
            
            return { response };
        }
    }

    /**
     * Start SIP client and register
     */
    async start() {
        try {
            await this.createSocket();
            await this.register();
            console.log('✅ SIP Client started successfully');
            return true;
        } catch (error) {
            console.error('❌ SIP Client start failed:', error.message);
            return false;
        }
    }

    /**
     * Create UDP socket for SIP communication
     */
    createSocket() {
        return new Promise((resolve, reject) => {
            // Enable TLS for SIP connection
const tlsOptions = {
  rejectUnauthorized: false,
  ALPNProtocols: ['sip/2.0'],
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256'
};
this.socket = dgram.createSocket({
  type: 'udp4',
  reuseAddr: true,
  settings: {
    tls: process.env.SIP_USE_TLS === 'true' ? tlsOptions : null
  }
});
            
            this.socket.on('message', (msg, rinfo) => {
                this.handleSIPMessage(msg.toString(), rinfo);
            });
            
            this.socket.on('error', (err) => {
                console.error('SIP Socket error:', err);
                this.emit('error', err);
            });
            
            this.socket.bind(this.config.localPort, () => {
                console.log(`📞 SIP Client listening on port ${this.config.localPort}`);
                resolve();
            });
        });
    }

    /**
     * Register with SIP server
     */
    async register() {
        // Add SIP authentication headers
const authHeaders = {
  'Proxy-Authorization': `Digest username="${this.config.extension}", realm="sip.domain.com", nonce="", uri="sip:${this.config.serverHost}:${this.config.serverPort}", response=""`,
  'Authorization': `Digest username="${this.config.extension}", realm="sip.domain.com", nonce="", uri="sip:${this.config.serverHost}:${this.config.serverPort}", response=""`
};
const registerMessage = this.buildRegisterMessage(`Authorization: ${authHeaders.Authorization}`);

return new Promise((resolve, reject) => {
    this.sendSIPMessage(registerMessage);
            
            // Simple timeout for registration
            const timeout = setTimeout(() => {
                reject(new Error('Registration timeout'));
            }, 10000); // Increased timeout to 10 seconds
            
            // Listen for registration response
            const onResponse = (response) => {
                if (response.includes('200 OK') && response.includes('REGISTER')) {
                    clearTimeout(timeout);
                    this.registered = true;
                    console.log('✅ SIP Registration successful');
                    this.removeListener('sipResponse', onResponse);
                    
                    // Start registration refresh timer (refresh every 300 seconds)
                    this.startRegistrationRefresh();
                    
                    // Start NAT keep-alive mechanism
                    this.startNATKeepAlive();
                    
                    resolve();
                } else if (response.includes('401 Unauthorized') && response.includes('REGISTER')) {
                    // Handle authentication challenge
                    console.log('🔐 SIP Authentication required, sending credentials...');
                    clearTimeout(timeout);
                    this.removeListener('sipResponse', onResponse);
                    this.handleAuthenticationChallenge(response, resolve, reject);
                }
            };
            
            this.on('sipResponse', onResponse);
        });
    }

    /**
     * Start registration refresh timer
     */
    startRegistrationRefresh() {
        // Clear existing timer if any
        if (this.registrationTimer) {
            clearInterval(this.registrationTimer);
        }
        
        // Refresh registration every 300 seconds (5 minutes)
        this.registrationTimer = setInterval(async () => {
            if (this.registered) {
                console.log('🔄 Refreshing SIP registration...');
                try {
                    await this.refreshRegistration();
                } catch (error) {
                    console.error('❌ Registration refresh failed:', error.message);
                    // Attempt to re-register
                    this.registered = false;
                    setTimeout(() => this.register().catch(console.error), 5000);
                }
            }
        }, 300000); // 300 seconds
    }

    /**
     * Refresh registration
     */
    async refreshRegistration() {
        const registerMessage = this.buildRegisterMessage();
        
        return new Promise((resolve, reject) => {
            this.sendSIPMessage(registerMessage);
            
            const timeout = setTimeout(() => {
                reject(new Error('Registration refresh timeout'));
            }, 10000);
            
            const onResponse = (response) => {
                if (response.includes('200 OK') && response.includes('REGISTER')) {
                    clearTimeout(timeout);
                    console.log('✅ SIP Registration refreshed successfully');
                    this.removeListener('sipResponse', onResponse);
                    resolve();
                } else if (response.includes('401 Unauthorized') && response.includes('REGISTER')) {
                    clearTimeout(timeout);
                    this.removeListener('sipResponse', onResponse);
                    this.handleAuthenticationChallenge(response, resolve, reject);
                }
            };
            
            this.on('sipResponse', onResponse);
        });
    }

    /**
     * Start NAT keep-alive mechanism
     */
    startNATKeepAlive() {
        // Clear existing timer if any
        if (this.natKeepAliveTimer) {
            clearInterval(this.natKeepAliveTimer);
        }
        
        // Send OPTIONS keep-alive every 30 seconds
        this.natKeepAliveTimer = setInterval(() => {
            if (this.registered) {
                this.sendNATKeepAlive();
            }
        }, 30000); // 30 seconds
    }

    /**
     * Send NAT keep-alive OPTIONS message
     */
    sendNATKeepAlive() {
        const optionsMessage = this.buildOptionsMessage();
        this.sendSIPMessage(optionsMessage);
        console.log('📡 NAT keep-alive sent');
    }

    /**
     * Build OPTIONS message for keep-alive
     */
    buildOptionsMessage() {
        const callId = this.generateCallId();
        const branch = this.generateBranch();
        const tag = this.generateTag();
        
        return `OPTIONS sip:${this.config.serverHost}:${this.config.serverPort} SIP/2.0\r\n`
            + `Via: SIP/2.0/UDP ${this.config.localHost}:${this.config.localPort};branch=z9hG4bK${branch}\r\n`
            + `Max-Forwards: 70\r\n`
            + `To: <sip:${this.config.serverHost}:${this.config.serverPort}>\r\n`
            + `From: <sip:${this.config.extension}@${this.config.serverHost}>;tag=${tag}\r\n`
            + `Call-ID: ${callId}\r\n`
            + `CSeq: 1 OPTIONS\r\n`
            + `Contact: <sip:${this.config.extension}@${this.config.localHost}:${this.config.localPort}>\r\n`
            + `User-Agent: VoiceAI SIP Client\r\n`
            + `Content-Length: 0\r\n\r\n`;
    }

    /**
     * Handle incoming SIP messages
     */
    handleSIPMessage(message, rinfo) {
        console.log(`📨 SIP Message from ${rinfo.address}:${rinfo.port}`);
        
        try {
            // Parse message type
            const lines = message.split('\r\n');
            const firstLine = lines[0];
            
            if (firstLine.startsWith('SIP/2.0')) {
                // Response message
                this.handleSIPResponse(message, rinfo);
            } else {
                // Request message
                this.handleSIPRequest(message, rinfo);
            }
        } catch (error) {
            console.error('Error parsing SIP message:', error);
        }
    }

    /**
     * Handle SIP responses
     */
    handleSIPResponse(message, rinfo) {
        console.log('📥 SIP Response received');
        this.emit('sipResponse', message);
        
        // Extract status code
        const statusMatch = message.match(/SIP\/2\.0 (\d+)/);
        if (statusMatch) {
            const statusCode = parseInt(statusMatch[1]);
            this.emit('sipStatus', statusCode, message);
        }
    }

    /**
     * Handle SIP requests
     */
    handleSIPRequest(message, rinfo) {
        const lines = message.split('\r\n');
        const requestLine = lines[0];
        const method = requestLine.split(' ')[0];
        
        console.log(`📞 SIP ${method} request received`);
        
        switch (method) {
            case 'INVITE':
                this.handleInvite(message, rinfo);
                break;
            case 'ACK':
                this.handleAck(message, rinfo);
                break;
            case 'BYE':
                this.handleBye(message, rinfo);
                break;
            case 'CANCEL':
                this.handleCancel(message, rinfo);
                break;
            case 'OPTIONS':
                this.handleOptions(message, rinfo);
                break;
            case 'NOTIFY':
                this.handleNotify(message, rinfo);
                break;
            default:
                console.log(`Unhandled SIP method: ${method}`);
        }
    }

    /**
     * Handle INVITE (incoming call)
     */
    handleInvite(message, rinfo) {
        console.log('📞 Incoming call (INVITE)');
        
        // Extract call ID
        const callIdMatch = message.match(/Call-ID: (.+)/);
        const callId = callIdMatch ? callIdMatch[1].trim() : null;
        
        if (callId) {
            this.activeCalls.set(callId, {
                state: 'ringing',
                remoteAddress: rinfo.address,
                remotePort: rinfo.port,
                startTime: Date.now()
            });
            
            // Step 1: Send 100 Trying (provisional response)
            const tryingResponse = this.build100TryingResponse(message);
            this.sendSIPMessage(tryingResponse, rinfo);
            console.log('📤 Sent 100 Trying response');
            
            // Step 2: Send 180 Ringing (provisional response)
            setTimeout(() => {
                const ringingResponse = this.build180RingingResponse(message);
                this.sendSIPMessage(ringingResponse, rinfo);
                console.log('📤 Sent 180 Ringing response');
            }, 100);
            
            // Step 3: Send 200 OK response (final response)
            setTimeout(() => {
                const response = this.buildOkResponse(message);
                this.sendSIPMessage(response, rinfo);
                console.log('📤 Sent 200 OK response');
                
                // Emit call event for AI processing
                this.emit('incomingCall', callId, message);
            }, 500);
        }
    }

    /**
     * Handle ACK (call confirmation)
     */
    handleAck(message, rinfo) {
        console.log('📞 Call confirmed (ACK)');
        
        // Extract call ID
        const callIdMatch = message.match(/Call-ID: (.+)/);
        const callId = callIdMatch ? callIdMatch[1].trim() : null;
        
        if (callId && this.activeCalls.has(callId)) {
            const call = this.activeCalls.get(callId);
            call.state = 'established';
            this.activeCalls.set(callId, call);
            this.emit('callEstablished', callId, message);
        }
    }

    /**
     * Handle BYE (call termination)
     */
    handleBye(message, rinfo) {
        console.log('📞 Call termination (BYE)');
        
        const callIdMatch = message.match(/Call-ID: (.+)/);
        const callId = callIdMatch ? callIdMatch[1].trim() : null;
        
        if (callId && this.activeCalls.has(callId)) {
            this.activeCalls.delete(callId);
            
            // Send 200 OK response
            const response = this.buildOkResponse(message);
            this.sendSIPMessage(response, rinfo);
            
            this.emit('callEnded', callId);
        }
    }

    /**
     * Handle CANCEL (call cancellation)
     */
    handleCancel(message, rinfo) {
        console.log('📞 Call cancellation (CANCEL)');
        
        // Extract call ID
        const callIdMatch = message.match(/Call-ID: (.+)/);
        const callId = callIdMatch ? callIdMatch[1].trim() : null;
        
        if (callId && this.activeCalls.has(callId)) {
            const callInfo = this.activeCalls.get(callId);
            console.log(`📞 Cancelling call ${callId}`);
            
            // Send 200 OK response to CANCEL
            const response = this.buildOkResponse(message);
            this.sendSIPMessage(response, rinfo);
            
            // Send 487 Request Terminated to original INVITE
            const cancelResponse = this.build487Response(message);
            this.sendSIPMessage(cancelResponse, rinfo);
            
            // Clean up call
            this.activeCalls.delete(callId);
            
            // Emit call cancelled event
            this.emit('callCancelled', callId);
        }
    }

    /**
     * Handle OPTIONS (capability check)
     */
    handleOptions(message, rinfo) {
        const response = this.buildOkResponse(message);
        this.sendSIPMessage(response, rinfo);
    }

    /**
     * Handle NOTIFY (notifications)
     */
    handleNotify(message, rinfo) {
        const response = this.buildOkResponse(message);
        this.sendSIPMessage(response, rinfo);
    }

    /**
     * Build REGISTER message
     */
    buildRegisterMessage(authHeader = null) {
        const callId = this.generateCallId();
        const tag = this.generateTag();
        
        const headers = [
            `REGISTER sip:${this.config.serverHost}:${this.config.serverPort} SIP/2.0`,
            `Via: SIP/2.0/UDP ${this.config.localHost}:${this.config.localPort};branch=z9hG4bK${this.generateBranch()}`,
            `From: <sip:${this.config.extension}@${this.config.serverHost}>;tag=${tag}`,
            `To: <sip:${this.config.extension}@${this.config.serverHost}>`,
            `Call-ID: ${callId}`,
            `CSeq: ${this.callSequence++} REGISTER`,
            `Contact: <sip:${this.config.extension}@${this.config.localHost}:${this.config.localPort}>`,
            `Expires: 3600`
        ];
        
        // Add authorization header if provided
        if (authHeader) {
            headers.push(authHeader);
        }
        
        headers.push('Content-Length: 0');
        headers.push('');
        headers.push('');
        
        return headers.join('\r\n');
    }

    /**
     * Build 100 Trying response
     */
    build100TryingResponse(originalMessage) {
        const via = this.extractHeader(originalMessage, 'Via');
        const from = this.extractHeader(originalMessage, 'From');
        const to = this.extractHeader(originalMessage, 'To');
        const callId = this.extractHeader(originalMessage, 'Call-ID');
        const cseq = this.extractHeader(originalMessage, 'CSeq');
        
        return [
            'SIP/2.0 100 Trying',
            `Via: ${via}`,
            `From: ${from}`,
            `To: ${to}`,
            `Call-ID: ${callId}`,
            `CSeq: ${cseq}`,
            `Content-Length: 0`,
            '',
            ''
        ].join('\r\n');
    }

    /**
     * Build 180 Ringing response
     */
    build180RingingResponse(originalMessage) {
        const via = this.extractHeader(originalMessage, 'Via');
        const from = this.extractHeader(originalMessage, 'From');
        const to = this.extractHeader(originalMessage, 'To');
        const callId = this.extractHeader(originalMessage, 'Call-ID');
        const cseq = this.extractHeader(originalMessage, 'CSeq');
        
        return [
            'SIP/2.0 180 Ringing',
            `Via: ${via}`,
            `From: ${from}`,
            `To: ${to}`,
            `Call-ID: ${callId}`,
            `CSeq: ${cseq}`,
            `Content-Length: 0`,
            '',
            ''
        ].join('\r\n');
    }

    /**
     * Build 200 OK response
     */
    buildOkResponse(originalMessage) {
        const lines = originalMessage.split('\r\n');
        const requestLine = lines[0];
        const method = requestLine.split(' ')[0];
        
        // Extract headers we need
        const via = this.extractHeader(originalMessage, 'Via');
        const from = this.extractHeader(originalMessage, 'From');
        const to = this.extractHeader(originalMessage, 'To');
        const callId = this.extractHeader(originalMessage, 'Call-ID');
        const cseq = this.extractHeader(originalMessage, 'CSeq');
        
        // Generate SDP response for media negotiation
        const localIP = this.getLocalIP();
        const rtpPort = 8000; // Our RTP port
        
        const sdpBody = [
            'v=0',
            `o=- ${Date.now()} ${Date.now()} IN IP4 ${localIP}`,
            's=VoiceAI Session',
            `c=IN IP4 ${localIP}`,
            't=0 0',
            `m=audio ${rtpPort} RTP/AVP 0`,
            'a=rtpmap:0 PCMU/8000',
            'a=sendrecv'
        ].join('\r\n');
        
        return [
            'SIP/2.0 200 OK',
            `Via: ${via}`,
            `From: ${from}`,
            `To: ${to};tag=${this.generateTag()}`,
            `Call-ID: ${callId}`,
            `CSeq: ${cseq}`,
            'Content-Type: application/sdp',
            `Content-Length: ${sdpBody.length}`,
            '',
            sdpBody
        ].join('\r\n');
    }

    /**
     * Send SIP message
     */
    sendSIPMessage(message, target = null) {
        const host = target ? target.address : this.config.serverHost;
        const port = target ? target.port : this.config.serverPort;
        
        this.socket.send(message, port, host, (err) => {
            if (err) {
                console.error('Failed to send SIP message:', err);
            }
        });
    }

    /**
     * Build 487 Request Terminated response
     */
    build487Response(originalMessage) {
        const lines = originalMessage.split('\r\n');
        const requestLine = lines[0];
        const method = requestLine.split(' ')[0];
        
        // Extract headers we need
        const via = this.extractHeader(originalMessage, 'Via');
        const from = this.extractHeader(originalMessage, 'From');
        const to = this.extractHeader(originalMessage, 'To');
        const callId = this.extractHeader(originalMessage, 'Call-ID');
        const cseq = this.extractHeader(originalMessage, 'CSeq');
        
        return [
            'SIP/2.0 487 Request Terminated',
            `Via: ${via}`,
            `From: ${from}`,
            `To: ${to};tag=${this.generateTag()}`,
            `Call-ID: ${callId}`,
            `CSeq: ${cseq}`,
            'Content-Length: 0',
            '',
            ''
        ].join('\r\n');
    }

    /**
     * Get local IP address
     */
    getLocalIP() {
        const os = require('os');
        const interfaces = os.networkInterfaces();
        
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1'; // Fallback
    }

    /**
     * Extract header value from SIP message
     */
    extractHeader(message, headerName) {
        const regex = new RegExp(`${headerName}: (.+)`, 'i');
        const match = message.match(regex);
        return match ? match[1].trim() : '';
    }

    /**
     * Generate unique identifiers
     */
    generateCallId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@${this.config.localHost}`;
    }

    generateTag() {
        return Math.random().toString(36).substr(2, 8);
    }

    generateBranch() {
        return Math.random().toString(36).substr(2, 10);
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            registered: this.registered,
            activeCalls: this.activeCalls.size,
            state: this.state
        };
    }

    /**
     * Stop SIP client
     */
    stop() {
        // Clear timers
        if (this.registrationTimer) {
            clearInterval(this.registrationTimer);
            this.registrationTimer = null;
        }
        
        if (this.natKeepAliveTimer) {
            clearInterval(this.natKeepAliveTimer);
            this.natKeepAliveTimer = null;
        }
        
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.registered = false;
        this.activeCalls.clear();
        console.log('📞 SIP Client stopped');
    }
}

module.exports = SIPClient;
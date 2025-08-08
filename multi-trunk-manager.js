const EventEmitter = require('events');
const dgram = require('dgram');
const crypto = require('crypto');
const { EnhancedSIPParser } = require('./sip-parser-enhanced');
const { SIPSessionManager } = require('./sip-session');

/**
 * SIP Trunk Configuration
 */
class SIPTrunk {
    constructor(name, config) {
        this.name = name;
        this.config = {
            server: config.server,
            port: config.port || 5060,
            username: config.username,
            password: config.password,
            domain: config.domain || config.server,
            transport: config.transport || 'UDP',
            registrationInterval: config.registrationInterval || 3600,
            enabled: config.enabled !== false,
            priority: config.priority || 1,
            weight: config.weight || 1,
            ...config
        };
        
        this.state = 'DISCONNECTED';
        this.registrationState = 'UNREGISTERED';
        this.lastRegistration = null;
        this.registrationTimer = null;
        this.stats = {
            totalCalls: 0,
            activeCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            registrationAttempts: 0,
            lastError: null
        };
        
        console.log(`[SIPTrunk] Created trunk '${this.name}' -> ${this.config.server}:${this.config.port}`);
    }

    /**
     * Get trunk status
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            registrationState: this.registrationState,
            lastRegistration: this.lastRegistration,
            config: {
                server: this.config.server,
                port: this.config.port,
                username: this.config.username,
                enabled: this.config.enabled
            },
            stats: { ...this.stats }
        };
    }

    /**
     * Update trunk statistics
     */
    updateStats(event, data = {}) {
        switch (event) {
            case 'call_started':
                this.stats.totalCalls++;
                this.stats.activeCalls++;
                break;
            case 'call_ended':
                this.stats.activeCalls = Math.max(0, this.stats.activeCalls - 1);
                if (data.successful) {
                    this.stats.successfulCalls++;
                } else {
                    this.stats.failedCalls++;
                }
                break;
            case 'registration_attempt':
                this.stats.registrationAttempts++;
                break;
            case 'error':
                this.stats.lastError = {
                    message: data.message,
                    timestamp: new Date()
                };
                break;
        }
    }

    /**
     * Check if trunk is available for calls
     */
    isAvailable() {
        return this.config.enabled && 
               this.state === 'CONNECTED' && 
               this.registrationState === 'REGISTERED';
    }

    /**
     * Get trunk priority score (higher is better)
     */
    getPriorityScore() {
        if (!this.isAvailable()) return 0;
        
        // Base score from configuration
        let score = this.config.priority * 100;
        
        // Adjust based on current load
        const loadFactor = this.stats.activeCalls / (this.config.maxConcurrentCalls || 10);
        score *= (1 - loadFactor * 0.5);
        
        // Adjust based on success rate
        const totalAttempts = this.stats.successfulCalls + this.stats.failedCalls;
        if (totalAttempts > 0) {
            const successRate = this.stats.successfulCalls / totalAttempts;
            score *= successRate;
        }
        
        return Math.max(0, score);
    }
}

/**
 * Call Routing Rules
 */
class CallRoutingRule {
    constructor(config) {
        this.id = config.id || crypto.randomBytes(8).toString('hex');
        this.name = config.name || `Rule ${this.id}`;
        this.priority = config.priority || 1;
        this.enabled = config.enabled !== false;
        
        // Matching criteria
        this.criteria = {
            callerPattern: config.callerPattern, // Regex for caller number
            calleePattern: config.calleePattern, // Regex for called number
            timeRange: config.timeRange, // Time-based routing
            sourceIP: config.sourceIP, // Source IP restrictions
            userAgent: config.userAgent // User-Agent matching
        };
        
        // Routing actions
        this.actions = {
            targetTrunk: config.targetTrunk,
            requiresAI: config.requiresAI || false,
            autoAnswer: config.autoAnswer || false,
            recordCall: config.recordCall || false,
            addHeaders: config.addHeaders || {},
            rewriteCallee: config.rewriteCallee,
            rewriteCaller: config.rewriteCaller
        };
        
        console.log(`[CallRoutingRule] Created rule '${this.name}' (priority: ${this.priority})`);
    }

    /**
     * Check if call matches this rule
     */
    matches(callInfo) {
        // Check caller pattern
        if (this.criteria.callerPattern) {
            const callerRegex = new RegExp(this.criteria.callerPattern);
            if (!callerRegex.test(callInfo.caller)) {
                return false;
            }
        }
        
        // Check callee pattern
        if (this.criteria.calleePattern) {
            const calleeRegex = new RegExp(this.criteria.calleePattern);
            if (!calleeRegex.test(callInfo.callee)) {
                return false;
            }
        }
        
        // Check time range
        if (this.criteria.timeRange) {
            const now = new Date();
            const currentTime = now.getHours() * 100 + now.getMinutes();
            if (currentTime < this.criteria.timeRange.start || 
                currentTime > this.criteria.timeRange.end) {
                return false;
            }
        }
        
        // Check source IP
        if (this.criteria.sourceIP) {
            if (!this.ipMatches(callInfo.sourceIP, this.criteria.sourceIP)) {
                return false;
            }
        }
        
        // Check User-Agent
        if (this.criteria.userAgent) {
            const uaRegex = new RegExp(this.criteria.userAgent);
            if (!uaRegex.test(callInfo.userAgent || '')) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Check if IP matches pattern
     */
    ipMatches(ip, pattern) {
        if (pattern.includes('/')) {
            // CIDR notation
            return this.ipInCIDR(ip, pattern);
        } else {
            // Exact match or wildcard
            return ip === pattern || pattern === '*';
        }
    }

    /**
     * Check if IP is in CIDR range
     */
    ipInCIDR(ip, cidr) {
        const [network, prefixLength] = cidr.split('/');
        const mask = (0xffffffff << (32 - parseInt(prefixLength))) >>> 0;
        
        const ipInt = this.ipToInt(ip);
        const networkInt = this.ipToInt(network);
        
        return (ipInt & mask) === (networkInt & mask);
    }

    /**
     * Convert IP address to integer
     */
    ipToInt(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    }
}

/**
 * Multi-Trunk Manager
 * Handles multiple SIP trunks and call routing
 */
class MultiTrunkManager extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            localPort: config.localPort || 5060,
            localAddress: config.localAddress || '0.0.0.0',
            maxConcurrentCalls: config.maxConcurrentCalls || 100,
            callTimeout: config.callTimeout || 30000,
            registrationRetryInterval: config.registrationRetryInterval || 60000,
            ...config
        };
        
        this.trunks = new Map();
        this.routingRules = [];
        this.activeCalls = new Map();
        this.sessionManager = new SIPSessionManager();
        this.parser = new EnhancedSIPParser();
        this.socket = null;
        this.state = 'STOPPED';
        
        // Statistics
        this.stats = {
            totalCalls: 0,
            activeCalls: 0,
            routedCalls: 0,
            failedCalls: 0,
            startTime: new Date()
        };
        
        console.log('[MultiTrunkManager] Initialized');
    }

    /**
     * Add SIP trunk
     */
    addTrunk(name, config) {
        if (this.trunks.has(name)) {
            throw new Error(`Trunk '${name}' already exists`);
        }
        
        const trunk = new SIPTrunk(name, config);
        this.trunks.set(name, trunk);
        
        console.log(`[MultiTrunkManager] Added trunk '${name}'`);
        this.emit('trunkAdded', name, trunk);
        
        return trunk;
    }

    /**
     * Remove SIP trunk
     */
    removeTrunk(name) {
        const trunk = this.trunks.get(name);
        if (!trunk) {
            return false;
        }
        
        // Stop registration timer
        if (trunk.registrationTimer) {
            clearInterval(trunk.registrationTimer);
        }
        
        this.trunks.delete(name);
        console.log(`[MultiTrunkManager] Removed trunk '${name}'`);
        this.emit('trunkRemoved', name);
        
        return true;
    }

    /**
     * Add routing rule
     */
    addRoutingRule(config) {
        const rule = new CallRoutingRule(config);
        this.routingRules.push(rule);
        
        // Sort rules by priority (higher first)
        this.routingRules.sort((a, b) => b.priority - a.priority);
        
        console.log(`[MultiTrunkManager] Added routing rule '${rule.name}'`);
        this.emit('routingRuleAdded', rule);
        
        return rule;
    }

    /**
     * Remove routing rule
     */
    removeRoutingRule(ruleId) {
        const index = this.routingRules.findIndex(rule => rule.id === ruleId);
        if (index === -1) {
            return false;
        }
        
        const rule = this.routingRules.splice(index, 1)[0];
        console.log(`[MultiTrunkManager] Removed routing rule '${rule.name}'`);
        this.emit('routingRuleRemoved', rule);
        
        return true;
    }

    /**
     * Start multi-trunk manager
     */
    async start() {
        if (this.state === 'RUNNING') {
            console.log('[MultiTrunkManager] Already running');
            return;
        }
        
        try {
            // Create UDP socket
            this.socket = dgram.createSocket('udp4');
            
            this.socket.on('message', (msg, rinfo) => {
                this.handleIncomingMessage(msg.toString(), rinfo);
            });
            
            this.socket.on('error', (error) => {
                console.error('[MultiTrunkManager] Socket error:', error);
                this.emit('error', error);
            });
            
            // Bind socket
            await new Promise((resolve, reject) => {
                this.socket.bind(this.config.localPort, this.config.localAddress, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            
            this.state = 'RUNNING';
            console.log(`[MultiTrunkManager] Started on ${this.config.localAddress}:${this.config.localPort}`);
            
            // Register all trunks
            for (const trunk of this.trunks.values()) {
                if (trunk.config.enabled) {
                    this.registerTrunk(trunk);
                }
            }
            
            this.emit('started');
            
        } catch (error) {
            console.error('[MultiTrunkManager] Failed to start:', error);
            this.state = 'ERROR';
            throw error;
        }
    }

    /**
     * Stop multi-trunk manager
     */
    async stop() {
        if (this.state === 'STOPPED') {
            return;
        }
        
        this.state = 'STOPPING';
        console.log('[MultiTrunkManager] Stopping...');
        
        // Unregister all trunks
        for (const trunk of this.trunks.values()) {
            if (trunk.registrationTimer) {
                clearInterval(trunk.registrationTimer);
            }
        }
        
        // Terminate active calls
        for (const callId of this.activeCalls.keys()) {
            this.terminateCall(callId, 'Service Unavailable');
        }
        
        // Close socket
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        
        // Shutdown session manager
        this.sessionManager.shutdown();
        
        this.state = 'STOPPED';
        console.log('[MultiTrunkManager] Stopped');
        this.emit('stopped');
    }

    /**
     * Register trunk with SIP server
     */
    async registerTrunk(trunk) {
        try {
            trunk.updateStats('registration_attempt');
            
            const registerMessage = this.createRegisterMessage(trunk);
            
            await this.sendMessage(registerMessage, {
                address: trunk.config.server,
                port: trunk.config.port
            });
            
            trunk.state = 'CONNECTING';
            console.log(`[MultiTrunkManager] Sent REGISTER for trunk '${trunk.name}'`);
            
            // Set up registration refresh timer
            if (trunk.registrationTimer) {
                clearInterval(trunk.registrationTimer);
            }
            
            trunk.registrationTimer = setInterval(() => {
                this.registerTrunk(trunk);
            }, trunk.config.registrationInterval * 1000);
            
        } catch (error) {
            console.error(`[MultiTrunkManager] Registration failed for trunk '${trunk.name}':`, error);
            trunk.updateStats('error', { message: error.message });
            trunk.state = 'ERROR';
        }
    }

    /**
     * Create REGISTER message
     */
    createRegisterMessage(trunk) {
        const callId = crypto.randomBytes(16).toString('hex');
        const branch = 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
        
        const headers = {
            'Via': `SIP/2.0/UDP ${this.config.localAddress}:${this.config.localPort};branch=${branch}`,
            'From': `<sip:${trunk.config.username}@${trunk.config.domain}>;tag=${crypto.randomBytes(8).toString('hex')}`,
            'To': `<sip:${trunk.config.username}@${trunk.config.domain}>`,
            'Call-ID': callId,
            'CSeq': '1 REGISTER',
            'Contact': `<sip:${trunk.config.username}@${this.config.localAddress}:${this.config.localPort}>`,
            'Expires': trunk.config.registrationInterval.toString(),
            'User-Agent': 'VoiceAI-MultiTrunk/1.0',
            'Max-Forwards': '70'
        };
        
        const uri = `sip:${trunk.config.domain}`;
        return this.parser.generateRequest('REGISTER', uri, headers);
    }

    /**
     * Handle incoming SIP message
     */
    handleIncomingMessage(rawMessage, rinfo) {
        try {
            const message = this.parser.parseMessage(rawMessage);
            
            if (!message.parsed) {
                console.warn('[MultiTrunkManager] Failed to parse message from', rinfo.address);
                return;
            }
            
            console.log(`[MultiTrunkManager] Received ${this.parser.getMessageSummary(message)} from ${rinfo.address}:${rinfo.port}`);
            
            // Handle based on message type
            if (message.method) {
                this.handleRequest(message, rinfo);
            } else if (message.status) {
                this.handleResponse(message, rinfo);
            }
            
        } catch (error) {
            console.error('[MultiTrunkManager] Message handling error:', error);
        }
    }

    /**
     * Handle SIP request
     */
    handleRequest(message, rinfo) {
        switch (message.method) {
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
            case 'REFER':
                this.handleRefer(message, rinfo);
                break;
            default:
                console.log(`[MultiTrunkManager] Unhandled method: ${message.method}`);
                this.sendResponse(message, 405, 'Method Not Allowed', {}, '', rinfo);
        }
    }

    /**
     * Handle SIP response
     */
    handleResponse(message, rinfo) {
        // Handle registration responses
        if (message.cseq?.method === 'REGISTER') {
            this.handleRegisterResponse(message, rinfo);
            return;
        }
        
        // Handle call-related responses
        const session = this.sessionManager.getSession(message.callId);
        if (session) {
            this.handleCallResponse(message, session, rinfo);
        }
    }

    /**
     * Handle INVITE request
     */
    async handleInvite(message, rinfo) {
        try {
            // Extract call information
            const callInfo = {
                caller: this.extractNumber(message.headers.from),
                callee: this.extractNumber(message.headers.to),
                sourceIP: rinfo.address,
                userAgent: message.headers['user-agent'] || '',
                callId: message.callId
            };
            
            console.log(`[MultiTrunkManager] Incoming call: ${callInfo.caller} -> ${callInfo.callee}`);
            
            // Find matching routing rule
            const routingRule = this.findRoutingRule(callInfo);
            
            if (!routingRule) {
                console.log('[MultiTrunkManager] No routing rule found, rejecting call');
                this.sendResponse(message, 404, 'Not Found', {}, '', rinfo);
                return;
            }
            
            console.log(`[MultiTrunkManager] Matched routing rule: ${routingRule.name}`);
            
            // Create session
            const session = this.sessionManager.createSession(message.callId);
            session.setState('PROCEEDING', 'INVITE received');
            
            // Store call info
            this.activeCalls.set(message.callId, {
                callInfo,
                routingRule,
                session,
                sourceRinfo: rinfo,
                startTime: new Date()
            });
            
            this.stats.totalCalls++;
            this.stats.activeCalls++;
            
            // Send 100 Trying
            this.sendResponse(message, 100, 'Trying', {}, '', rinfo);
            
            // Route call based on rule
            if (routingRule.actions.requiresAI) {
                this.routeToAI(message, callInfo, routingRule, rinfo);
            } else {
                this.routeToTrunk(message, callInfo, routingRule, rinfo);
            }
            
        } catch (error) {
            console.error('[MultiTrunkManager] INVITE handling error:', error);
            this.sendResponse(message, 500, 'Internal Server Error', {}, '', rinfo);
        }
    }

    /**
     * Route call to AI processing
     */
    routeToAI(message, callInfo, routingRule, rinfo) {
        console.log(`[MultiTrunkManager] Routing call ${callInfo.callId} to AI`);
        
        // Send to main VoiceAI handler
        this.emit('routeToAI', {
            message,
            callInfo,
            routingRule,
            rinfo
        });
    }

    /**
     * Route call to another trunk
     */
    async routeToTrunk(message, callInfo, routingRule, rinfo) {
        try {
            const targetTrunk = this.selectTrunk(routingRule.actions.targetTrunk);
            
            if (!targetTrunk || !targetTrunk.isAvailable()) {
                console.log('[MultiTrunkManager] No available trunk for routing');
                this.sendResponse(message, 503, 'Service Unavailable', {}, '', rinfo);
                return;
            }
            
            console.log(`[MultiTrunkManager] Routing call ${callInfo.callId} to trunk '${targetTrunk.name}'`);
            
            // Modify headers for outbound call
            const modifiedMessage = this.modifyMessageForRouting(message, callInfo, routingRule);
            
            // Send INVITE to target trunk
            await this.sendMessage(modifiedMessage, {
                address: targetTrunk.config.server,
                port: targetTrunk.config.port
            });
            
            targetTrunk.updateStats('call_started');
            this.stats.routedCalls++;
            
            console.log(`[MultiTrunkManager] Call routed to ${targetTrunk.config.server}`);
            
        } catch (error) {
            console.error('[MultiTrunkManager] Trunk routing error:', error);
            this.sendResponse(message, 500, 'Internal Server Error', {}, '', rinfo);
        }
    }

    /**
     * Find matching routing rule
     */
    findRoutingRule(callInfo) {
        for (const rule of this.routingRules) {
            if (rule.enabled && rule.matches(callInfo)) {
                return rule;
            }
        }
        return null;
    }

    /**
     * Select best available trunk
     */
    selectTrunk(trunkName) {
        if (trunkName) {
            // Specific trunk requested
            return this.trunks.get(trunkName);
        }
        
        // Select best available trunk based on priority and load
        let bestTrunk = null;
        let bestScore = 0;
        
        for (const trunk of this.trunks.values()) {
            const score = trunk.getPriorityScore();
            if (score > bestScore) {
                bestScore = score;
                bestTrunk = trunk;
            }
        }
        
        return bestTrunk;
    }

    /**
     * Extract phone number from SIP URI
     */
    extractNumber(sipUri) {
        const match = sipUri.match(/<sip:([^@>]+)/);
        return match ? match[1] : sipUri;
    }

    /**
     * Send SIP message
     */
    async sendMessage(message, target) {
        return new Promise((resolve, reject) => {
            this.socket.send(message, target.port, target.address, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Send SIP response
     */
    sendResponse(request, statusCode, reasonPhrase, headers, body, rinfo) {
        const response = this.parser.generateResponse(request, statusCode, reasonPhrase, headers, body);
        this.sendMessage(response, { address: rinfo.address, port: rinfo.port });
    }

    /**
     * Get manager statistics
     */
    getStats() {
        const trunkStats = {};
        for (const [name, trunk] of this.trunks) {
            trunkStats[name] = trunk.getStatus();
        }
        
        return {
            manager: {
                ...this.stats,
                uptime: new Date() - this.stats.startTime,
                state: this.state
            },
            trunks: trunkStats,
            sessions: this.sessionManager.getStats(),
            routingRules: this.routingRules.length
        };
    }
}

module.exports = {
    MultiTrunkManager,
    SIPTrunk,
    CallRoutingRule
};
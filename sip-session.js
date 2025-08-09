import { EventEmitter } from 'events';
import crypto from 'crypto';

/**
 * SIP Session State Machine
 * Implements RFC 3261 session states and transitions
 */
class SIPSession extends EventEmitter {
    constructor(callId, localTag = null, remoteTag = null) {
        super();
        this.callId = callId;
        this.localTag = localTag || this.generateTag();
        this.remoteTag = remoteTag;
        this.state = 'IDLE';
        this.dialog = null;
        this.media = {
            localSdp: null,
            remoteSdp: null,
            rtpPort: null,
            codec: 'PCMU'
        };
        this.timers = new Map();
        this.transactions = new Map();
        this.sessionExpires = 1800; // 30 minutes default
        this.createdAt = new Date();
        this.lastActivity = new Date();
        
        console.log(`[SIPSession] Created session ${this.callId} with local tag ${this.localTag}`);
    }

    /**
     * Generate a unique tag for SIP dialog identification
     */
    generateTag() {
        return crypto.randomBytes(8).toString('hex');
    }

    /**
     * Set session state with proper validation and logging
     */
    setState(newState, reason = '') {
        const validTransitions = {
            'IDLE': ['CALLING', 'PROCEEDING', 'TERMINATED'],
            'CALLING': ['PROCEEDING', 'CONFIRMED', 'TERMINATED'],
            'PROCEEDING': ['CONFIRMED', 'TERMINATED'],
            'CONFIRMED': ['MEDIA_READY', 'TERMINATED'],
            'MEDIA_READY': ['AI_ACTIVE', 'TERMINATED'],
            'AI_ACTIVE': ['TERMINATED'],
            'TERMINATED': []
        };

        if (!validTransitions[this.state]?.includes(newState)) {
            console.warn(`[SIPSession] Invalid state transition: ${this.state} -> ${newState}`);
            return false;
        }

        const oldState = this.state;
        this.state = newState;
        this.lastActivity = new Date();
        
        console.log(`[SIPSession] ${this.callId}: ${oldState} -> ${newState} ${reason ? `(${reason})` : ''}`);
        this.emit('stateChanged', { oldState, newState, reason });

        // Handle state-specific actions
        switch (newState) {
            case 'CONFIRMED':
                this.startSessionTimer();
                this.validateMediaReadiness();
                break;
            case 'MEDIA_READY':
                this.emit('mediaReady');
                break;
            case 'AI_ACTIVE':
                this.emit('aiActivated');
                break;
            case 'TERMINATED':
                this.cleanup();
                break;
        }

        return true;
    }

    /**
     * Start session timer for session refresh (RFC 4028)
     */
    startSessionTimer() {
        if (this.timers.has('session')) {
            clearTimeout(this.timers.get('session'));
        }

        const timer = setTimeout(() => {
            console.log(`[SIPSession] Session timer expired for ${this.callId}, sending re-INVITE`);
            this.emit('sessionTimerExpired');
        }, (this.sessionExpires - 30) * 1000); // Refresh 30 seconds before expiry

        this.timers.set('session', timer);
        console.log(`[SIPSession] Session timer started for ${this.sessionExpires}s`);
    }

    /**
     * Update session expiry time
     */
    updateSessionExpires(expires) {
        this.sessionExpires = expires;
        if (this.state === 'CONFIRMED') {
            this.startSessionTimer();
        }
    }

    /**
     * Set media parameters
     */
    setMedia(mediaInfo) {
        Object.assign(this.media, mediaInfo);
        console.log(`[SIPSession] Media updated:`, this.media);
        this.emit('mediaUpdated', this.media);
    }

    /**
     * Create dialog information
     */
    createDialog(localUri, remoteUri, remoteTarget) {
        this.dialog = {
            localUri,
            remoteUri,
            remoteTarget,
            localSeq: 1,
            remoteSeq: null,
            secure: false
        };
        console.log(`[SIPSession] Dialog created:`, this.dialog);
    }

    /**
     * Get session duration in seconds
     */
    getDuration() {
        return Math.floor((new Date() - this.createdAt) / 1000);
    }

    /**
     * Check if session is active
     */
    isActive() {
        return ['CALLING', 'PROCEEDING', 'CONFIRMED'].includes(this.state);
    }

    /**
     * Check if session is established
     */
    isEstablished() {
        return this.state === 'CONFIRMED';
    }

    /**
     * Check if media is ready for AI processing
     */
    isMediaReady() {
        return ['MEDIA_READY', 'AI_ACTIVE'].includes(this.state);
    }

    /**
     * Check if AI is active
     */
    isAIActive() {
        return this.state === 'AI_ACTIVE';
    }

    /**
     * Validate media readiness and transition to MEDIA_READY state
     */
    validateMediaReadiness() {
        if (this.state !== 'CONFIRMED') {
            console.warn(`[SIPSession] Cannot validate media readiness in state ${this.state}`);
            return false;
        }

        // Check if RTP socket is ready and media parameters are set
        if (!this.media.rtpPort || !this.media.remoteSdp) {
            console.log(`[SIPSession] Media not ready yet - RTP port: ${this.media.rtpPort}, Remote SDP: ${!!this.media.remoteSdp}`);
            return false;
        }

        // Start media readiness validation timer
        this.startMediaValidationTimer();
        return true;
    }

    /**
     * Start media validation timer to check for actual RTP flow
     */
    startMediaValidationTimer() {
        if (this.timers.has('mediaValidation')) {
            clearTimeout(this.timers.get('mediaValidation'));
        }

        const timer = setTimeout(() => {
            console.log(`[SIPSession] Media validation timeout - assuming media is ready`);
            this.setState('MEDIA_READY', 'media validation timeout');
        }, 2000); // Wait 2 seconds for media to be established

        this.timers.set('mediaValidation', timer);
        console.log(`[SIPSession] Media validation timer started`);
    }

    /**
     * Confirm media is flowing and transition to MEDIA_READY
     */
    confirmMediaFlow() {
        if (this.state === 'CONFIRMED') {
            if (this.timers.has('mediaValidation')) {
                clearTimeout(this.timers.get('mediaValidation'));
                this.timers.delete('mediaValidation');
            }
            this.setState('MEDIA_READY', 'media flow confirmed');
            return true;
        }
        return false;
    }

    /**
     * Activate AI processing (only when media is ready)
     */
    activateAI() {
        if (this.state === 'MEDIA_READY') {
            this.setState('AI_ACTIVE', 'AI processing activated');
            return true;
        }
        console.warn(`[SIPSession] Cannot activate AI in state ${this.state} - media must be ready first`);
        return false;
    }

    /**
     * Cleanup session resources
     */
    cleanup() {
        console.log(`[SIPSession] Starting cleanup for session ${this.callId}`);
        
        // Clear all timers with detailed logging
        for (const [name, timer] of this.timers) {
            clearTimeout(timer);
            console.log(`[SIPSession] Cleared timer: ${name}`);
        }
        this.timers.clear();

        // Clear transactions
        this.transactions.clear();
        
        // Reset media state
        this.media = {
            localSdp: null,
            remoteSdp: null,
            rtpPort: null,
            codec: 'PCMU'
        };
        
        // Clear dialog
        this.dialog = null;
        
        // Remove all event listeners to prevent memory leaks
        this.removeAllListeners();

        console.log(`[SIPSession] Session ${this.callId} cleaned up after ${this.getDuration()}s`);
        this.emit('cleanup');
    }
    
    /**
     * Validate session readiness for audio operations
     */
    validateAudioReadiness() {
        if (!this.isActive()) {
            console.warn(`[SIPSession] Audio operation rejected - session not active (state: ${this.state})`);
            return false;
        }
        
        if (!this.media.rtpPort) {
            console.warn(`[SIPSession] Audio operation rejected - no RTP port assigned`);
            return false;
        }
        
        if (!this.media.remoteSdp) {
            console.warn(`[SIPSession] Audio operation rejected - no remote SDP`);
            return false;
        }
        
        return true;
    }
    
    /**
     * Validate session readiness for AI operations
     */
    validateAIReadiness() {
        if (!this.validateAudioReadiness()) {
            return false;
        }
        
        if (!this.isMediaReady()) {
            console.warn(`[SIPSession] AI operation rejected - media not ready (state: ${this.state})`);
            return false;
        }
        
        return true;
    }
    
    /**
     * Safe audio operation wrapper
     */
    executeAudioOperation(operation, operationName = 'audio operation') {
        if (!this.validateAudioReadiness()) {
            console.error(`[SIPSession] ${operationName} failed - session not ready`);
            return false;
        }
        
        try {
            return operation();
        } catch (error) {
            console.error(`[SIPSession] ${operationName} failed:`, error);
            return false;
        }
    }
    
    /**
     * Safe AI operation wrapper
     */
    executeAIOperation(operation, operationName = 'AI operation') {
        if (!this.validateAIReadiness()) {
            console.error(`[SIPSession] ${operationName} failed - session not ready for AI`);
            return false;
        }
        
        try {
            return operation();
        } catch (error) {
            console.error(`[SIPSession] ${operationName} failed:`, error);
            return false;
        }
    }

    /**
     * Get session info for logging/monitoring
     */
    getInfo() {
        return {
            callId: this.callId,
            localTag: this.localTag,
            remoteTag: this.remoteTag,
            state: this.state,
            duration: this.getDuration(),
            media: this.media,
            dialog: this.dialog,
            sessionExpires: this.sessionExpires,
            createdAt: this.createdAt,
            lastActivity: this.lastActivity
        };
    }
}

/**
 * SIP Transaction Handler
 * Implements RFC 3261 transaction layer with retransmissions
 */
class SIPTransaction extends EventEmitter {
    constructor(method, callId, branch = null) {
        super();
        this.method = method;
        this.callId = callId;
        this.branch = branch || this.generateBranch();
        this.state = 'TRYING';
        this.retransmissions = 0;
        this.maxRetransmissions = method === 'INVITE' ? 7 : 6;
        this.timer = null;
        this.response = null;
        this.createdAt = new Date();
        
        console.log(`[SIPTransaction] Created ${method} transaction ${this.branch}`);
    }

    /**
     * Generate RFC 3261 compliant branch parameter
     */
    generateBranch() {
        return 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
    }

    /**
     * Start retransmission timer
     */
    startRetransmissionTimer(callback) {
        if (this.timer) {
            clearTimeout(this.timer);
        }

        // RFC 3261 Timer A/E values
        const baseInterval = this.method === 'INVITE' ? 500 : 500; // T1 = 500ms
        const interval = baseInterval * Math.pow(2, this.retransmissions);
        const maxInterval = this.method === 'INVITE' ? 4000 : 4000; // T2 = 4s
        
        const actualInterval = Math.min(interval, maxInterval);

        this.timer = setTimeout(() => {
            if (this.retransmissions < this.maxRetransmissions) {
                this.retransmissions++;
                console.log(`[SIPTransaction] Retransmission #${this.retransmissions} for ${this.method} ${this.branch}`);
                callback();
                this.startRetransmissionTimer(callback);
            } else {
                console.error(`[SIPTransaction] Max retransmissions reached for ${this.method} ${this.branch}`);
                this.setState('TERMINATED');
                this.emit('timeout');
            }
        }, actualInterval);

        console.log(`[SIPTransaction] Retransmission timer started: ${actualInterval}ms`);
    }

    /**
     * Stop retransmission timer
     */
    stopRetransmissionTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            console.log(`[SIPTransaction] Retransmission timer stopped for ${this.branch}`);
        }
    }

    /**
     * Set transaction state
     */
    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        console.log(`[SIPTransaction] ${this.branch}: ${oldState} -> ${newState}`);
        this.emit('stateChanged', { oldState, newState });

        if (newState === 'TERMINATED') {
            this.stopRetransmissionTimer();
        }
    }

    /**
     * Handle response
     */
    handleResponse(statusCode, response) {
        this.response = { statusCode, response, receivedAt: new Date() };
        
        if (statusCode >= 100 && statusCode < 200) {
            this.setState('PROCEEDING');
        } else if (statusCode >= 200 && statusCode < 300) {
            this.setState('COMPLETED');
            this.stopRetransmissionTimer();
        } else if (statusCode >= 300) {
            this.setState('COMPLETED');
            this.stopRetransmissionTimer();
        }

        this.emit('response', statusCode, response);
    }

    /**
     * Get transaction duration
     */
    getDuration() {
        return new Date() - this.createdAt;
    }

    /**
     * Get transaction info
     */
    getInfo() {
        return {
            method: this.method,
            callId: this.callId,
            branch: this.branch,
            state: this.state,
            retransmissions: this.retransmissions,
            duration: this.getDuration(),
            response: this.response,
            createdAt: this.createdAt
        };
    }
}

/**
 * Session Manager
 * Manages multiple SIP sessions and transactions
 */
class SIPSessionManager extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.transactions = new Map();
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 30000); // Cleanup every 30 seconds
        
        console.log('[SIPSessionManager] Initialized');
    }

    /**
     * Create new session
     */
    createSession(callId, localTag = null, remoteTag = null) {
        if (this.sessions.has(callId)) {
            console.warn(`[SIPSessionManager] Session ${callId} already exists`);
            return this.sessions.get(callId);
        }

        const session = new SIPSession(callId, localTag, remoteTag);
        this.sessions.set(callId, session);
        
        // Forward session events
        session.on('stateChanged', (data) => {
            this.emit('sessionStateChanged', callId, data);
        });
        
        session.on('cleanup', () => {
            this.sessions.delete(callId);
            this.emit('sessionRemoved', callId);
        });

        console.log(`[SIPSessionManager] Created session ${callId} (total: ${this.sessions.size})`);
        this.emit('sessionCreated', callId, session);
        return session;
    }

    /**
     * Get session by call ID
     */
    getSession(callId) {
        return this.sessions.get(callId);
    }

    /**
     * Remove session
     */
    removeSession(callId) {
        const session = this.sessions.get(callId);
        if (session) {
            session.setState('TERMINATED', 'manually removed');
            this.sessions.delete(callId);
            console.log(`[SIPSessionManager] Removed session ${callId}`);
            return true;
        }
        return false;
    }

    /**
     * Create transaction
     */
    createTransaction(method, callId, branch = null) {
        const transaction = new SIPTransaction(method, callId, branch);
        this.transactions.set(transaction.branch, transaction);
        
        transaction.on('stateChanged', (data) => {
            this.emit('transactionStateChanged', transaction.branch, data);
        });
        
        transaction.on('timeout', () => {
            this.transactions.delete(transaction.branch);
            this.emit('transactionTimeout', transaction.branch);
        });

        console.log(`[SIPSessionManager] Created transaction ${transaction.branch}`);
        return transaction;
    }

    /**
     * Get transaction by branch
     */
    getTransaction(branch) {
        return this.transactions.get(branch);
    }

    /**
     * Cleanup expired sessions
     */
    cleanupExpiredSessions() {
        const now = new Date();
        const expiredSessions = [];
        
        for (const [callId, session] of this.sessions) {
            const inactiveTime = now - session.lastActivity;
            const maxInactiveTime = session.isEstablished() ? 
                (session.sessionExpires + 300) * 1000 : // 5 minutes grace period
                300000; // 5 minutes for non-established sessions
            
            if (inactiveTime > maxInactiveTime) {
                expiredSessions.push(callId);
            }
        }
        
        for (const callId of expiredSessions) {
            console.log(`[SIPSessionManager] Cleaning up expired session ${callId}`);
            this.removeSession(callId);
        }
        
        if (expiredSessions.length > 0) {
            console.log(`[SIPSessionManager] Cleaned up ${expiredSessions.length} expired sessions`);
        }
    }

    /**
     * Get all active sessions
     */
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter(session => session.isActive());
    }

    /**
     * Get session statistics
     */
    getStats() {
        const sessions = Array.from(this.sessions.values());
        const transactions = Array.from(this.transactions.values());
        
        return {
            totalSessions: sessions.length,
            activeSessions: sessions.filter(s => s.isActive()).length,
            establishedSessions: sessions.filter(s => s.isEstablished()).length,
            totalTransactions: transactions.length,
            activeTransactions: transactions.filter(t => t.state !== 'TERMINATED').length,
            sessionsByState: sessions.reduce((acc, s) => {
                acc[s.state] = (acc[s.state] || 0) + 1;
                return acc;
            }, {})
        };
    }

    /**
     * Shutdown session manager
     */
    shutdown() {
        console.log('[SIPSessionManager] Shutting down...');
        
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        // Terminate all sessions
        for (const session of this.sessions.values()) {
            session.setState('TERMINATED', 'shutdown');
        }
        
        // Clear all transactions
        for (const transaction of this.transactions.values()) {
            transaction.setState('TERMINATED');
        }
        
        this.sessions.clear();
        this.transactions.clear();
        
        console.log('[SIPSessionManager] Shutdown complete');
    }
}

export {
    SIPSession,
    SIPTransaction,
    SIPSessionManager
};
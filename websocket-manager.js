const WebSocket = require('ws');
const EventEmitter = require('events');
const TimeoutManager = require('./timeout-manager');

/**
 * WebSocket Connection Manager
 * Provides robust WebSocket connectivity with automatic reconnection
 */
class WebSocketManager extends EventEmitter {
    constructor(url, options = {}) {
        super();
        this.url = url;
        this.options = {
            maxReconnectAttempts: 10,
            baseReconnectDelay: 1000,
            maxReconnectDelay: 30000,
            reconnectBackoffFactor: 1.5,
            pingInterval: 30000,
            pongTimeout: 5000,
            ...options
        };
        
        this.ws = null;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.isManuallyDisconnected = false;
        this.lastConnectTime = null;
        this.lastDisconnectTime = null;
        this.timeoutManager = new TimeoutManager();
        
        console.log('[WebSocketManager] Initialized with URL:', this.url);
    }

    /**
     * Connect to WebSocket server
     */
    async connect() {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            console.log('[WebSocketManager] Already connecting or connected');
            return Promise.resolve();
        }
        
        this.isConnecting = true;
        this.isManuallyDisconnected = false;
        
        return new Promise((resolve, reject) => {
            try {
                console.log(`[WebSocketManager] Connecting to ${this.url} (attempt ${this.reconnectAttempts + 1})`);
                
                this.ws = new WebSocket(this.url);
                
                // Connection timeout
                this.timeoutManager.setTimeout('connection', () => {
                    console.error('[WebSocketManager] Connection timeout');
                    this.ws.terminate();
                    reject(new Error('Connection timeout'));
                }, 10000);
                
                this.ws.on('open', () => {
                    this.timeoutManager.clearTimeout('connection');
                    this.isConnecting = false;
                    this.reconnectAttempts = 0;
                    this.lastConnectTime = new Date();
                    
                    console.log('[WebSocketManager] Connected successfully');
                    this.startHeartbeat();
                    this.emit('connected');
                    resolve();
                });
                
                this.ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.emit('message', message);
                    } catch (error) {
                        console.error('[WebSocketManager] Failed to parse message:', error);
                        this.emit('parseError', { data, error });
                    }
                });
                
                this.ws.on('close', (code, reason) => {
                    this.timeoutManager.clearTimeout('connection');
                    this.isConnecting = false;
                    this.lastDisconnectTime = new Date();
                    this.stopHeartbeat();
                    
                    console.log(`[WebSocketManager] Disconnected: ${code} - ${reason}`);
                    this.emit('disconnected', { code, reason });
                    
                    if (!this.isManuallyDisconnected) {
                        this.scheduleReconnect();
                    }
                });
                
                this.ws.on('error', (error) => {
                    this.timeoutManager.clearTimeout('connection');
                    this.isConnecting = false;
                    
                    console.error('[WebSocketManager] WebSocket error:', error);
                    this.emit('error', error);
                    
                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                });
                
                this.ws.on('pong', () => {
                    this.timeoutManager.clearTimeout('pong');
                    console.log('[WebSocketManager] Pong received');
                });
                
            } catch (error) {
                this.isConnecting = false;
                console.error('[WebSocketManager] Failed to create WebSocket:', error);
                reject(error);
            }
        });
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect() {
        console.log('[WebSocketManager] Manually disconnecting');
        this.isManuallyDisconnected = true;
        this.timeoutManager.clearTimeout('reconnect');
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
    }

    /**
     * Send message to WebSocket server
     */
    send(message) {
        if (!this.isConnected()) {
            console.error('[WebSocketManager] Cannot send message - not connected');
            return false;
        }
        
        try {
            const data = typeof message === 'string' ? message : JSON.stringify(message);
            this.ws.send(data);
            console.log('[WebSocketManager] Message sent:', typeof message === 'object' ? message.type || 'unknown' : 'string');
            return true;
        } catch (error) {
            console.error('[WebSocketManager] Failed to send message:', error);
            return false;
        }
    }

    /**
     * Check if WebSocket is connected
     */
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Get connection state
     */
    getState() {
        if (!this.ws) return 'DISCONNECTED';
        
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'CONNECTING';
            case WebSocket.OPEN: return 'CONNECTED';
            case WebSocket.CLOSING: return 'CLOSING';
            case WebSocket.CLOSED: return 'DISCONNECTED';
            default: return 'UNKNOWN';
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
        if (this.isManuallyDisconnected || this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
                console.error('[WebSocketManager] Max reconnection attempts reached');
                this.emit('maxReconnectAttemptsReached');
            }
            return;
        }
        
        const delay = Math.min(
            this.options.baseReconnectDelay * Math.pow(this.options.reconnectBackoffFactor, this.reconnectAttempts),
            this.options.maxReconnectDelay
        );
        
        console.log(`[WebSocketManager] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.options.maxReconnectAttempts})`);
        
        this.timeoutManager.setTimeout('reconnect', async () => {
            this.reconnectAttempts++;
            try {
                await this.connect();
            } catch (error) {
                console.error('[WebSocketManager] Reconnection failed:', error);
                this.scheduleReconnect();
            }
        }, delay);
    }

    /**
     * Start heartbeat mechanism
     */
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.timeoutManager.setInterval('ping', () => {
            if (this.isConnected()) {
                console.log('[WebSocketManager] Sending ping');
                this.ws.ping();
                
                // Set pong timeout
                this.timeoutManager.setTimeout('pong', () => {
                    console.error('[WebSocketManager] Pong timeout - connection may be dead');
                    this.ws.terminate();
                }, this.options.pongTimeout);
            }
        }, this.options.pingInterval);
    }

    /**
     * Stop heartbeat mechanism
     */
    stopHeartbeat() {
        this.timeoutManager.clearInterval('ping');
        this.timeoutManager.clearTimeout('pong');
    }

    /**
     * Get connection statistics
     */
    getStats() {
        return {
            url: this.url,
            state: this.getState(),
            reconnectAttempts: this.reconnectAttempts,
            isManuallyDisconnected: this.isManuallyDisconnected,
            lastConnectTime: this.lastConnectTime,
            lastDisconnectTime: this.lastDisconnectTime,
            uptime: this.lastConnectTime ? new Date() - this.lastConnectTime : 0,
            timeouts: this.timeoutManager.getStats()
        };
    }

    /**
     * Reset reconnection attempts
     */
    resetReconnectAttempts() {
        this.reconnectAttempts = 0;
        console.log('[WebSocketManager] Reconnection attempts reset');
    }

    /**
     * Update connection options
     */
    updateOptions(newOptions) {
        Object.assign(this.options, newOptions);
        console.log('[WebSocketManager] Options updated:', newOptions);
    }

    /**
     * Shutdown and cleanup
     */
    shutdown() {
        console.log('[WebSocketManager] Shutting down...');
        this.disconnect();
        this.timeoutManager.shutdown();
        this.removeAllListeners();
        console.log('[WebSocketManager] Shutdown complete');
    }
}

module.exports = WebSocketManager;
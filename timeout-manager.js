const EventEmitter = require('events');

/**
 * Unified Timeout Manager
 * Provides centralized timeout management with predictable behavior
 */
class TimeoutManager extends EventEmitter {
    constructor() {
        super();
        this.timeouts = new Map();
        this.intervals = new Map();
        this.defaultTimeouts = {
            sessionExpiry: 1800000,    // 30 minutes
            mediaValidation: 2000,     // 2 seconds
            aiResponse: 30000,         // 30 seconds
            sipTransaction: 32000,     // 32 seconds (RFC 3261)
            rtpTimeout: 10000,         // 10 seconds
            websocketReconnect: 5000,  // 5 seconds
            callSetup: 60000          // 1 minute
        };
        
        console.log('[TimeoutManager] Initialized with default timeouts:', this.defaultTimeouts);
    }

    /**
     * Set a timeout with automatic cleanup
     */
    setTimeout(name, callback, duration = null, context = null) {
        // Clear existing timeout with same name
        this.clearTimeout(name);
        
        // Use default duration if not provided
        const actualDuration = duration || this.defaultTimeouts[name] || 30000;
        
        const timeoutId = setTimeout(() => {
            console.log(`[TimeoutManager] Timeout '${name}' expired after ${actualDuration}ms`);
            this.timeouts.delete(name);
            
            try {
                callback();
            } catch (error) {
                console.error(`[TimeoutManager] Error in timeout callback '${name}':`, error);
                this.emit('timeoutError', { name, error, context });
            }
            
            this.emit('timeoutExpired', { name, duration: actualDuration, context });
        }, actualDuration);
        
        this.timeouts.set(name, {
            id: timeoutId,
            callback,
            duration: actualDuration,
            createdAt: new Date(),
            context
        });
        
        console.log(`[TimeoutManager] Set timeout '${name}' for ${actualDuration}ms`);
        return name;
    }

    /**
     * Clear a specific timeout
     */
    clearTimeout(name) {
        const timeout = this.timeouts.get(name);
        if (timeout) {
            clearTimeout(timeout.id);
            this.timeouts.delete(name);
            console.log(`[TimeoutManager] Cleared timeout '${name}'`);
            return true;
        }
        return false;
    }

    /**
     * Set an interval with automatic cleanup
     */
    setInterval(name, callback, duration, context = null) {
        // Clear existing interval with same name
        this.clearInterval(name);
        
        const intervalId = setInterval(() => {
            try {
                callback();
            } catch (error) {
                console.error(`[TimeoutManager] Error in interval callback '${name}':`, error);
                this.emit('intervalError', { name, error, context });
            }
        }, duration);
        
        this.intervals.set(name, {
            id: intervalId,
            callback,
            duration,
            createdAt: new Date(),
            context
        });
        
        console.log(`[TimeoutManager] Set interval '${name}' for ${duration}ms`);
        return name;
    }

    /**
     * Clear a specific interval
     */
    clearInterval(name) {
        const interval = this.intervals.get(name);
        if (interval) {
            clearInterval(interval.id);
            this.intervals.delete(name);
            console.log(`[TimeoutManager] Cleared interval '${name}'`);
            return true;
        }
        return false;
    }

    /**
     * Check if a timeout exists
     */
    hasTimeout(name) {
        return this.timeouts.has(name);
    }

    /**
     * Check if an interval exists
     */
    hasInterval(name) {
        return this.intervals.has(name);
    }

    /**
     * Get timeout information
     */
    getTimeoutInfo(name) {
        const timeout = this.timeouts.get(name);
        if (timeout) {
            return {
                name,
                duration: timeout.duration,
                createdAt: timeout.createdAt,
                remainingTime: Math.max(0, timeout.duration - (new Date() - timeout.createdAt)),
                context: timeout.context
            };
        }
        return null;
    }

    /**
     * Get all active timeouts
     */
    getActiveTimeouts() {
        const result = [];
        for (const [name] of this.timeouts) {
            result.push(this.getTimeoutInfo(name));
        }
        return result;
    }

    /**
     * Get all active intervals
     */
    getActiveIntervals() {
        const result = [];
        for (const [name, interval] of this.intervals) {
            result.push({
                name,
                duration: interval.duration,
                createdAt: interval.createdAt,
                context: interval.context
            });
        }
        return result;
    }

    /**
     * Clear all timeouts and intervals
     */
    clearAll() {
        console.log(`[TimeoutManager] Clearing all timeouts (${this.timeouts.size}) and intervals (${this.intervals.size})`);
        
        // Clear all timeouts
        for (const [name, timeout] of this.timeouts) {
            clearTimeout(timeout.id);
            console.log(`[TimeoutManager] Cleared timeout '${name}'`);
        }
        this.timeouts.clear();
        
        // Clear all intervals
        for (const [name, interval] of this.intervals) {
            clearInterval(interval.id);
            console.log(`[TimeoutManager] Cleared interval '${name}'`);
        }
        this.intervals.clear();
        
        this.emit('allCleared');
    }

    /**
     * Update default timeout duration
     */
    setDefaultTimeout(name, duration) {
        this.defaultTimeouts[name] = duration;
        console.log(`[TimeoutManager] Updated default timeout '${name}' to ${duration}ms`);
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            activeTimeouts: this.timeouts.size,
            activeIntervals: this.intervals.size,
            defaultTimeouts: { ...this.defaultTimeouts },
            timeoutNames: Array.from(this.timeouts.keys()),
            intervalNames: Array.from(this.intervals.keys())
        };
    }

    /**
     * Shutdown and cleanup
     */
    shutdown() {
        console.log('[TimeoutManager] Shutting down...');
        this.clearAll();
        this.removeAllListeners();
        console.log('[TimeoutManager] Shutdown complete');
    }
}

module.exports = TimeoutManager;
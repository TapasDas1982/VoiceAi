import { SIPLiveKitBridge } from './sip-livekit-bridge.js';
import { spawn } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

/**
 * SIP Application with LiveKit AI Agent Integration
 * Main application that starts both SIP bridge and AI agent
 */
class SIPApplication {
    constructor() {
        this.bridge = null;
        this.agentProcess = null;
        this.isShuttingDown = false;
        
        // Configuration
        this.config = {
            sip: {
                port: parseInt(process.env.SIP_PORT) || 5060,
                host: process.env.SIP_HOST || '0.0.0.0'
            },
            livekit: {
                url: process.env.LIVEKIT_URL,
                apiKey: process.env.LIVEKIT_API_KEY,
                apiSecret: process.env.LIVEKIT_API_SECRET
            },
            agent: {
                script: 'agent.js',
                mode: 'dev'
            }
        };
        
        console.log('[SIPApplication] Initialized with config:', {
            sipPort: this.config.sip.port,
            sipHost: this.config.sip.host,
            livekitUrl: this.config.livekit.url ? 'configured' : 'missing',
            agentScript: this.config.agent.script
        });
    }
    
    /**
     * Start the SIP application
     */
    async start() {
        try {
            console.log('[SIPApplication] Starting SIP to LiveKit AI Agent application...');
            
            // Validate configuration
            this.validateConfig();
            
            // Start LiveKit AI agent
            await this.startAIAgent();
            
            // Start SIP bridge
            await this.startSIPBridge();
            
            // Setup event handlers
            this.setupEventHandlers();
            
            // Setup graceful shutdown
            this.setupGracefulShutdown();
            
            console.log('[SIPApplication] ✅ SIP to LiveKit AI Agent application started successfully!');
            console.log('[SIPApplication] 📞 SIP calls will be routed to LiveKit AI agent');
            console.log('[SIPApplication] 🎯 SIP Server listening on:', `${this.config.sip.host}:${this.config.sip.port}`);
            
        } catch (error) {
            console.error('[SIPApplication] Failed to start:', error);
            await this.shutdown();
            process.exit(1);
        }
    }
    
    /**
     * Validate configuration
     */
    validateConfig() {
        const required = [
            { key: 'LIVEKIT_URL', value: this.config.livekit.url },
            { key: 'LIVEKIT_API_KEY', value: this.config.livekit.apiKey },
            { key: 'LIVEKIT_API_SECRET', value: this.config.livekit.apiSecret }
        ];
        
        const missing = required.filter(item => !item.value);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.map(item => item.key).join(', ')}`);
        }
        
        console.log('[SIPApplication] ✅ Configuration validated');
    }
    
    /**
     * Start the LiveKit AI agent
     */
    async startAIAgent() {
        return new Promise((resolve, reject) => {
            console.log('[SIPApplication] Starting LiveKit AI agent...');
            
            const agentPath = path.join(__dirname, this.config.agent.script);
            
            this.agentProcess = spawn('node', [agentPath, this.config.agent.mode], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env },
                cwd: __dirname
            });
            
            let startupComplete = false;
            
            // Handle agent output
            this.agentProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[AI-Agent] ${output.trim()}`);
                
                // Check for successful startup
                if (!startupComplete && (output.includes('registered worker') || output.includes('Worker registered'))) {
                    startupComplete = true;
                    console.log('[SIPApplication] ✅ LiveKit AI agent started successfully');
                    resolve();
                }
            });
            
            this.agentProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.error(`[AI-Agent] ERROR: ${error.trim()}`);
                
                if (!startupComplete && error.includes('Error')) {
                    reject(new Error(`AI agent startup failed: ${error}`));
                }
            });
            
            this.agentProcess.on('close', (code) => {
                console.log(`[SIPApplication] AI agent process exited with code ${code}`);
                if (!startupComplete) {
                    reject(new Error(`AI agent process exited with code ${code}`));
                } else if (!this.isShuttingDown) {
                    console.error('[SIPApplication] AI agent unexpectedly stopped, restarting...');
                    setTimeout(() => this.startAIAgent(), 5000);
                }
            });
            
            this.agentProcess.on('error', (error) => {
                console.error('[SIPApplication] AI agent process error:', error);
                if (!startupComplete) {
                    reject(error);
                }
            });
            
            // Timeout for startup
            setTimeout(() => {
                if (!startupComplete) {
                    reject(new Error('AI agent startup timeout'));
                }
            }, 30000); // 30 second timeout
        });
    }
    
    /**
     * Start the SIP bridge
     */
    async startSIPBridge() {
        console.log('[SIPApplication] Starting SIP bridge...');
        
        this.bridge = new SIPLiveKitBridge({
            sipPort: this.config.sip.port,
            sipHost: this.config.sip.host,
            livekitUrl: this.config.livekit.url,
            livekitApiKey: this.config.livekit.apiKey,
            livekitApiSecret: this.config.livekit.apiSecret
        });
        
        await this.bridge.start();
        console.log('[SIPApplication] ✅ SIP bridge started successfully');
    }
    
    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        if (this.bridge) {
            this.bridge.on('callConnected', (data) => {
                console.log(`[SIPApplication] 📞 Call connected: ${data.callId} -> Room: ${data.roomName}`);
                this.logCallEvent('CONNECTED', data);
            });
            
            this.bridge.on('callDisconnected', (data) => {
                console.log(`[SIPApplication] 📞 Call disconnected: ${data.callId}`);
                this.logCallEvent('DISCONNECTED', data);
            });
            
            // Handle client self-liveness status reports
            this.bridge.on('clientStatus', (status) => {
                // Log comprehensive client status every 30 seconds (every 6th health check)
                if (status.timestamp % 30000 < 5000) {
                    console.log('[SIPApplication] 🔍 Client Self-Status Report:');
                    console.log(`[SIPApplication]   Liveness: ${status.liveness.status} - ${status.liveness.message}`);
                    console.log(`[SIPApplication]   Registration: ${status.registration.state} (${status.registration.timeSinceRegistration}s ago)`);
                    console.log(`[SIPApplication]   Network: Socket ${status.network.socketActive ? 'Active' : 'Inactive'} on ${status.network.localIP}:${status.network.localPort}`);
                    console.log(`[SIPApplication]   Monitoring: Health checks ${status.monitoring.healthCheckActive ? 'Running' : 'Stopped'}, Re-reg ${status.monitoring.reRegistrationScheduled ? 'Scheduled' : 'Not scheduled'}`);
                    
                    // Alert if client reports degraded status
                    if (!status.liveness.isAlive) {
                        console.warn('[SIPApplication] ⚠️  CLIENT REPORTS DEGRADED STATUS:', status.liveness.issues.join(', '));
                    }
                }
            });
        }
        
        // Log stats periodically
        setInterval(() => {
            this.logStats();
        }, 60000); // Every minute
    }
    
    /**
     * Log call events
     */
    logCallEvent(event, data) {
        const timestamp = new Date().toISOString();
        console.log(`[SIPApplication] [${timestamp}] CALL_${event}:`, {
            callId: data.callId,
            roomName: data.roomName,
            timestamp
        });
    }
    
    /**
     * Log application statistics
     */
    logStats() {
        if (this.bridge) {
            const stats = this.bridge.getStats();
            console.log('[SIPApplication] Stats:', {
                activeCalls: stats.activeCalls,
                totalSessions: stats.totalSessions,
                registrationState: stats.registrationState,
                uptime: stats.uptime,
                memory: process.memoryUsage()
            });
        }
    }
    
    /**
     * Setup graceful shutdown
     */
    setupGracefulShutdown() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        
        signals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`[SIPApplication] Received ${signal}, shutting down gracefully...`);
                await this.shutdown();
                process.exit(0);
            });
        });
        
        process.on('uncaughtException', async (error) => {
            console.error('[SIPApplication] Uncaught exception:', error);
            await this.shutdown();
            process.exit(1);
        });
        
        process.on('unhandledRejection', async (reason, promise) => {
            console.error('[SIPApplication] Unhandled rejection at:', promise, 'reason:', reason);
            await this.shutdown();
            process.exit(1);
        });
    }
    
    /**
     * Shutdown the application
     */
    async shutdown() {
        if (this.isShuttingDown) {
            return;
        }
        
        this.isShuttingDown = true;
        console.log('[SIPApplication] Shutting down...');
        
        try {
            // Shutdown SIP bridge
            if (this.bridge) {
                await this.bridge.shutdown();
                console.log('[SIPApplication] ✅ SIP bridge shutdown complete');
            }
            
            // Stop AI agent
            if (this.agentProcess && !this.agentProcess.killed) {
                console.log('[SIPApplication] Stopping AI agent...');
                this.agentProcess.kill('SIGTERM');
                
                // Wait for graceful shutdown
                await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        console.log('[SIPApplication] Force killing AI agent...');
                        this.agentProcess.kill('SIGKILL');
                        resolve();
                    }, 5000);
                    
                    this.agentProcess.on('close', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
                
                console.log('[SIPApplication] ✅ AI agent stopped');
            }
            
            console.log('[SIPApplication] ✅ Shutdown complete');
            
        } catch (error) {
            console.error('[SIPApplication] Error during shutdown:', error);
        }
    }
    
    /**
     * Get application status
     */
    getStatus() {
        return {
            running: !this.isShuttingDown,
            agentRunning: this.agentProcess && !this.agentProcess.killed,
            bridgeRunning: this.bridge !== null,
            stats: this.bridge ? this.bridge.getStats() : null,
            uptime: process.uptime(),
            memory: process.memoryUsage()
        };
    }
}

// Main execution
// Convert Windows path separators to forward slashes for comparison
const normalizedArgv = process.argv[1].replace(/\\/g, '/');
if (import.meta.url === `file:///${normalizedArgv}`) {
    console.log('[SIPApplication] Starting application...');
    const app = new SIPApplication();
    
    app.start().catch((error) => {
        console.error('[SIPApplication] Startup failed:', error);
        process.exit(1);
    });
}

export { SIPApplication };
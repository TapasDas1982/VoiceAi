import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dashboard server for monitoring VoiceAI LiveKit Agents
 */
class Dashboard {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.stats = {
      startTime: Date.now(),
      totalConnections: 0,
      activeConnections: 0,
      totalSessions: 0,
      activeSessions: 0,
      errors: 0,
      lastActivity: null
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.startStatsCollection();
    
    winston.info('📊 Dashboard initialized');
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
    
    // Logging middleware
    this.app.use((req, res, next) => {
      winston.info(`${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Main dashboard page
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });

    // API endpoints
    this.app.get('/api/stats', (req, res) => {
      res.json(this.getStats());
    });

    this.app.get('/api/config', (req, res) => {
      // Return safe config (without secrets)
      const safeConfig = {
        livekit: {
          url: config.livekit.url,
          room: config.livekit.room
        },
        openai: {
          model: config.openai.model,
          voice: config.openai.voice,
          temperature: config.openai.temperature
        },
        audio: config.audio,
        agent: config.agent,
        server: config.server
      };
      res.json(safeConfig);
    });

    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      });
    });

    // Logs endpoint
    this.app.get('/api/logs', (req, res) => {
      // This would read from log files in a real implementation
      res.json({
        logs: [
          { timestamp: new Date().toISOString(), level: 'info', message: 'Dashboard accessed' }
        ]
      });
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      winston.error('Dashboard error:', err);
      this.stats.errors++;
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Setup Socket.IO handlers for real-time updates
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      winston.info(`📱 Dashboard client connected: ${socket.id}`);
      this.stats.activeConnections++;
      this.stats.totalConnections++;

      // Send initial stats
      socket.emit('stats', this.getStats());
      socket.emit('config', this.getSafeConfig());

      // Handle client disconnect
      socket.on('disconnect', () => {
        winston.info(`📱 Dashboard client disconnected: ${socket.id}`);
        this.stats.activeConnections--;
      });

      // Handle stats request
      socket.on('requestStats', () => {
        socket.emit('stats', this.getStats());
      });
    });
  }

  /**
   * Start periodic stats collection and broadcasting
   */
  startStatsCollection() {
    setInterval(() => {
      const stats = this.getStats();
      this.io.emit('stats', stats);
    }, 5000); // Update every 5 seconds
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get safe configuration (without secrets)
   */
  getSafeConfig() {
    return {
      livekit: {
        url: config.livekit.url,
        room: config.livekit.room
      },
      openai: {
        model: config.openai.model,
        voice: config.openai.voice,
        temperature: config.openai.temperature
      },
      audio: config.audio,
      agent: config.agent,
      server: config.server
    };
  }

  /**
   * Update session statistics
   */
  updateSessionStats(activeSessions, totalSessions) {
    this.stats.activeSessions = activeSessions;
    this.stats.totalSessions = totalSessions;
    this.stats.lastActivity = new Date().toISOString();
  }

  /**
   * Generate dashboard HTML
   */
  generateDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VoiceAI LiveKit Agents Dashboard</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
        }
        
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s;
        }
        
        .card:hover {
            transform: translateY(-2px);
        }
        
        .card h3 {
            color: #667eea;
            margin-bottom: 15px;
            font-size: 1.3em;
        }
        
        .stat-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .stat-label {
            font-weight: 500;
        }
        
        .stat-value {
            font-weight: bold;
            color: #667eea;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .status-online {
            background-color: #4CAF50;
        }
        
        .status-offline {
            background-color: #f44336;
        }
        
        .logs-container {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-height: 400px;
            overflow-y: auto;
        }
        
        .log-entry {
            padding: 8px;
            margin-bottom: 5px;
            border-left: 3px solid #667eea;
            background: #f8f9fa;
            font-family: monospace;
            font-size: 0.9em;
        }
        
        .footer {
            text-align: center;
            color: white;
            margin-top: 30px;
            opacity: 0.8;
        }
        
        @media (max-width: 768px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 VoiceAI LiveKit Agents</h1>
            <p>Real-time Voice AI Dashboard</p>
        </div>
        
        <div class="dashboard-grid">
            <div class="card">
                <h3>📊 System Status</h3>
                <div class="stat-item">
                    <span class="stat-label">
                        <span class="status-indicator status-online"></span>
                        Agent Status
                    </span>
                    <span class="stat-value" id="agent-status">Online</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Uptime</span>
                    <span class="stat-value" id="uptime">0s</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Memory Usage</span>
                    <span class="stat-value" id="memory">0 MB</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Last Activity</span>
                    <span class="stat-value" id="last-activity">Never</span>
                </div>
            </div>
            
            <div class="card">
                <h3>👥 Sessions</h3>
                <div class="stat-item">
                    <span class="stat-label">Active Sessions</span>
                    <span class="stat-value" id="active-sessions">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Sessions</span>
                    <span class="stat-value" id="total-sessions">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Dashboard Connections</span>
                    <span class="stat-value" id="dashboard-connections">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Errors</span>
                    <span class="stat-value" id="total-errors">0</span>
                </div>
            </div>
            
            <div class="card">
                <h3>⚙️ Configuration</h3>
                <div class="stat-item">
                    <span class="stat-label">LiveKit URL</span>
                    <span class="stat-value" id="livekit-url">-</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">OpenAI Model</span>
                    <span class="stat-value" id="openai-model">-</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Voice</span>
                    <span class="stat-value" id="openai-voice">-</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Sample Rate</span>
                    <span class="stat-value" id="sample-rate">-</span>
                </div>
            </div>
            
            <div class="card">
                <h3>🎯 Agent Settings</h3>
                <div class="stat-item">
                    <span class="stat-label">Agent Name</span>
                    <span class="stat-value" id="agent-name">-</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Greeting Enabled</span>
                    <span class="stat-value" id="greeting-enabled">-</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Transcription</span>
                    <span class="stat-value" id="transcription-enabled">-</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Max Session Duration</span>
                    <span class="stat-value" id="max-session-duration">-</span>
                </div>
            </div>
        </div>
        
        <div class="logs-container">
            <h3>📝 Recent Activity</h3>
            <div id="logs">
                <div class="log-entry">[${new Date().toISOString()}] Dashboard initialized</div>
            </div>
        </div>
        
        <div class="footer">
            <p>VoiceAI LiveKit Agents Dashboard • Last updated: <span id="last-update">Never</span></p>
        </div>
    </div>
    
    <script>
        const socket = io();
        
        // Update stats display
        socket.on('stats', (stats) => {
            document.getElementById('uptime').textContent = formatUptime(stats.uptime);
            document.getElementById('memory').textContent = formatMemory(stats.memory.heapUsed);
            document.getElementById('active-sessions').textContent = stats.activeSessions;
            document.getElementById('total-sessions').textContent = stats.totalSessions;
            document.getElementById('dashboard-connections').textContent = stats.activeConnections;
            document.getElementById('total-errors').textContent = stats.errors;
            document.getElementById('last-activity').textContent = stats.lastActivity ? new Date(stats.lastActivity).toLocaleTimeString() : 'Never';
            document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
        });
        
        // Update config display
        socket.on('config', (config) => {
            document.getElementById('livekit-url').textContent = config.livekit.url;
            document.getElementById('openai-model').textContent = config.openai.model;
            document.getElementById('openai-voice').textContent = config.openai.voice;
            document.getElementById('sample-rate').textContent = config.audio.sampleRate + 'Hz';
            document.getElementById('agent-name').textContent = config.agent.name;
            document.getElementById('greeting-enabled').textContent = config.agent.enableGreeting ? 'Yes' : 'No';
            document.getElementById('transcription-enabled').textContent = config.agent.enableTranscription ? 'Yes' : 'No';
            document.getElementById('max-session-duration').textContent = Math.round(config.agent.maxSessionDuration / 60000) + 'min';
        });
        
        // Format uptime
        function formatUptime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            return \`\${hours}h \${minutes}m \${secs}s\`;
        }
        
        // Format memory usage
        function formatMemory(bytes) {
            return Math.round(bytes / 1024 / 1024) + ' MB';
        }
        
        // Request stats every 10 seconds
        setInterval(() => {
            socket.emit('requestStats');
        }, 10000);
    </script>
</body>
</html>
    `;
  }

  /**
   * Start the dashboard server
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server.listen(config.server.port, config.server.host, () => {
          winston.info(`📊 Dashboard server started on http://${config.server.host}:${config.server.port}`);
          resolve();
        });
      } catch (error) {
        winston.error('❌ Failed to start dashboard server:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the dashboard server
   */
  async stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        winston.info('📊 Dashboard server stopped');
        resolve();
      });
    });
  }
}

export default Dashboard;

// Run dashboard if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dashboard = new Dashboard();
  dashboard.start().catch(console.error);
}
const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

class VoiceAIDashboard {
  constructor(voiceAIInstance = null) {
    this.app = express();
    this.voiceAI = voiceAIInstance;
    this.port = process.env.PORT || 3000;
    this.callLogs = [];
    this.systemStats = {
      startTime: new Date(),
      totalCalls: 0,
      activeCalls: 0,
      lastCallTime: null,
      errors: []
    };
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
  }

  setupRoutes() {
    // Dashboard home page
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });

    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        uptime: Date.now() - this.systemStats.startTime.getTime(),
        stats: this.systemStats,
        config: {
          sipServer: process.env.SIP_SERVER || '122.163.120.156',
          sipExtension: process.env.SIP_AUTHORIZATION_USER || '31',
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          hasGoogleSheets: !!process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SHEET_ID !== 'your_google_sheet_id_here'
        }
      });
    });

    this.app.get('/api/logs', (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      res.json(this.callLogs.slice(-limit));
    });

    this.app.post('/api/call', async (req, res) => {
      const { target } = req.body;
      
      if (!target) {
        return res.status(400).json({ error: 'Target URI required' });
      }
      
      try {
        if (this.voiceAI && typeof this.voiceAI.makeCall === 'function') {
          await this.voiceAI.makeCall(target);
          this.logCall('outbound', target, 'initiated');
          res.json({ success: true, message: `Call initiated to ${target}` });
        } else {
          res.status(503).json({ error: 'Voice AI system not available' });
        }
      } catch (error) {
        this.logError('Call initiation failed', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/refresh-training', async (req, res) => {
      try {
        if (this.voiceAI && typeof this.voiceAI.loadSheetsData === 'function') {
          await this.voiceAI.loadSheetsData();
          res.json({ success: true, message: 'Training data refreshed' });
        } else {
          res.status(503).json({ error: 'Voice AI system not available' });
        }
      } catch (error) {
        this.logError('Training data refresh failed', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });
  }

  generateDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voice AI SIP Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
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
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }
        
        .card:hover {
            transform: translateY(-5px);
        }
        
        .card h3 {
            color: #667eea;
            margin-bottom: 15px;
            font-size: 1.3em;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .status-online {
            background: #4CAF50;
            animation: pulse 2s infinite;
        }
        
        .status-offline {
            background: #f44336;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .stat-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .stat-value {
            font-weight: bold;
            color: #667eea;
        }
        
        .button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.3s ease;
            margin: 5px;
        }
        
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .input-group {
            margin-bottom: 15px;
        }
        
        .input-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        .input-group input {
            width: 100%;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
        }
        
        .input-group input:focus {
            outline: none;
            border-color: #667eea;
        }
        
        .logs {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-height: 400px;
            overflow-y: auto;
        }
        
        .log-entry {
            padding: 8px;
            margin-bottom: 5px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 14px;
        }
        
        .log-info {
            background: #e3f2fd;
            color: #1976d2;
        }
        
        .log-error {
            background: #ffebee;
            color: #d32f2f;
        }
        
        .log-success {
            background: #e8f5e8;
            color: #388e3c;
        }
        
        .footer {
            text-align: center;
            color: white;
            margin-top: 30px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎙️ Voice AI SIP Dashboard</h1>
            <p>Monitor and manage your AI-powered voice system</p>
        </div>
        
        <div class="dashboard">
            <div class="card">
                <h3>📊 System Status</h3>
                <div class="stat-item">
                    <span>SIP Status:</span>
                    <span><span class="status-indicator status-online"></span><span id="sip-status">Online</span></span>
                </div>
                <div class="stat-item">
                    <span>OpenAI API:</span>
                    <span id="openai-status">✅ Connected</span>
                </div>
                <div class="stat-item">
                    <span>Google Sheets:</span>
                    <span id="sheets-status">⚠️ Not configured</span>
                </div>
                <div class="stat-item">
                    <span>Uptime:</span>
                    <span class="stat-value" id="uptime">Loading...</span>
                </div>
            </div>
            
            <div class="card">
                <h3>📞 Call Statistics</h3>
                <div class="stat-item">
                    <span>Total Calls:</span>
                    <span class="stat-value" id="total-calls">0</span>
                </div>
                <div class="stat-item">
                    <span>Active Calls:</span>
                    <span class="stat-value" id="active-calls">0</span>
                </div>
                <div class="stat-item">
                    <span>Last Call:</span>
                    <span class="stat-value" id="last-call">Never</span>
                </div>
                <div class="stat-item">
                    <span>Extension:</span>
                    <span class="stat-value" id="extension">32</span>
                </div>
            </div>
            
            <div class="card">
                <h3>🚀 Quick Actions</h3>
                <div class="input-group">
                    <label for="call-target">Make Outbound Call:</label>
                    <input type="text" id="call-target" placeholder="sip:user@domain.com" />
                </div>
                <button class="button" onclick="makeCall()">📞 Initiate Call</button>
                <button class="button" onclick="refreshTraining()">🔄 Refresh Training Data</button>
                <button class="button" onclick="refreshDashboard()">📊 Refresh Dashboard</button>
            </div>
        </div>
        
        <div class="logs">
            <h3>📋 Recent Activity</h3>
            <div id="logs-container">
                <div class="log-entry log-info">System initialized and ready for calls...</div>
            </div>
        </div>
        
        <div class="footer">
            <p>Voice AI SIP System v1.0.0 | Built with ❤️ for intelligent voice interactions</p>
        </div>
    </div>
    
    <script>
        let refreshInterval;
        
        async function fetchStatus() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                
                // Update status indicators
                document.getElementById('sip-status').textContent = data.status === 'running' ? 'Online' : 'Offline';
                document.getElementById('openai-status').textContent = data.config.hasOpenAI ? '✅ Connected' : '❌ Not configured';
                document.getElementById('sheets-status').textContent = data.config.hasGoogleSheets ? '✅ Connected' : '⚠️ Not configured';
                
                // Update stats
                document.getElementById('total-calls').textContent = data.stats.totalCalls;
                document.getElementById('active-calls').textContent = data.stats.activeCalls;
                document.getElementById('extension').textContent = data.config.sipExtension;
                
                // Update uptime
                const uptimeMs = data.uptime;
                const uptimeStr = formatUptime(uptimeMs);
                document.getElementById('uptime').textContent = uptimeStr;
                
                // Update last call
                if (data.stats.lastCallTime) {
                    const lastCall = new Date(data.stats.lastCallTime);
                    document.getElementById('last-call').textContent = lastCall.toLocaleString();
                }
                
            } catch (error) {
                console.error('Failed to fetch status:', error);
                addLogEntry('Failed to fetch system status', 'error');
            }
        }
        
        async function fetchLogs() {
            try {
                const response = await fetch('/api/logs?limit=10');
                const logs = await response.json();
                
                const container = document.getElementById('logs-container');
                container.innerHTML = '';
                
                if (logs.length === 0) {
                    container.innerHTML = '<div class="log-entry log-info">No recent activity</div>';
                } else {
                    logs.forEach(log => {
                        const entry = document.createElement('div');
                        entry.className = \`log-entry log-\${log.type}\`;
                        entry.textContent = \`[\${new Date(log.timestamp).toLocaleTimeString()}] \${log.message}\`;
                        container.appendChild(entry);
                    });
                }
                
            } catch (error) {
                console.error('Failed to fetch logs:', error);
            }
        }
        
        async function makeCall() {
            const target = document.getElementById('call-target').value.trim();
            
            if (!target) {
                alert('Please enter a target URI');
                return;
            }
            
            try {
                const response = await fetch('/api/call', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ target })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    addLogEntry(\`Call initiated to \${target}\`, 'success');
                    document.getElementById('call-target').value = '';
                } else {
                    addLogEntry(\`Call failed: \${result.error}\`, 'error');
                }
                
            } catch (error) {
                addLogEntry(\`Call failed: \${error.message}\`, 'error');
            }
        }
        
        async function refreshTraining() {
            try {
                const response = await fetch('/api/refresh-training', {
                    method: 'POST'
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    addLogEntry('Training data refreshed successfully', 'success');
                } else {
                    addLogEntry(\`Training refresh failed: \${result.error}\`, 'error');
                }
                
            } catch (error) {
                addLogEntry(\`Training refresh failed: \${error.message}\`, 'error');
            }
        }
        
        function refreshDashboard() {
            fetchStatus();
            fetchLogs();
            addLogEntry('Dashboard refreshed', 'info');
        }
        
        function addLogEntry(message, type = 'info') {
            const container = document.getElementById('logs-container');
            const entry = document.createElement('div');
            entry.className = \`log-entry log-\${type}\`;
            entry.textContent = \`[\${new Date().toLocaleTimeString()}] \${message}\`;
            
            container.insertBefore(entry, container.firstChild);
            
            // Keep only last 20 entries
            while (container.children.length > 20) {
                container.removeChild(container.lastChild);
            }
        }
        
        function formatUptime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) {
                return \`\${days}d \${hours % 24}h \${minutes % 60}m\`;
            } else if (hours > 0) {
                return \`\${hours}h \${minutes % 60}m \${seconds % 60}s\`;
            } else if (minutes > 0) {
                return \`\${minutes}m \${seconds % 60}s\`;
            } else {
                return \`\${seconds}s\`;
            }
        }
        
        // Handle Enter key in call input
        document.getElementById('call-target').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                makeCall();
            }
        });
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            fetchStatus();
            fetchLogs();
            
            // Auto-refresh every 30 seconds
            refreshInterval = setInterval(() => {
                fetchStatus();
                fetchLogs();
            }, 30000);
        });
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', function() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        });
    </script>
</body>
</html>
    `;
  }

  logCall(type, target, status) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `${type.toUpperCase()} call ${status}: ${target}`
    };
    
    this.callLogs.push(logEntry);
    this.systemStats.totalCalls++;
    this.systemStats.lastCallTime = new Date();
    
    // Keep only last 100 logs
    if (this.callLogs.length > 100) {
      this.callLogs = this.callLogs.slice(-100);
    }
  }

  logError(message, error) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      message: `${message}: ${error.message || error}`
    };
    
    this.callLogs.push(logEntry);
    this.systemStats.errors.push(logEntry);
    
    // Keep only last 50 errors
    if (this.systemStats.errors.length > 50) {
      this.systemStats.errors = this.systemStats.errors.slice(-50);
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🌐 Voice AI Dashboard running at http://localhost:${this.port}`);
      console.log(`📊 Access the dashboard in your web browser`);
    });
  }
}

// Export for use in main application
module.exports = VoiceAIDashboard;

// Run standalone if called directly
if (require.main === module) {
  const dashboard = new VoiceAIDashboard();
  dashboard.start();
}
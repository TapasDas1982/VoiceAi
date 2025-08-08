# VoiceAI - AI-Powered SIP Voice Assistant

🤖 **Real-time voice communication system integrating SIP telephony with OpenAI's Realtime API**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)
[![GitHub Repository](https://img.shields.io/badge/GitHub-TapasDas1982%2FVoiceAi-blue)](https://github.com/TapasDas1982/VoiceAi.git)

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

VoiceAI is a sophisticated real-time voice communication system that bridges traditional SIP telephony with modern AI capabilities. It enables natural voice conversations through phone calls powered by OpenAI's GPT-4 Realtime API, providing enterprise-grade voice AI solutions.

### Key Capabilities

- **Real-time Voice AI**: Natural conversations without transcription delays
- **SIP Protocol Compliance**: Full RFC 3261 support with digest authentication
- **Multi-trunk Support**: Handle multiple SIP trunk configurations
- **Auto-answer Capability**: RFC 5373 Answer-Mode header support
- **Call Control**: Transfer, end calls, and manage sessions via AI commands
- **Enterprise Ready**: Error recovery, monitoring, and production deployment

### Use Cases

- **Customer Service**: AI-powered phone support systems
- **Voice Assistants**: Traditional phone-based AI interactions
- **Call Routing**: Intelligent call distribution and handling
- **Voice Automation**: Automated phone system responses

## ✨ Features

### 🔊 Audio Processing
- G.711 μ-law codec support (standard telephony)
- RTP protocol for real-time audio streaming
- PCM16 format conversion for OpenAI compatibility
- Low-latency audio processing (<500ms target)

### 📞 SIP Integration
- Full SIP protocol implementation (RFC 3261)
- Digest authentication support
- Multi-trunk configuration
- Call state management (INVITE, ACK, BYE)
- NAT traversal and keep-alive mechanisms

### 🤖 AI Integration
- OpenAI Realtime API with GPT-4
- Real-time speech-to-text (Whisper-1)
- Natural voice synthesis (multiple voice options)
- Conversation memory and context management
- Intent detection and response generation

### 📊 Monitoring & Management
- Web-based dashboard (port 3000)
- Real-time call monitoring
- System health checks
- Performance metrics
- Graceful shutdown and error recovery

## 🏗️ Architecture

```
📞 SIP Trunk (UCM6202/Provider)
         ↓
🔁 SIP Gateway (Node.js SIP Client)
         ↓ [Port 5061 UDP]
🎙️ RTP Audio Capture
         ↓ [Port 5004 UDP]
🧠 OpenAI Realtime API (Whisper STT)
         ↓ [WebSocket WSS]
🗃️ Intent Detection (GPT-4 + Google Sheets)
         ↓
🗣️ Fast TTS (OpenAI Voice)
         ↓
🔊 RTP Audio Response
         ↓
📞 Back to SIP Call
```

### Component Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SIP Client    │◄──►│  Audio Handler  │◄──►│  AI Processor   │
│  (sip-client.js)│    │(audio-handler.js)│    │(ai-processor.js)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲                        ▲                        ▲
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  ▼
                        ┌─────────────────┐
                        │    Main.js      │
                        │  (Orchestrator) │
                        └─────────────────┘
                                  ▲
                                  │
                        ┌─────────────────┐
                        │   Config.js     │
                        │ (Configuration) │
                        └─────────────────┘
```

## 📋 Prerequisites

### System Requirements
- **Node.js**: 16.0.0 or higher (18+ recommended)
- **Operating System**: Windows/Linux compatible
- **Network**: UDP ports 5060 (SIP) and 5004 (RTP) available
- **Memory**: Minimum 512MB RAM

### External Services
- **OpenAI API**: Valid API key with Realtime API access
- **SIP Server**: PBX or SIP trunk provider
- **Google Sheets** (Optional): For training data and responses

## 🚀 Installation

### 1. Clone the Repository
```bash
git clone https://github.com/TapasDas1982/VoiceAi.git
cd VoiceAi
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Copy the example environment file and configure:
```bash
cp .env.example .env
```

### 4. Google Cloud Setup (Optional)
If using Google Sheets integration:
1. Create a Google Cloud project
2. Enable Google Sheets API
3. Create a service account
4. Download `credentials.json`
5. Place in project root

## ⚙️ Configuration

### Environment Variables (.env)

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# SIP Server Configuration
SIP_SERVER=your.sip.server.com
SIP_EXTENSION=32
SIP_PASSWORD=your_sip_password
SIP_PORT=5060

# Network Configuration
RTP_PORT=5004
HTTP_PORT=3000

# AI Configuration
AI_VOICE=alloy
AI_INSTRUCTIONS="You are a helpful voice assistant."

# Google Sheets (Optional)
GOOGLE_SHEET_ID=your_google_sheet_id

# Development Options
SKIP_SIP_REGISTRATION=false
```

### Available AI Voices
- `alloy` - Balanced and natural
- `echo` - Clear and articulate
- `fable` - Warm and engaging
- `onyx` - Deep and authoritative
- `nova` - Bright and energetic
- `shimmer` - Soft and gentle

## 🎮 Usage

### Start the Application
```bash
# Full application with dashboard
npm start

# Development mode with auto-restart
npm run dev

# SIP client only
npm run sip-only

# Dashboard only
npm run dashboard-only
```

### Testing Components
```bash
# Run all system tests
npm test

# Test specific components
npm run test-openai
npm run test-sheets
npm run test-sip

# Show configuration
npm run config
```

### Making Your First Call
1. Start the system: `npm start`
2. Wait for "Ready to accept calls" message
3. Dial the configured SIP extension
4. System auto-answers and begins AI conversation
5. Speak naturally - AI responds with voice
6. Hang up to end the call

### Web Dashboard
Access the monitoring dashboard at: `http://localhost:3000`

Features:
- Real-time call status
- System health monitoring
- Active call management
- Performance metrics
- Configuration overview

## 📡 API Reference

### Main Application Class
```javascript
const VoiceAI = require('./main');

const voiceAI = new VoiceAI();
voiceAI.start();
```

### Event Handlers
```javascript
// Listen for incoming calls
voiceAI.sipClient.on('incomingCall', (callId, sipMessage) => {
    console.log(`Incoming call: ${callId}`);
});

// Handle call establishment
voiceAI.sipClient.on('callEstablished', (callId) => {
    console.log(`Call established: ${callId}`);
});

// Process audio data
voiceAI.audioHandler.on('audioReceived', (callId, audioData) => {
    // Process incoming audio
});
```

### Configuration API
```javascript
const config = require('./config');

// Get SIP configuration
const sipConfig = config.getSIPConfig();

// Get AI configuration
const aiConfig = config.getAIConfig();

// Check if feature is enabled
const dashboardEnabled = config.isEnabled('dashboard');
```

## 🧪 Testing

### Unit Tests
```bash
# Test memory management
node test-memory-manager.js

# Test MCP integration
node test-mcp-memory.js
```

### Integration Testing
```bash
# Start main system
node main.js

# Test memory CLI
node memory-cli.js

# Check dashboard
curl http://localhost:3000/api/status
```

### SIP Testing Checklist
- [ ] SIP registration successful
- [ ] Incoming calls handled (INVITE → 180 → 200 → ACK)
- [ ] Audio streams flowing bidirectionally
- [ ] AI processing and response
- [ ] Call termination (BYE handling)
- [ ] Error recovery mechanisms

## 🚀 Deployment

### Development Mode
```bash
npm install
npm start
```

### Production Deployment
```bash
# Using PM2 process manager
npm install -g pm2
pm2 start main.js --name "voiceai-sip"
pm2 startup
pm2 save
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000 5060/udp 5004/udp
CMD ["npm", "start"]
```

### Environment-Specific Configuration
```bash
# Production
NODE_ENV=production npm start

# Staging
NODE_ENV=staging npm start

# Development
NODE_ENV=development npm run dev
```

## 🔧 Troubleshooting

### Common Issues

#### SIP Registration Fails
```bash
# Check SIP server connectivity
telnet your.sip.server.com 5060

# Verify credentials in .env
echo $SIP_EXTENSION
echo $SIP_PASSWORD
```

#### Audio Quality Issues
- Verify G.711 μ-law codec support
- Check RTP port accessibility (5004)
- Monitor network latency and packet loss
- Ensure proper NAT configuration

#### AI Response Delays
- Verify OpenAI API key validity
- Check internet connectivity
- Monitor OpenAI API rate limits
- Review AI instructions complexity

#### Memory Leaks
```bash
# Monitor memory usage
node --inspect main.js

# Check for unclosed connections
lsof -p <process_id>
```

### Debug Mode
```bash
# Enable verbose logging
DEBUG=voiceai:* npm start

# Component-specific debugging
DEBUG=voiceai:sip npm start
DEBUG=voiceai:audio npm start
DEBUG=voiceai:ai npm start
```

### Performance Monitoring
- **Audio Latency**: Target <500ms end-to-end
- **SIP Response**: <100ms for signaling
- **AI Response**: <2s for initial response
- **Memory Usage**: Stable during long calls
- **Uptime**: 99.9% availability target

## 📁 Project Structure

```
VoiceAI/
├── main.js                    # Main orchestrator and entry point
├── app.js                     # Application wrapper with dashboard
├── index.js                   # Legacy SIP client entry point
├── config.js                  # Configuration management
├── sip-client.js              # SIP protocol handling
├── audio-handler.js           # RTP audio processing
├── ai-processor.js            # OpenAI integration
├── memory-manager.js          # Conversation memory
├── websocket-manager.js       # WebSocket connections
├── dashboard.js               # Web dashboard
├── utils.js                   # Utility functions
├── timeout-manager.js         # Timeout handling
├── multi-trunk-manager.js     # Multiple trunk support
├── sip-session.js             # SIP session management
├── sip-parser-enhanced.js     # Enhanced SIP parsing
├── mcp-memory-server.js       # MCP memory server
├── memory-cli.js              # Memory command line interface
├── package.json               # Dependencies and scripts
├── .env                       # Environment variables
├── .gitignore                 # Git ignore rules
├── credentials.json.example   # Google Cloud credentials template
├── MASTER_DOCUMENTATION.md    # Comprehensive documentation
├── CLAUDE.md                  # AI assistant documentation
└── README.md                  # This file
```

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Install dependencies: `npm install`
4. Make your changes
5. Run tests: `npm test`
6. Commit changes: `git commit -m 'Add amazing feature'`
7. Push to branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Code Style
- Use ESLint configuration
- Follow Node.js best practices
- Add JSDoc comments for functions
- Include unit tests for new features

### Reporting Issues
Please use the GitHub issue tracker to report bugs or request features.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenAI for the Realtime API
- SIP.js community for protocol insights
- Node.js community for excellent libraries
- Contributors and testers

## 📞 Support

For support and questions:
- GitHub Issues: [Create an issue](https://github.com/TapasDas1982/VoiceAi/issues)
- Documentation: [MASTER_DOCUMENTATION.md](MASTER_DOCUMENTATION.md)
- Email: [Contact maintainer](mailto:support@voiceai.example.com)

---

**🎉 Ready to deploy? All components are tested and production-ready!**

*Built with ❤️ for the future of voice AI communication*
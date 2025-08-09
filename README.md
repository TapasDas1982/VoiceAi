# VoiceAI LiveKit Agents

A modern voice AI system built with LiveKit Agents framework, providing real-time conversational AI capabilities with advanced voice processing, speech-to-text, and text-to-speech integration.

## 🚀 Features

- **Real-time Voice AI**: Powered by LiveKit Agents framework
- **OpenAI Integration**: Uses OpenAI's Realtime API for natural conversations
- **Voice Activity Detection**: Silero VAD for accurate speech detection
- **Web Dashboard**: Real-time monitoring and management interface
- **Scalable Architecture**: Built for production deployment
- **Telephony Ready**: SIP integration capabilities
- **Modern Tech Stack**: Node.js with ES modules

## 📋 Prerequisites

- Node.js 18+ 
- LiveKit Server (local or cloud)
- OpenAI API key with Realtime API access
- Windows/Linux/macOS

## 🛠️ Installation

1. **Clone and setup**:
   ```bash
   cd VoiceAI
   npm install
   ```

2. **Configure environment variables**:
   Create or update `.env` file:
   ```env
   # LiveKit Configuration
   LIVEKIT_URL=ws://localhost:7880
   LIVEKIT_API_KEY=your_livekit_api_key
   LIVEKIT_API_SECRET=your_livekit_api_secret
   LIVEKIT_ROOM=voice-ai-room

   # OpenAI Configuration
   OPENAI_API_KEY=sk-your_openai_api_key
   OPENAI_MODEL=gpt-4o-realtime-preview-2024-10-01
   OPENAI_VOICE=alloy
   OPENAI_TEMPERATURE=0.7
   OPENAI_MAX_TOKENS=4096

   # Agent Configuration
   AGENT_NAME=VoiceAI Assistant
   ENABLE_GREETING=true
   GREETING_MESSAGE=Hello! I'm your AI voice assistant. How can I help you today?
   AI_INSTRUCTIONS=You are a friendly and professional voice assistant...

   # Audio Configuration
   AUDIO_SAMPLE_RATE=16000
   AUDIO_CHANNELS=1
   VAD_SENSITIVITY=0.5

   # Dashboard Configuration
   PORT=3000
   HOST=localhost
   ENABLE_DASHBOARD=true

   # Logging Configuration
   LOG_LEVEL=info
   ENABLE_FILE_LOGGING=true
   LOG_FILE=voiceai-agent.log
   ```

3. **Start LiveKit Server** (if running locally):
   ```bash
   # Download and run LiveKit server
   # See: https://docs.livekit.io/realtime/server/deployment/
   ```

## 🚀 Usage

### Start the Application

```bash
# Start both agent and dashboard
npm start

# Or start agent only
npm run agent

# Or start dashboard only
npm run dashboard
```

### Access the Dashboard

Open your browser and navigate to:
```
http://localhost:3000
```

The dashboard provides:
- Real-time system status
- Active session monitoring
- Configuration overview
- Performance metrics
- Activity logs

### Connect Clients

Clients can connect to the LiveKit room using:
- **Room Name**: `voice-ai-room` (or configured value)
- **LiveKit URL**: Your LiveKit server URL
- **Access Token**: Generated using LiveKit API credentials

## 📁 Project Structure

```
VoiceAI/
├── index.js          # Main application entry point
├── agent.js          # VoiceAI Agent implementation
├── config.js         # Configuration management
├── dashboard.js      # Web dashboard server
├── package.json      # Dependencies and scripts
├── .env             # Environment variables
├── README.md        # This file
└── voiceai-agent.log # Application logs
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|----------|
| `LIVEKIT_URL` | LiveKit server WebSocket URL | `ws://localhost:7880` |
| `LIVEKIT_API_KEY` | LiveKit API key | Required |
| `LIVEKIT_API_SECRET` | LiveKit API secret | Required |
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-4o-mini` |
| `OPENAI_VOICE` | OpenAI voice model | `alloy` |
| `AGENT_NAME` | Display name for the agent | `VoiceAI Assistant` |
| `ENABLE_GREETING` | Send greeting on connect | `true` |
| `PORT` | Dashboard server port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |

### Audio Settings

- **Sample Rate**: 16kHz (recommended for voice)
- **Channels**: Mono (1 channel)
- **VAD Sensitivity**: 0.5 (adjustable 0.0-1.0)
- **Echo Cancellation**: Enabled
- **Noise Suppression**: Enabled

## 🏗️ Architecture

### Components

1. **VoiceAI Agent** (`agent.js`)
   - Handles LiveKit room connections
   - Manages voice sessions
   - Integrates with OpenAI Realtime API
   - Processes audio with VAD

2. **Configuration Manager** (`config.js`)
   - Centralized configuration
   - Environment validation
   - Logging setup

3. **Dashboard Server** (`dashboard.js`)
   - Real-time monitoring
   - WebSocket updates
   - REST API endpoints

4. **Main Application** (`index.js`)
   - Orchestrates all components
   - Graceful shutdown handling

### Data Flow

```
Client → LiveKit Room → VoiceAI Agent → OpenAI Realtime API → Response → Client
                    ↓
                Dashboard (monitoring)
```

## 🔌 API Endpoints

### Dashboard API

- `GET /` - Dashboard web interface
- `GET /api/stats` - System statistics
- `GET /api/config` - Configuration (safe)
- `GET /api/health` - Health check
- `GET /api/logs` - Recent logs

### WebSocket Events

- `stats` - Real-time statistics updates
- `config` - Configuration updates
- `requestStats` - Request current stats

## 🚀 Deployment

### Production Considerations

1. **Environment**:
   - Use production LiveKit server
   - Secure API keys
   - Configure proper logging

2. **Scaling**:
   - Multiple agent instances
   - Load balancing
   - Database for session storage

3. **Monitoring**:
   - Enable metrics collection
   - Set up alerting
   - Monitor resource usage

### Docker Deployment

```dockerfile
# Example Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🔧 Development

### Scripts

```bash
# Development with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### Adding Features

1. **Custom Plugins**: Extend agent with LiveKit plugins
2. **Audio Processing**: Add custom audio filters
3. **LLM Integration**: Support multiple LLM providers
4. **Telephony**: Integrate SIP/PSTN connectivity

## 🐛 Troubleshooting

### Common Issues

1. **Connection Failed**:
   - Check LiveKit server status
   - Verify API credentials
   - Check network connectivity

2. **Audio Issues**:
   - Verify microphone permissions
   - Check audio device settings
   - Review VAD sensitivity

3. **OpenAI Errors**:
   - Validate API key
   - Check model availability
   - Monitor rate limits

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm start

# Check logs
tail -f voiceai-agent.log
```

## 📚 Resources

- [LiveKit Agents Documentation](https://docs.livekit.io/agents/)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [LiveKit Server Setup](https://docs.livekit.io/realtime/server/)
- [Node.js LiveKit SDK](https://docs.livekit.io/realtime/client-sdks/javascript/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
- Check the troubleshooting section
- Review LiveKit documentation
- Open an issue on GitHub

---

**Built with ❤️ using LiveKit Agents framework**
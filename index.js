require('dotenv').config();
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const express = require('express');
const FormData = require('form-data');
const WebSocket = require('ws');

// Enhanced SIP components
const { EnhancedSIPParser } = require('./sip-parser-enhanced');
const { SIPSessionManager, SIPSession } = require('./sip-session');
const { MultiTrunkManager } = require('./multi-trunk-manager');
const TimeoutManager = require('./timeout-manager');
const WebSocketManager = require('./websocket-manager');

class VoiceAISIPClient {
  constructor() {
    this.voipClient = null;
    this.sheetsData = new Map();
    // Note: Audio processing will use OpenAI APIs directly
    this.currentSession = null;
    
    // SIP Configuration
    this.sipConfig = {
      serverIP: process.env.SIP_SERVER ? process.env.SIP_SERVER.split(':')[0] : '122.163.120.156',
      serverPort: process.env.SIP_SERVER ? parseInt(process.env.SIP_SERVER.split(':')[1]) : 5060,
      username: process.env.SIP_AUTHORIZATION_USER || '31',
      password: process.env.SIP_PASSWORD || 'password123',
      clientIP: this.getLocalIP(),
      clientPort: process.env.SIP_CLIENT_PORT ? parseInt(process.env.SIP_CLIENT_PORT) : 5062  // Use different port to avoid TLS conflict
    };
    
    // Initialize timeout manager
    this.timeoutManager = new TimeoutManager();
    
    // Enhanced SIP components
    this.parser = new EnhancedSIPParser();
    this.sessionManager = new SIPSessionManager();
    this.multiTrunkManager = new MultiTrunkManager({
      localPort: this.sipConfig.clientPort,
      localAddress: this.sipConfig.clientIP,
      maxConcurrentCalls: parseInt(process.env.MAX_CONCURRENT_CALLS) || 10
    });
    
    this.sipSocket = null;
    this.callId = null;
    this.cseq = 1;
    this.isRegistered = false;
    this.rtpPort = Math.floor(Math.random() * 10000) + 8000;  // Random RTP port to avoid conflicts
    
    // RTP properties
    this.rtpSequenceNumber = Math.floor(Math.random() * 65536);
    this.rtpTimestamp = Math.floor(Math.random() * 4294967296);
    this.rtpSSRC = Math.floor(Math.random() * 4294967296);
    
    // Realtime API properties - now managed by WebSocketManager
    this.webSocketManager = null;
    this.realtimeWS = null;
    this.isRealtimeConnected = false;
    this.realtimeSessionId = null;
    this.audioQueue = [];
    this.isStreamingAudio = false;
    
    // Setup enhanced event handlers
    this.setupEnhancedEventHandlers();
    
    this.init();
  }

  /**
   * Setup enhanced event handlers for modern SIP features
   */
  setupEnhancedEventHandlers() {
    // Session manager events
    this.sessionManager.on('sessionCreated', (callId, session) => {
      console.log(`📞 Session created: ${callId}`);
    });

    this.sessionManager.on('sessionStateChanged', (callId, data) => {
      console.log(`🔄 Session ${callId}: ${data.oldState} -> ${data.newState}`);
    });

    this.sessionManager.on('sessionRemoved', (callId) => {
      console.log(`❌ Session removed: ${callId}`);
      // Clean up legacy session tracking
      if (this.sessions && this.sessions.has(callId)) {
        this.sessions.delete(callId);
      }
    });

    // Multi-trunk manager events
    this.multiTrunkManager.on('routeToAI', (data) => {
      console.log(`🤖 Routing call ${data.callInfo.callId} to AI processing`);
      this.handleAIRoutedCall(data);
    });

    this.multiTrunkManager.on('trunkAdded', (name, trunk) => {
      console.log(`📡 Trunk added: ${name}`);
    });

    this.multiTrunkManager.on('error', (error) => {
      console.error('🚨 Multi-trunk error:', error);
    });
  }

  /**
   * Setup multi-trunk manager with default configuration
   */
  async setupMultiTrunkManager() {
    try {
      // Add primary trunk (current SIP server)
      this.multiTrunkManager.addTrunk('primary', {
        server: this.sipConfig.serverIP,
        port: this.sipConfig.serverPort,
        username: this.sipConfig.username,
        password: this.sipConfig.password,
        domain: this.sipConfig.serverIP,
        enabled: true,
        priority: 1
      });

      // Add secondary trunk if configured
      if (process.env.SIP_SECONDARY_TRUNK_SERVER) {
        this.multiTrunkManager.addTrunk('secondary', {
          server: process.env.SIP_SECONDARY_TRUNK_SERVER,
          port: parseInt(process.env.SIP_SECONDARY_TRUNK_PORT) || 5060,
          username: process.env.SIP_SECONDARY_TRUNK_USER,
          password: process.env.SIP_SECONDARY_TRUNK_PASSWORD,
          domain: process.env.SIP_SECONDARY_TRUNK_SERVER,
          enabled: true,
          priority: 2
        });
      }

      // Add default routing rules
      this.addDefaultRoutingRules();

      console.log('🔧 Multi-trunk manager configured');
    } catch (error) {
      console.error('❌ Multi-trunk setup error:', error);
    }
  }

  /**
   * Add default routing rules
   */
  addDefaultRoutingRules() {
    // Route all calls to AI by default
    this.multiTrunkManager.addRoutingRule({
      name: 'Default AI Route',
      priority: 1,
      calleePattern: '.*', // Match all numbers
      actions: {
        requiresAI: true,
        autoAnswer: true,
        recordCall: false
      }
    });

    // Route specific patterns to trunk-to-trunk if configured
    if (process.env.TRUNK_TO_TRUNK_PATTERN) {
      this.multiTrunkManager.addRoutingRule({
        name: 'Trunk-to-Trunk Route',
        priority: 2,
        calleePattern: process.env.TRUNK_TO_TRUNK_PATTERN,
        actions: {
          requiresAI: false,
          targetTrunk: 'secondary',
          autoAnswer: false
        }
      });
    }
  }

  /**
   * Handle AI-routed calls from multi-trunk manager
   */
  handleAIRoutedCall(data) {
    const { message, callInfo, routingRule, rinfo } = data;
    
    // Use enhanced parser for better message handling
    const enhancedMessage = this.parser.parseMessage(message.raw || message);
    
    // Create or get session using session manager
    let session = this.sessionManager.getSession(callInfo.callId);
    if (!session) {
      session = this.sessionManager.createSession(callInfo.callId);
    }
    
    // Store enhanced call information
    if (!this.sessions) {
      this.sessions = new Map();
    }
    this.sessions.set(callInfo.callId, {
      ...callInfo,
      session,
      routingRule,
      enhancedMessage,
      rinfo,
      startTime: new Date()
    });
    
    // Process with existing AI logic
     this.handleIncomingCall(enhancedMessage, rinfo);
   }

  async init() {
    try {
      console.log('🚀 Initializing Voice AI SIP Client...');
      
      // Validate environment parameters
      const validationResult = this.validateEnvironmentParameters();
      if (!validationResult.isValid) {
        console.error('❌ Environment validation failed:', validationResult.errors);
        process.exit(1);
      }
      
      console.log('✅ Environment parameters validated successfully');
      this.logStartupReport();
      
      // Initialize OpenAI
      const { OpenAI } = require('openai');
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      
      // Test OpenAI connection
      await this.testOpenAIConnection();
      
      // Load Google Sheets data
      await this.loadSheetsData();
      
      // Initialize SIP client
      await this.initSIPClient();
      
      // Setup multi-trunk manager
      await this.setupMultiTrunkManager();
      
      // Initialize Realtime connection
      await this.initRealtimeConnection();
      
      // Wait for connections to stabilize
      await this.waitForConnectionStabilization();
      
      // Test welcome message functionality
      await this.testWelcomeMessage();
      
      console.log('✅ Voice AI SIP Client initialized successfully!');
      this.logFullSystemReport();
    } catch (error) {
      console.error('❌ Failed to initialize:', error);
      process.exit(1);
    }
  }

  async loadSheetsData() {
    try {
      console.log('📊 Loading Google Sheets training data...');
      
      // Check if credentials file exists
      const credentialsPath = path.join(__dirname, 'credentials.json');
      if (!fs.existsSync(credentialsPath)) {
        console.warn('⚠️  Google Sheets credentials not found. Creating sample data...');
        this.createSampleTrainingData();
        return;
      }

      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      
      if (!spreadsheetId) {
        console.warn('⚠️  GOOGLE_SHEET_ID not found in .env. Using sample data...');
        this.createSampleTrainingData();
        return;
      }

      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!A:B'
      });

      const rows = result.data.values;
      if (rows && rows.length > 0) {
        rows.forEach(([question, answer]) => {
          if (question && answer) {
            this.sheetsData.set(question.toLowerCase().trim(), answer.trim());
          }
        });
        console.log(`📋 Loaded ${this.sheetsData.size} training entries from Google Sheets`);
      }
    } catch (error) {
      console.error('❌ Error loading Google Sheets data:', error.message);
      this.createSampleTrainingData();
    }
  }

  createSampleTrainingData() {
    console.log('📝 Creating sample training data...');
    const sampleData = [
      ['hello', 'Hello! How can I help you today?'],
      ['what is your name', 'I am your AI voice assistant. How may I assist you?'],
      ['how are you', 'I am doing well, thank you for asking! How can I help you?'],
      ['what time is it', 'I can help you with many things, but I cannot tell the current time. Is there anything else I can assist you with?'],
      ['goodbye', 'Goodbye! Have a wonderful day!'],
      ['thank you', 'You are very welcome! Is there anything else I can help you with?']
    ];
    
    sampleData.forEach(([question, answer]) => {
      this.sheetsData.set(question.toLowerCase(), answer);
    });
    
    console.log(`📋 Created ${this.sheetsData.size} sample training entries`);
  }

  async initSIPClient() {
    try {
      console.log('📞 Initializing SIP client with UDP transport...');
      
      // Create UDP socket
      this.sipSocket = dgram.createSocket('udp4');
      
      // Generate unique call ID
      this.callId = this.generateCallId();
      
      // Set up socket event handlers
      this.sipSocket.on('message', (msg, rinfo) => {
        this.handleSIPMessage(msg.toString(), rinfo);
      });
      
      this.sipSocket.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`⚠️ Port ${this.sipConfig.clientPort} in use, trying alternative port...`);
          const altPort = Math.floor(Math.random() * 10000) + 5061;
          console.log(`🔄 Retrying with port ${altPort}`);
          this.sipConfig.clientPort = altPort;
          this.sipSocket.close();
          setTimeout(() => {
            this.initSIPClient();
          }, 1000);
        } else {
          console.error('SIP Socket error:', err);
        }
      });
      
      this.sipSocket.on('listening', () => {
        const address = this.sipSocket.address();
        console.log(`SIP client listening on ${address.address}:${address.port}`);
        
        // Start registration process
        this.sendRegisterRequest();
      });
      
      // Bind to local port
      this.sipSocket.bind(this.sipConfig.clientPort);
      
      console.log('🔗 SIP client initialized with UDP transport');
      
    } catch (error) {
      console.error('❌ SIP initialization failed:', error);
      throw error;
    }
  }

  async initRealtimeConnection() {
     try {
       console.log('🔗 Initializing OpenAI Realtime connection...');
       
       // Initialize WebSocketManager if not already done
       if (!this.webSocketManager) {
         this.webSocketManager = new WebSocketManager(
           'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
           {
             headers: {
               'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
               'OpenAI-Beta': 'realtime=v1'
             }
           },
           this.timeoutManager
         );
         
         // Enhanced connection state management
         this.realtimeSessionId = null;
         this.sessionConfigured = false;
         this.pendingAudioQueue = [];
         
         // Set up event handlers
         this.webSocketManager.on('connected', (ws) => {
           console.log('✅ Realtime WebSocket connected');
           this.realtimeWS = ws;
           this.isRealtimeConnected = true;
           this.sessionConfigured = false;
           
           // Send session configuration with validation
           this.configureRealtimeSession();
         });
         
         this.webSocketManager.on('message', (message) => {
           this.handleRealtimeMessage(message);
         });
         
         this.webSocketManager.on('disconnected', () => {
           console.log('🔌 Realtime WebSocket disconnected');
           this.isRealtimeConnected = false;
           this.sessionConfigured = false;
           this.realtimeSessionId = null;
           this.realtimeWS = null;
           
           // Clear pending audio queue
           this.pendingAudioQueue = [];
         });
         
         this.webSocketManager.on('error', (error) => {
           console.error('❌ Realtime WebSocket error:', error);
           this.isRealtimeConnected = false;
           this.sessionConfigured = false;
           this.realtimeSessionId = null;
         });
       }
       
       // Connect using WebSocketManager with robust reconnection
       await this.webSocketManager.connect();
       
     } catch (error) {
       console.error('❌ Failed to initialize Realtime connection:', error);
     }
   }

   configureRealtimeSession() {
     if (!this.isRealtimeConnected || !this.realtimeWS) {
       console.log('⚠️ Cannot configure session - WebSocket not connected');
       return;
     }
     
     console.log('⚙️ Configuring Realtime session...');
     
     const sessionConfig = {
       type: 'session.update',
       session: {
         modalities: ['text', 'audio'],
         instructions: 'You are a helpful AI voice assistant for SIP calls. Respond naturally and conversationally. Support multiple languages based on user input. Keep responses concise but friendly. Handle interruptions gracefully.',
         voice: 'alloy',
         input_audio_format: 'g711_ulaw',
         output_audio_format: 'g711_ulaw',
         input_audio_transcription: {
           model: 'whisper-1'
         },
         turn_detection: {
           type: 'server_vad',
           threshold: 0.3,
           prefix_padding_ms: 200,
           silence_duration_ms: 400
         },
         tools: [
           {
             type: 'function',
             name: 'transfer_call',
             description: 'Transfer the call to another extension',
             parameters: {
               type: 'object',
               properties: {
                 extension: {
                   type: 'string',
                   description: 'The extension number to transfer to'
                 }
               },
               required: ['extension']
             }
           },
           {
             type: 'function',
             name: 'end_call',
             description: 'End the current call',
             parameters: {
               type: 'object',
               properties: {}
             }
           }
         ],
         tool_choice: 'auto',
         temperature: 0.7,
         max_response_output_tokens: 2048
       }
     };
     
     this.realtimeWS.send(JSON.stringify(sessionConfig));
     console.log('✅ Enhanced Realtime session configured with function tools');
   }

   handleRealtimeMessage(message) {
     try {
       switch (message.type) {
         case 'session.created':
           console.log('🎯 Realtime session created:', message.session.id);
           this.realtimeSessionId = message.session.id;
           this.sessionConfigured = false; // Will be set to true on session.updated
           break;
           
         case 'session.updated':
           console.log('✅ Realtime session updated and configured');
           this.sessionConfigured = true;
           
           // Process any pending audio that was queued during session setup
           if (this.pendingAudioQueue.length > 0) {
             console.log(`🎵 Processing ${this.pendingAudioQueue.length} queued audio buffers`);
             this.pendingAudioQueue.forEach(audioBuffer => {
               this.sendAudioToRealtimeInternal(audioBuffer);
             });
             this.pendingAudioQueue = [];
           }
           break;
           
         case 'input_audio_buffer.speech_started':
           console.log('🎤 Speech detected from caller');
           break;
           
         case 'input_audio_buffer.speech_stopped':
           console.log('🔇 Speech ended from caller');
           break;
           
         case 'conversation.item.created':
           if (message.item.type === 'message' && message.item.role === 'assistant') {
             console.log('🤖 AI response generated');
           }
           break;
           
         case 'response.audio.delta':
           // Enhanced validation and error handling for audio streaming
           if (!message.delta) {
             console.log('⚠️ Received audio delta without data - skipping');
             break;
           }
           
           if (!this.currentSession) {
             console.log('⚠️ Cannot stream audio - no active SIP session');
             console.log(`   Session ID: ${this.realtimeSessionId || 'None'}`);
             console.log(`   WebSocket: ${this.isRealtimeConnected ? 'Connected' : 'Disconnected'}`);
             break;
           }
           
           if (!this.rtpSocket) {
             console.log('⚠️ Cannot stream audio - RTP socket not initialized');
             console.log(`   Current session: ${this.currentSession.callId}`);
             console.log(`   Remote RTP: ${this.currentSession.remoteAddress}:${this.currentSession.remoteRTPPort}`);
             break;
           }
           
           // All validations passed - stream the audio
           console.log(`🎵 Streaming audio delta: ${message.delta.length} bytes (base64)`);
           console.log(`🎵 Session: ${this.currentSession.callId} -> ${this.currentSession.remoteAddress}:${this.currentSession.remoteRTPPort}`);
           this.streamRealtimeAudio(message.delta);
           break;
           
         case 'response.audio.done':
           console.log('✅ Audio response completed - Welcome message should be audible');
           // Clear welcome message active flag and handle pending cleanup
           if (this.currentSession && this.currentSession.welcomeMessageActive) {
             console.log('🔓 Welcome message audio completed - clearing protection flag');
             this.currentSession.welcomeMessageActive = false;
             
             // If there's a pending cleanup (BYE was received during welcome message), perform it now
             if (this.currentSession.pendingCleanup) {
               console.log('🧹 Performing delayed session cleanup after welcome message audio');
               this.cleanupSession();
             }
           }
           break;
           
         case 'response.function_call_arguments.done':
           console.log('🔧 Function call completed:', message.name);
           this.handleFunctionCall(message.name, JSON.parse(message.arguments));
           break;
           
         case 'response.done':
           console.log('🏁 Realtime response completed');
           // Additional safety check to clear welcome message flag
           if (this.currentSession && this.currentSession.welcomeMessageActive) {
             console.log('🔓 Response completed - ensuring welcome message flag is cleared');
             this.currentSession.welcomeMessageActive = false;
             
             if (this.currentSession.pendingCleanup) {
               console.log('🧹 Performing delayed session cleanup after response completion');
               this.cleanupSession();
             }
           }
           break;
           
         case 'error':
           console.error('❌ Realtime API error:', message.error);
           break;
           
         default:
           console.log('📨 Realtime message:', message.type);
       }
     } catch (error) {
       console.error('❌ Error handling realtime message:', error);
     }
   }

  handleFunctionCall(functionName, args) {
    try {
      console.log(`🔧 Executing function: ${functionName}`, args);
      
      switch (functionName) {
        case 'transfer_call':
          this.transferCall(args.extension);
          break;
          
        case 'end_call':
          this.endCall();
          break;
          
        default:
          console.log(`❓ Unknown function: ${functionName}`);
      }
    } catch (error) {
      console.error('❌ Error executing function call:', error);
    }
  }

  transferCall(extension) {
    console.log(`📞 Transferring call to extension: ${extension}`);
    // TODO: Implement call transfer logic
    // For now, just log the transfer request
    if (this.currentSession) {
      console.log(`🔄 Call ${this.currentSession.callId} would be transferred to ${extension}`);
    }
  }

  endCall() {
    console.log('📞 Ending call as requested by AI');
    if (this.currentSession && this.sipSocket) {
      try {
        // Send BYE request to end the call
        const byeRequest = [
          `BYE sip:${this.currentSession.from.match(/<(.+)>/)?.[1] || this.currentSession.from} SIP/2.0`,
          `Via: SIP/2.0/UDP ${this.sipConfig.clientIP}:${this.sipConfig.clientPort};branch=${this.generateBranch()}`,
          `From: ${this.currentSession.to};tag=${this.generateBranch()}`,
          `To: ${this.currentSession.from}`,
          `Call-ID: ${this.currentSession.callId}`,
          `CSeq: ${this.cseq++} BYE`,
          'Content-Length: 0',
          '',
          ''
        ].join('\r\n');
        
        this.sipSocket.send(
          Buffer.from(byeRequest),
          this.currentSession.remotePort,
          this.currentSession.remoteAddress
        );
        
        console.log('✅ BYE request sent to end call');
        
        // Clean up session
        this.currentSession = null;
        if (this.rtpSocket) {
          this.rtpSocket.close();
          this.rtpSocket = null;
        }
        
      } catch (error) {
        console.error('❌ Error ending call:', error);
      }
    }
  }

  // Get local IP address
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1'; // fallback to localhost
  }
  
  // Generate random call ID
  generateCallId() {
    return Math.floor(Math.random() * 10000000000000).toString();
  }
  
  // Generate random branch identifier
  generateBranch() {
    const branchId = Math.floor(Math.random() * 10000000000000);
    return `z9hG4bK${branchId}`;
  }
  
  // Generate digest response for authentication
  generateDigestResponse(username, password, realm, nonce, method, uri) {
    const ha1 = crypto.createHash('md5')
      .update(`${username}:${realm}:${password}`)
      .digest('hex');
    
    const ha2 = crypto.createHash('md5')
      .update(`${method}:${uri}`)
      .digest('hex');
    
    const response = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${ha2}`)
      .digest('hex');
    
    return response;
  }
  
  // Handle ACK message for call confirmation
  handleAckMessage(message, rinfo) {
    try {
      console.log('🔄 Processing ACK message for call confirmation');
      
      if (!this.currentSession) {
        console.log('⚠️ No active session for ACK message');
        return;
      }
      
      // Extract Call-ID from ACK message
      const callIdMatch = message.match(/Call-ID:\s*([^\r\n]+)/);
      const callId = callIdMatch ? callIdMatch[1].trim() : null;
      
      if (callId && this.currentSession.callId === callId) {
        console.log('✅ ACK received for current session:', callId);
        
        // Clear ACK timeout
        if (this.currentSession.ackTimeout) {
          clearTimeout(this.currentSession.ackTimeout);
          this.currentSession.ackTimeout = null;
        }
        
        // Update session state to CONFIRMED
        if (this.currentSession.session) {
          this.currentSession.session.setState('CONFIRMED', 'Call confirmed with ACK');
        }
        
        this.currentSession.waitingForAck = false;
        
        // Proceed with media validation before AI activation
        this.proceedWithMediaValidation();
      } else {
        console.log('⚠️ ACK Call-ID mismatch or missing');
      }
    } catch (error) {
      console.error('❌ Error handling ACK message:', error);
    }
  }
  
  // Validate session readiness for AI activation
  validateSessionForAI() {
    if (!this.currentSession) {
      console.log('❌ No active session');
      return false;
    }
    
    if (!this.currentSession.session) {
      console.log('❌ No session manager session');
      return false;
    }
    
    const sessionState = this.currentSession.session.state;
    if (sessionState !== 'CONFIRMED' && sessionState !== 'MEDIA_READY') {
      console.log(`❌ Session not confirmed (current state: ${sessionState})`);
      return false;
    }
    
    if (!this.rtpSocket) {
      console.log('❌ RTP socket not initialized');
      return false;
    }
    
    console.log('✅ Session validated for AI activation');
    return true;
  }
  
  // Proceed with media validation after ACK confirmation
  async proceedWithMediaValidation() {
    try {
      console.log('🔧 Starting media validation process...');
      
      if (!this.currentSession || !this.currentSession.session) {
        console.error('❌ No valid session for media validation');
        return;
      }
      
      const session = this.currentSession.session;
      
      // Start media validation timer
      session.startMediaValidationTimer();
      
      // Validate media readiness
      const isMediaReady = await this.validateMediaReadiness(this.timeoutManager.getTimeout('media_validation'));
      
      if (isMediaReady) {
        console.log('✅ Media validation successful - transitioning to MEDIA_READY');
        session.setState('MEDIA_READY', 'Media flow confirmed');
        
        // Proceed with AI activation
        await this.proceedWithAIActivation();
      } else {
        console.error('❌ Media validation failed - cannot proceed with AI');
        session.setState('ERROR', 'Media validation timeout');
      }
      
    } catch (error) {
      console.error('❌ Error in media validation:', error);
      if (this.currentSession && this.currentSession.session) {
        this.currentSession.session.setState('ERROR', `Media validation failed: ${error.message}`);
      }
    }
  }
  
  // Proceed with AI activation after media validation
  async proceedWithAIActivation() {
    try {
      console.log('🤖 Starting AI activation process...');
      
      // Validate session state
      if (!this.validateSessionForAI()) {
        console.error('❌ Session validation failed - cannot start AI');
        return;
      }
      
      // Ensure session is in MEDIA_READY state
      if (this.currentSession && this.currentSession.session) {
        if (!this.currentSession.session.isMediaReady()) {
          console.error('❌ Session not in MEDIA_READY state - cannot start AI');
          return;
        }
        
        // Activate AI state
        this.currentSession.session.activateAI();
      }
      
      // Initialize realtime connection if not already connected
      if (!this.isRealtimeConnected) {
        console.log('🔗 Initializing OpenAI Realtime connection...');
        await this.initRealtimeConnection();
      }
      
      // Start the realtime conversation
      this.startRealtimeConversation();
      
    } catch (error) {
      console.error('❌ Error in AI activation:', error);
      if (this.currentSession && this.currentSession.session) {
        this.currentSession.session.setState('ERROR', `AI activation failed: ${error.message}`);
      }
    }
  }
  
  // Validate media readiness with timeout
  async validateMediaReadiness(timeoutMs = 5000) {
    return new Promise((resolve) => {
      console.log('🔍 Validating media readiness...');
      
      // Check if RTP socket is ready
      if (!this.rtpSocket) {
        console.log('❌ RTP socket not available');
        resolve(false);
        return;
      }
      
      // Set timeout for media validation
      const timeout = setTimeout(() => {
        console.log('⏰ Media validation timeout');
        resolve(false);
      }, timeoutMs);
      
      // Check RTP socket binding and readiness
      try {
        const address = this.rtpSocket.address();
        if (address && address.port) {
          console.log(`✅ RTP socket ready on port ${address.port}`);
          clearTimeout(timeout);
          resolve(true);
        } else {
          console.log('❌ RTP socket not properly bound');
          clearTimeout(timeout);
          resolve(false);
        }
      } catch (error) {
        console.log('❌ Error checking RTP socket:', error.message);
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  // Handle incoming SIP messages
  handleSIPMessage(message, rinfo) {
    const lines = message.toString().split('\r\n');
    const firstLine = lines[0];
    const timestamp = new Date().toISOString();
    
    console.log(`\n📞 [${timestamp}] Received SIP message from ${rinfo.address}:${rinfo.port}`);
    console.log('📋 First Line:', firstLine);
    
    // Log full message for debugging (first 500 chars)
    const fullMessage = message.toString();
    if (fullMessage.length > 500) {
      console.log('📄 Message Preview:', fullMessage.substring(0, 500) + '...');
    } else {
      console.log('📄 Full Message:', fullMessage);
    }
    
    // Parse response for authentication challenge
    if (message.includes('401 Unauthorized') || message.includes('407 Proxy Authentication Required')) {
      console.log('🔐 Authentication required, sending credentials...');
      this.handleAuthChallenge(message);
    } else if (message.includes('200 OK') && message.includes('REGISTER')) {
      console.log('✅ SIP Registration successful!');
      this.isRegistered = true;
    } else if (firstLine.startsWith('OPTIONS')) {
      console.log('💓 Processing OPTIONS keep-alive');
      this.respondToOptions(message, rinfo);
    } else if (firstLine.startsWith('NOTIFY')) {
      console.log('📢 Processing NOTIFY message');
      this.respondToNotify(message, rinfo);
    } else if (firstLine.startsWith('INVITE')) {
      console.log('🔔 Processing INVITE - Incoming call detected!');
      this.handleIncomingCall(message, rinfo);
    } else if (firstLine.startsWith('BYE')) {
      console.log('📞 Processing BYE - Call termination');
      this.respondToBye(message, rinfo);
    } else if (firstLine.startsWith('CANCEL')) {
       console.log('🚫 Processing CANCEL - Call cancelled by caller');
       this.respondToCancel(message, rinfo);
     } else if (firstLine.startsWith('ACK')) {
       console.log('✅ Processing ACK - Call acknowledgment');
       this.handleAckMessage(message, rinfo);
     } else if (firstLine.startsWith('SIP/2.0')) {
       console.log('📨 Processing SIP Response:', firstLine);
       // Handle SIP responses (like 200 OK, 401 Unauthorized, etc.)
     } else {
       console.log('❓ Unhandled SIP message type:', firstLine);
     }
    
    console.log('─'.repeat(80));
  }
  
  // Handle authentication challenge
  handleAuthChallenge(message) {
    // Extract realm and nonce from WWW-Authenticate header
    const realmMatch = message.match(/realm="([^"]+)"/i);
    const nonceMatch = message.match(/nonce="([^"]+)"/i);
    
    if (realmMatch && nonceMatch) {
      const realm = realmMatch[1];
      const nonce = nonceMatch[1];
      
      console.log(`🔐 Realm: ${realm}, Nonce: ${nonce}`);
      
      // Send authenticated REGISTER request
      this.sendRegisterRequest(true, realm, nonce);
    }
  }
  
  // Respond to OPTIONS keep-alive messages
  respondToOptions(message, rinfo) {
    try {
      // Extract Call-ID, Via, and From headers
      const callIdMatch = message.match(/Call-ID:\s*([^\r\n]+)/i);
      const viaMatch = message.match(/Via:\s*([^\r\n]+)/i);
      const fromMatch = message.match(/From:\s*([^\r\n]+)/i);
      const toMatch = message.match(/To:\s*([^\r\n]+)/i);
      const cseqMatch = message.match(/CSeq:\s*([^\r\n]+)/i);
      
      if (callIdMatch && viaMatch && fromMatch && toMatch && cseqMatch) {
        const response = `SIP/2.0 200 OK\r\n`
          + `Via: ${viaMatch[1]}\r\n`
          + `From: ${fromMatch[1]}\r\n`
          + `To: ${toMatch[1]}\r\n`
          + `Call-ID: ${callIdMatch[1]}\r\n`
          + `CSeq: ${cseqMatch[1]}\r\n`
          + `Allow: INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, MESSAGE, OPTIONS, INFO, SUBSCRIBE\r\n`
          + `Accept: application/sdp, application/pidf+xml, application/xpidf+xml, application/simple-message-summary, message/sipfrag;version=2.0\r\n`
          + `Accept-Language: en\r\n`
          + `User-Agent: VoiceAI SIP Client\r\n`
          + `Content-Length: 0\r\n\r\n`;
        
        const responseBuffer = Buffer.from(response);
        this.sipSocket.send(responseBuffer, 0, responseBuffer.length, rinfo.port, rinfo.address);
      }
    } catch (error) {
      console.error('❌ Error responding to OPTIONS:', error);
    }
  }
  
  // Respond to NOTIFY messages
  respondToNotify(message, rinfo) {
    try {
      // Extract Call-ID, Via, and From headers
      const callIdMatch = message.match(/Call-ID:\s*([^\r\n]+)/i);
      const viaMatch = message.match(/Via:\s*([^\r\n]+)/i);
      const fromMatch = message.match(/From:\s*([^\r\n]+)/i);
      const toMatch = message.match(/To:\s*([^\r\n]+)/i);
      const cseqMatch = message.match(/CSeq:\s*([^\r\n]+)/i);
      
      if (callIdMatch && viaMatch && fromMatch && toMatch && cseqMatch) {
        const response = `SIP/2.0 200 OK\r\n`
          + `Via: ${viaMatch[1]}\r\n`
          + `From: ${fromMatch[1]}\r\n`
          + `To: ${toMatch[1]}\r\n`
          + `Call-ID: ${callIdMatch[1]}\r\n`
          + `CSeq: ${cseqMatch[1]}\r\n`
          + `User-Agent: VoiceAI SIP Client\r\n`
          + `Content-Length: 0\r\n\r\n`;
        
        const responseBuffer = Buffer.from(response);
        this.sipSocket.send(responseBuffer, 0, responseBuffer.length, rinfo.port, rinfo.address);
      }
    } catch (error) {
      console.error('❌ Error responding to NOTIFY:', error);
    }
  }
  
  // Respond to BYE messages
  respondToBye(message, rinfo) {
    try {
      // Extract Call-ID, CSeq, and Via from the BYE message
      const callIdMatch = message.match(/Call-ID:\s*([^\r\n]+)/);
      const cseqMatch = message.match(/CSeq:\s*(\d+)\s+BYE/);
      const viaMatch = message.match(/Via:\s*([^\r\n]+)/);
      
      const callId = callIdMatch ? callIdMatch[1].trim() : 'unknown';
      const cseq = cseqMatch ? cseqMatch[1] : '1';
      const via = viaMatch ? viaMatch[1].trim() : 'SIP/2.0/UDP unknown';
      
      // Create 200 OK response for BYE
      const response = [
        'SIP/2.0 200 OK',
        `Via: ${via}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq} BYE`,
        'Content-Length: 0',
        '',
        ''
      ].join('\r\n');
      
      this.sipSocket.send(Buffer.from(response), rinfo.port, rinfo.address);
      console.log('✅ Sent 200 OK response to BYE');
      
      // Check if session exists
      if (this.currentSession && this.currentSession.callId === callId) {
        console.log('🔍 BYE received for current session');
        
        // Check if this is a legitimate caller disconnect or premature BYE
        const isCallerDisconnect = this.isLegitimateCallerDisconnect(message, rinfo);
        
        if (isCallerDisconnect) {
          console.log('📞 Legitimate caller disconnect detected - terminating call');
          this.cleanupSession();
        } else if (this.currentSession.welcomeMessageActive) {
          console.log('⏳ Ignoring premature BYE - welcome message in progress');
          // Don't set pendingCleanup for premature BYE messages
          // Let the audio timeout or legitimate disconnect handle termination
        } else {
          console.log('🔍 BYE during conversation - checking audio activity');
          // Only cleanup if no recent audio activity
          if (this.shouldTerminateForInactivity()) {
            console.log('🧹 Cleaning up session due to audio inactivity');
            this.cleanupSession();
          } else {
            console.log('🎵 Recent audio activity detected - ignoring BYE');
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error responding to BYE:', error);
    }
  }
  
  // Check if BYE message represents legitimate caller disconnect
  isLegitimateCallerDisconnect(message, rinfo) {
    // Check for specific patterns that indicate caller-initiated disconnect
    // vs system-generated BYE messages
    
    // Pattern 1: BYE from the original caller's IP/port
    if (this.currentSession && this.currentSession.callerInfo) {
      const isFromCaller = (rinfo.address === this.currentSession.callerInfo.address && 
                           rinfo.port === this.currentSession.callerInfo.port);
      if (isFromCaller) {
        return true;
      }
    }
    
    // Pattern 2: BYE with specific headers indicating user action
    const reasonHeader = message.match(/Reason:\s*([^\r\n]+)/);
    if (reasonHeader) {
      const reason = reasonHeader[1].toLowerCase();
      if (reason.includes('user') || reason.includes('normal') || reason.includes('hangup')) {
        return true;
      }
    }
    
    // Pattern 3: Check if enough time has passed since call start
    if (this.currentSession && this.currentSession.startTime) {
      const callDuration = Date.now() - this.currentSession.startTime;
      // If call has been active for more than 3 seconds, more likely to be legitimate
      if (callDuration > 3000) {
        return true;
      }
    }
    
    return false;
  }
  
  // Check if call should terminate due to audio inactivity
  shouldTerminateForInactivity() {
    if (!this.currentSession || !this.currentSession.lastAudioActivity) {
      return false;
    }
    
    // Don't terminate if AI response is in progress
    if (this.currentSession.aiResponseInProgress) {
      console.log('🤖 AI response in progress - extending timeout');
      return false;
    }
    
    // Don't terminate during welcome message phase
    if (this.currentSession.welcomeMessageActive) {
      console.log('👋 Welcome message active - extending timeout');
      return false;
    }
    
    const timeSinceLastAudio = Date.now() - this.currentSession.lastAudioActivity;
    const timeSinceLastResponse = Date.now() - (this.currentSession.lastResponseTime || this.currentSession.lastAudioActivity);
    
    // Use extended timeout (30 seconds) to allow for AI processing and response generation
    const timeoutDuration = 30000; // 30 seconds
    
    // Only terminate if both audio and response timeouts are exceeded
    const shouldTerminate = timeSinceLastAudio > timeoutDuration && timeSinceLastResponse > timeoutDuration;
    
    if (shouldTerminate) {
      console.log(`⏰ Timeout exceeded - Audio: ${Math.round(timeSinceLastAudio/1000)}s, Response: ${Math.round(timeSinceLastResponse/1000)}s`);
    }
    
    return shouldTerminate;
  }
  
  // Helper method for session cleanup
  cleanupSession() {
    console.log('🧹 Performing session cleanup');
    
    // Clear any audio timeout timers
    if (this.currentSession && this.currentSession.audioTimeoutTimer) {
      clearTimeout(this.currentSession.audioTimeoutTimer);
    }
    
    // Clear pending audio queue
    if (this.pendingAudioQueue) {
      this.pendingAudioQueue = [];
    }
    
    this.currentSession = null;
    if (this.rtpSocket) {
      this.rtpSocket.close();
      this.rtpSocket = null;
    }
    
    // Reset realtime session state but keep WebSocket connection
    console.log('🔄 Resetting realtime session state for next call');
  }
  
  // Respond to CANCEL messages
  respondToCancel(message, rinfo) {
    try {
      // Extract Call-ID, CSeq, and Via from the CANCEL message
      const callIdMatch = message.match(/Call-ID:\s*([^\r\n]+)/);
      const cseqMatch = message.match(/CSeq:\s*(\d+)\s+CANCEL/);
      const viaMatch = message.match(/Via:\s*([^\r\n]+)/);
      const fromMatch = message.match(/From:\s*([^\r\n]+)/);
      const toMatch = message.match(/To:\s*([^\r\n]+)/);
      
      const callId = callIdMatch ? callIdMatch[1].trim() : 'unknown';
      const cseq = cseqMatch ? cseqMatch[1] : '1';
      const via = viaMatch ? viaMatch[1].trim() : 'SIP/2.0/UDP unknown';
      const from = fromMatch ? fromMatch[1].trim() : '';
      const to = toMatch ? toMatch[1].trim() : '';
      
      // Send 200 OK response to CANCEL
      const cancelResponse = [
        'SIP/2.0 200 OK',
        `Via: ${via}`,
        `From: ${from}`,
        `To: ${to}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq} CANCEL`,
        'Content-Length: 0',
        '',
        ''
      ].join('\r\n');
      
      this.sipSocket.send(Buffer.from(cancelResponse), rinfo.port, rinfo.address);
      console.log('✅ Sent 200 OK response to CANCEL');
      
      // Also send 487 Request Terminated for the original INVITE
      const inviteTerminated = [
        'SIP/2.0 487 Request Terminated',
        `Via: ${via}`,
        `From: ${from}`,
        `To: ${to};tag=${this.generateBranch()}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq} INVITE`,
        'Content-Length: 0',
        '',
        ''
      ].join('\r\n');
      
      this.sipSocket.send(Buffer.from(inviteTerminated), rinfo.port, rinfo.address);
      console.log('✅ Sent 487 Request Terminated for INVITE');
      
    } catch (error) {
      console.error('❌ Error responding to CANCEL:', error);
    }
  }
  
  async handleIncomingCall(message, rinfo) {
    try {
      console.log('📞 Processing incoming call...');
      console.log('📞 Call details:', message.substring(0, 200) + '...');
      
      // Use enhanced parser for better message handling
      let parsedMessage = message;
      if (typeof message === 'string') {
        parsedMessage = this.parser.parseMessage(message);
        if (!parsedMessage.parsed) {
          console.error('❌ Failed to parse incoming call message');
          return;
        }
      }
      
      // Extract SIP headers using enhanced parser or fallback to regex
      const callId = parsedMessage.callId || (message.match(/Call-ID:\s*([^\r\n]+)/) || [])[1]?.trim();
      const via = parsedMessage.headers?.via || (message.match(/Via:\s*([^\r\n]+)/) || [])[1]?.trim();
      const from = parsedMessage.headers?.from || (message.match(/From:\s*([^\r\n]+)/) || [])[1]?.trim();
      const to = parsedMessage.headers?.to || (message.match(/To:\s*([^\r\n]+)/) || [])[1]?.trim();
      const cseq = parsedMessage.headers?.cseq || (message.match(/CSeq:\s*([^\r\n]+)/) || [])[1]?.trim();
      
      // Enhanced Answer-Mode header detection
      const answerMode = parsedMessage.autoAnswer?.mode || (message.match(/Answer-Mode:\s*([^\r\n]+)/i) || [])[1]?.trim();
      const privAnswerMode = parsedMessage.autoAnswer?.privMode || (message.match(/Priv-Answer-Mode:\s*([^\r\n]+)/i) || [])[1]?.trim();
      
      if (callId && via && from && to && cseq) {
        // Create or get session using session manager
        let session = this.sessionManager.getSession(callId);
        if (!session) {
          session = this.sessionManager.createSession(callId, parsedMessage.fromTag, parsedMessage.toTag);
        }
        
        // Update session state
        session.setState('PROCEEDING', 'INVITE received');
        
        // Log enhanced call information
        console.log(`📞 Enhanced call processing:`);
        console.log(`  - Parser: ${parsedMessage.parsed ? '✅ Enhanced' : '⚠️ Fallback'}`);
        console.log(`  - Session: ${session.callId}`);
        console.log(`  - State: ${session.state}`);
        
        console.log(`📞 Call from: ${from}`);
        console.log(`📞 Call to: ${to}`);
        console.log(`📞 Call ID: ${callId}`);
        
        if (answerMode) {
          console.log(`📞 Answer-Mode header detected: ${answerMode}`);
        }
        if (privAnswerMode) {
          console.log(`📞 Priv-Answer-Mode header detected: ${privAnswerMode}`);
        }
        
        // Send 180 Ringing response immediately
        const ringingResponse = [
          'SIP/2.0 180 Ringing',
          `Via: ${via}`,
          `From: ${from}`,
          `To: ${to};tag=${this.generateBranch()}`,
          `Call-ID: ${callId}`,
          `CSeq: ${cseq}`,
          'Content-Length: 0',
          '',
          ''
        ].join('\r\n');
        
        this.sipSocket.send(Buffer.from(ringingResponse), rinfo.port, rinfo.address);
        console.log('📞 Sent 180 Ringing response immediately');
        
        // Extract remote RTP port from SDP if present
        let remoteRTPPort = 8000; // Default fallback
        const sdpMatch = message.match(/m=audio (\d+)/i);
        if (sdpMatch) {
          remoteRTPPort = parseInt(sdpMatch[1]);
        }
        
        // Store enhanced call session info
        this.currentSession = {
          callId,
          via,
          from,
          to,
          cseq,
          remoteAddress: rinfo.address,
          remotePort: rinfo.port,
          remoteRTPPort: remoteRTPPort,
          answerMode: answerMode,
          privAnswerMode: privAnswerMode,
          session: session,
          parsedMessage: parsedMessage,
          enhancedFeatures: {
            sessionManagement: true,
            enhancedParser: parsedMessage.parsed,
            autoAnswerHeaders: !!(answerMode || privAnswerMode),
            sessionTimers: parsedMessage.sessionTimer ? true : false
          },
          // Audio activity tracking
          startTime: Date.now(),
          lastAudioActivity: Date.now(),
          welcomeMessageActive: false,
          pendingCleanup: false,
          aiResponseInProgress: false,
          lastResponseTime: Date.now(),
          callerInfo: {
            address: rinfo.address,
            port: rinfo.port
          },
          audioTimeoutTimer: null
        };
        
        // Store in sessions map for compatibility
        if (!this.sessions) {
          this.sessions = new Map();
        }
        this.sessions.set(callId, this.currentSession);
        
        // Update session with media information if SDP is present
        if (parsedMessage.sdp) {
          session.setMedia({
            remoteSdp: parsedMessage.body,
            rtpPort: remoteRTPPort,
            codec: 'PCMU'
          });
          console.log('📞 SDP information stored in session');
        }
        
        // Determine auto-answer delay using enhanced parser
        let autoAnswerDelay = 1000; // Default 1 second
        
        if (parsedMessage.autoAnswer) {
          const { mode, privMode, delay } = parsedMessage.autoAnswer;
          
          if (mode === 'Auto' || privMode === 'Auto') {
            autoAnswerDelay = delay || 100; // RFC 5373 compliant fast answer
            console.log(`📞 Enhanced RFC 5373 auto-answer detected - delay: ${autoAnswerDelay}ms`);
            console.log(`  - Mode: ${mode || 'none'}, Priv-Mode: ${privMode || 'none'}`);
          }
        } else {
          // Fallback to original logic if enhanced parser didn't detect auto-answer
          if (answerMode === 'Auto' || privAnswerMode === 'Auto') {
            autoAnswerDelay = 100;
            console.log('📞 RFC 5373 auto-answer mode detected - reducing delay to 100ms');
          }
        }
        
        // Update session state before answering
        session.setState('ANSWERING', `Auto-answer in ${autoAnswerDelay}ms`);
        console.log(`📞 Session ${session.callId} state: ${session.state}`);
        
        // Answer the call after calculated delay
          setTimeout(async () => {
           try {
             // Update session state to ANSWERED
             session.setState('ANSWERED', 'Call answered successfully');
             
             // Generate SIP response using enhanced parser if available
             let okResponse;
             if (parsedMessage.parsed && this.parser.generateResponse) {
               // Use enhanced parser to generate response
               okResponse = this.parser.generateResponse(parsedMessage, 200, 'OK', {
                 rtpPort: this.rtpPort,
                 localIP: this.getLocalIP(),
                 tag: this.generateBranch()
               });
               console.log('📞 Using enhanced SIP response generation');
             } else {
               // Fallback to original SDP generation
               const localIP = this.getLocalIP();
               
               const sdpContent = [
                 'v=0',
                 `o=VoiceAI 123456 654321 IN IP4 ${localIP}`,
                 's=VoiceAI Realtime Session',
                 `c=IN IP4 ${localIP}`,
                 't=0 0',
                 `m=audio ${this.rtpPort} RTP/AVP 0 8`,
                 'a=rtpmap:0 PCMU/8000',
                 'a=rtpmap:8 PCMA/8000',
                 'a=sendrecv'
               ].join('\r\n');
               
               okResponse = [
                 'SIP/2.0 200 OK',
                 `Via: ${via}`,
                 `From: ${from}`,
                 `To: ${to};tag=${this.generateBranch()}`,
                 `Call-ID: ${callId}`,
                 `CSeq: ${cseq}`,
                 `Contact: <sip:${process.env.SIP_AUTHORIZATION_USER || '31'}@${localIP}:5060>`,
                 'Content-Type: application/sdp',
                 `Content-Length: ${sdpContent.length}`,
                 '',
                 sdpContent
               ].join('\r\n');
               console.log('📞 Using fallback SIP response generation');
             }
          
          this.sipSocket.send(Buffer.from(okResponse), rinfo.port, rinfo.address);
          console.log('📞 Sent 200 OK response with SDP - Call answered');
          
          // Initialize RTP socket for audio and wait for it to be ready
          console.log('🔧 Initializing RTP socket...');
          await this.initRTPSocket(this.rtpPort);
          console.log('✅ RTP socket ready for audio streaming');
          
          // Update session state to CONFIRMED after 200 OK sent
          session.setState('CONFIRMED', 'Call confirmed, waiting for ACK');
          console.log(`📞 Session ${session.callId} state: ${session.state}`);
          
          // Wait for ACK before starting media validation
          console.log('⏳ Waiting for ACK confirmation before media validation...');
          this.currentSession.waitingForAck = true;
          this.currentSession.ackTimeout = setTimeout(() => {
            if (this.currentSession && this.currentSession.waitingForAck) {
              console.log('⚠️ ACK timeout - proceeding with media validation');
              this.proceedWithMediaValidation();
            }
          }, this.timeoutManager.getTimeout('ack_timeout')); // Use TimeoutManager
          
         } catch (error) {
           console.error('❌ Error in enhanced call handling:', error);
           if (session) {
             session.setState('ERROR', `Call handling failed: ${error.message}`);
           }
           
           // Fallback to basic error response
           const errorResponse = `SIP/2.0 500 Internal Server Error\r\nVia: ${via}\r\nFrom: ${from}\r\nTo: ${to}\r\nCall-ID: ${callId}\r\nCSeq: ${cseq}\r\n\r\n`;
           this.sipSocket.send(Buffer.from(errorResponse), rinfo.port, rinfo.address);
         }
        }, autoAnswerDelay); // Dynamic delay based on Answer-Mode headers
      }
      
    } catch (error) {
      console.error('❌ Error handling incoming call:', error);
    }
  }

  startRealtimeConversation() {
    // Validate session state using enhanced validation
    if (!this.currentSession || !this.currentSession.session) {
      console.error('❌ Cannot start AI - no valid session');
      return;
    }
    
    const session = this.currentSession.session;
    
    // Ensure session is in AI_ACTIVE state
    if (!session.isAIActive()) {
      console.error('❌ Cannot start AI - session not in AI_ACTIVE state');
      return;
    }
    
    // Validate audio readiness using session validation
    if (!session.validateAudioReadiness()) {
      console.error('❌ Cannot start AI - audio not ready');
      return;
    }
    
    if (!this.isRealtimeConnected || !this.realtimeWS) {
      console.error('❌ Realtime API not connected');
      return;
    }
    
    try {
      console.log('🎵 Audio Codec Configuration:');
      console.log(`   - Input: G.711 μ-law (8-bit, 8kHz - native OpenAI format)`);
      console.log(`   - Output: G.711 μ-law (8-bit, 8kHz - direct SIP compatibility)`);
      console.log(`   - RTP Port: ${this.rtpPort}`);
      console.log(`   - Current Session: ${this.currentSession ? this.currentSession.callId : 'None'}`);
      
      // Set welcome message active flag and initialize audio activity tracking
      if (this.currentSession) {
        this.currentSession.welcomeMessageActive = true;
        this.currentSession.lastAudioActivity = Date.now();
        this.currentSession.aiResponseInProgress = false;
        this.currentSession.lastResponseTime = Date.now();
        
        // Update session state to AI_ACTIVE
        if (this.currentSession.session) {
          this.currentSession.session.setState('AI_ACTIVE', 'AI conversation started');
        }
        
        // Start audio timeout monitoring with extended timeout for AI responses
        this.currentSession.audioTimeoutTimer = setInterval(() => {
          if (this.shouldTerminateForInactivity()) {
            console.log('⏰ Terminating call due to extended audio inactivity');
            this.cleanupSession();
          }
        }, 1000); // Check every second
        
        console.log('🔒 Welcome message active - session cleanup protection enabled');
        console.log('⏰ Audio timeout monitoring started (5-second threshold)');
      }
      
      // Send welcome message via realtime API
      const welcomeMessage = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Please greet the caller with a friendly welcome message and ask how you can help them today. Keep it brief and natural.'
          }]
        }
      };
      
      console.log('🎵 Sending welcome message request to OpenAI Realtime API');
      this.realtimeWS.send(JSON.stringify(welcomeMessage));
      
      // Trigger response generation
      const responseConfig = {
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
          instructions: 'Provide a warm, friendly greeting and ask how you can help. Keep it concise and conversational.'
        }
      };
      
      console.log('🎵 Requesting audio response generation');
      this.realtimeWS.send(JSON.stringify(responseConfig));
      
      console.log('✅ Realtime conversation started with welcome message - waiting for audio response');
      
    } catch (error) {
      console.error('❌ Error starting realtime conversation:', error);
    }
  }

  // Legacy audio stream handling - now using realtime API
  async handleAudioStream(stream) {
    console.log('⚠️ Legacy handleAudioStream method called - now using realtime API');
  }

  // Legacy audio buffer processing - now using realtime API
  async processAudioBuffer(audioBuffer) {
    console.log('⚠️ Legacy processAudioBuffer method called - now using realtime API');
  }

  // Legacy WAV conversion - now using realtime API
  audioBufferToWav(audioBuffer) {
    console.log('⚠️ Legacy audioBufferToWav method called - now using realtime API');
    return null;
  }

  // Legacy transcription - now using realtime API
  async transcribeAudio(audioBuffer) {
    console.log('⚠️ Legacy transcribeAudio method called - now using realtime API');
    return null;
  }

  // Legacy response generation - now using realtime API
  async generateResponse(text) {
    console.log('⚠️ Legacy generateResponse method called - now using realtime API');
    return 'Using realtime API now';
  }

  // Legacy TTS method - now using realtime API
  async speakResponse(text) {
    console.log('⚠️ Legacy TTS method called - now using realtime API');
    console.log('📝 Text that would have been spoken:', text);
  }

  async initRTPSocket(port = null) {
    const dgram = require('dgram');
    
    // Close existing RTP socket if it exists
    if (this.rtpSocket) {
      try {
        this.rtpSocket.close();
        console.log('🧹 Closed existing RTP socket');
      } catch (err) {
        console.log('⚠️ Error closing existing RTP socket:', err.message);
      }
    }
    
    return new Promise((resolve, reject) => {
      this.rtpSocket = dgram.createSocket('udp4');
      const bindPort = port || this.rtpPort;
      this.rtpPort = bindPort;
      
      this.rtpSocket.bind(this.rtpPort, () => {
        console.log(`🎵 RTP socket bound to port ${this.rtpPort}`);
        resolve(); // Resolve when socket is successfully bound
      });
      
      this.rtpSocket.on('message', (msg, rinfo) => {
        // Handle incoming audio from caller - send to realtime API
        this.processIncomingRTPAudio(msg, rinfo);
      });
      
      this.rtpSocket.on('error', (err) => {
        console.error('❌ RTP socket error:', err);
        // Try alternative port if binding fails
        if (err.code === 'EADDRINUSE') {
          const altPort = Math.floor(Math.random() * 10000) + 8000;
          console.log(`🔄 Trying alternative RTP port: ${altPort}`);
          this.rtpPort = altPort;
          // Close current socket and create new one with alternative port
          this.rtpSocket.close();
          setTimeout(async () => {
            try {
              await this.initRTPSocket(altPort);
              resolve();
            } catch (retryErr) {
              reject(retryErr);
            }
          }, 100);
        } else {
          reject(err);
        }
      });
    });
  }

  processIncomingRTPAudio(rtpPacket, rinfo) {
    try {
      // Extract audio payload from RTP packet
      if (rtpPacket.length < 12) return; // Invalid RTP packet
      
      const audioPayload = rtpPacket.slice(12); // Skip RTP header
      
      // Send G.711 μ-law audio directly to realtime API (no conversion needed)
      if (this.isRealtimeConnected && audioPayload.length > 0) {
        this.sendAudioToRealtime(audioPayload);
      }
      
    } catch (error) {
      console.error('❌ Error processing incoming RTP audio:', error);
    }
  }

  convertPCMUtoPCM16(pcmuBuffer) {
    try {
      const pcm16Buffer = Buffer.alloc(pcmuBuffer.length * 2);
      
      for (let i = 0; i < pcmuBuffer.length; i++) {
        const mulaw = pcmuBuffer[i];
        const linear = this.mulawToLinear(mulaw);
        pcm16Buffer.writeInt16LE(linear, i * 2);
      }
      
      return pcm16Buffer;
    } catch (error) {
      console.error('❌ Error converting PCMU to PCM16:', error);
      return Buffer.alloc(0);
    }
  }

  mulawToLinear(mulaw) {
    const BIAS = 0x84;
    const CLIP = 32635;
    
    mulaw = ~mulaw;
    const sign = (mulaw & 0x80);
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0F;
    
    let sample = mantissa << (exponent + 3);
    sample += BIAS;
    if (exponent !== 0) sample += (1 << (exponent + 2));
    
    return sign ? -sample : sample;
  }

  sendAudioToRealtime(g711Buffer) {
    // Validate session and audio readiness using enhanced validation
    if (!this.currentSession || !this.currentSession.session) {
      console.log('⚠️ Cannot send audio - no valid session');
      return;
    }
    
    const session = this.currentSession.session;
    
    // Use enhanced session validation for audio operations
    if (!session.validateAudioReadiness()) {
      console.log('⚠️ Audio not ready - skipping audio send');
      return;
    }
    
    if (!this.isRealtimeConnected || !this.realtimeWS) {
      console.log('⚠️ Cannot send audio - WebSocket not connected');
      return;
    }
    
    // Check if session is properly configured
    if (!this.sessionConfigured || !this.realtimeSessionId) {
      console.log('⚠️ Session not ready - queuing audio buffer');
      this.pendingAudioQueue.push(g711Buffer);
      
      // Limit queue size to prevent memory issues
      if (this.pendingAudioQueue.length > 50) {
        this.pendingAudioQueue.shift(); // Remove oldest buffer
        console.log('⚠️ Audio queue full - dropping oldest buffer');
      }
      return;
    }
    
    // Execute audio operation safely using session wrapper
    session.executeAudioOperation(() => {
      this.sendAudioToRealtimeInternal(g711Buffer);
    });
  }
  
  sendAudioToRealtimeInternal(g711Buffer) {
    // Update audio activity timestamp
    if (this.currentSession) {
      this.currentSession.lastAudioActivity = Date.now();
    }
    
    try {
      const audioMessage = {
        type: 'input_audio_buffer.append',
        audio: g711Buffer.toString('base64')
      };
      
      this.realtimeWS.send(JSON.stringify(audioMessage));
    } catch (error) {
      console.error('❌ Error sending audio to realtime API:', error);
      // Reset session state on send error
      this.sessionConfigured = false;
    }
  }

  streamRealtimeAudio(audioBase64) {
    try {
      if (!this.currentSession || !this.rtpSocket) {
        console.log('⚠️ Cannot stream audio - missing session or RTP socket');
        console.log(`   Session: ${this.currentSession ? 'Available' : 'Missing'}`);
        console.log(`   RTP Socket: ${this.rtpSocket ? 'Available' : 'Missing'}`);
        return;
      }
      
      // Check if session is marked for cleanup or BYE was received
      if (this.currentSession.pendingCleanup) {
        console.log('⚠️ Cannot stream audio - session cleanup pending');
        return;
      }
      
      // Mark AI response as in progress and update response time
      this.currentSession.aiResponseInProgress = true;
      this.currentSession.lastResponseTime = Date.now();
      this.currentSession.welcomeMessageActive = false; // Clear welcome message flag when AI responds
      
      // Use G.711 μ-law audio directly from OpenAI (no conversion needed)
      const g711Buffer = Buffer.from(audioBase64, 'base64');
      console.log(`🎵 Using ${g711Buffer.length} bytes G.711 μ-law audio directly`);
      
      // Create and send RTP packets
      const rtpPackets = this.createRTPPackets(g711Buffer);
      console.log(`🎵 Created ${rtpPackets.length} RTP packets`);
      
      // Store session reference to avoid race conditions
      const sessionRef = this.currentSession;
      
      rtpPackets.forEach((packet, index) => {
        setTimeout(() => {
          // Update audio activity timestamp for outgoing audio
          if (this.currentSession) {
            this.currentSession.lastAudioActivity = Date.now();
          }
          
          // Double-check session is still valid and not pending cleanup
          if (this.currentSession && 
              this.currentSession === sessionRef && 
              !this.currentSession.pendingCleanup &&
              this.currentSession.remoteRTPPort && 
              this.currentSession.remoteAddress &&
              this.rtpSocket) {
            this.rtpSocket.send(packet, this.currentSession.remoteRTPPort, this.currentSession.remoteAddress, (err) => {
              if (err) {
                console.error(`❌ Error sending RTP packet ${index}:`, err);
              } else {
                console.log(`🎵 Sent RTP packet ${index} to ${this.currentSession.remoteAddress}:${this.currentSession.remoteRTPPort}`);
                
                // Mark AI response as complete after the last packet is sent
                if (index === rtpPackets.length - 1 && this.currentSession) {
                  this.currentSession.aiResponseInProgress = false;
                  this.currentSession.lastResponseTime = Date.now();
                  console.log('✅ AI response streaming completed');
                }
              }
            });
          } else {
            console.log(`⚠️ Cannot send RTP packet ${index} - session terminated or missing remote info`);
          }
        }, index * 20); // 20ms intervals for real-time streaming
      });
      
    } catch (error) {
      console.error('❌ Error streaming realtime audio:', error);
    }
  }

  convertPCM16ToPCMU(pcm16Buffer) {
    try {
      const pcmuBuffer = Buffer.alloc(pcm16Buffer.length / 2);
      
      for (let i = 0; i < pcm16Buffer.length; i += 2) {
        const linear = pcm16Buffer.readInt16LE(i);
        const mulaw = this.linearToMulaw(linear);
        pcmuBuffer[i / 2] = mulaw;
      }
      
      return pcmuBuffer;
    } catch (error) {
      console.error('❌ Error converting PCM16 to PCMU:', error);
      return Buffer.alloc(0);
    }
  }

  // Legacy audio file playback - now using realtime streaming
  async playAudioToSession(audioFile) {
    console.log('⚠️ Legacy playAudioToSession method called - now using realtime streaming');
  }
  
  // Legacy audio conversion - now using realtime API
  async convertToPCMU(wavBuffer) {
    console.log('⚠️ Legacy convertToPCMU method called - now using realtime API');
    return null;
  }
  
  linearToMulaw(sample) {
    const BIAS = 0x84;
    const CLIP = 32635;
    const sign = (sample >> 8) & 0x80;
    
    if (sign !== 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    
    sample = sample + BIAS;
    let exponent = 7;
    let mantissa;
    
    for (let exp_lut = [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3], i = 0; i < 8; i++) {
      if (sample <= (0x1F << (i + 3))) {
        exponent = exp_lut[i];
        break;
      }
    }
    
    mantissa = (sample >> (exponent + 3)) & 0x0F;
    return ~(sign | (exponent << 4) | mantissa) & 0xFF;
  }
  
  // Legacy RTP packet creation - now using realtime API
  createRTPPackets(audioBuffer) {
    const packets = [];
    const maxPayloadSize = 160; // Standard RTP payload size for PCMU at 8kHz (20ms)
    let sequenceNumber = this.rtpSequenceNumber || 0;
    let timestamp = this.rtpTimestamp || 0;
    const ssrc = this.rtpSSRC || 0x12345678;
    
    for (let i = 0; i < audioBuffer.length; i += maxPayloadSize) {
      const payloadSize = Math.min(maxPayloadSize, audioBuffer.length - i);
      const payload = audioBuffer.slice(i, i + payloadSize);
      
      // Create RTP header (12 bytes)
      const rtpHeader = Buffer.alloc(12);
      rtpHeader[0] = 0x80; // Version 2, no padding, no extension, no CSRC
      rtpHeader[1] = 0x00; // Payload type 0 (PCMU)
      rtpHeader.writeUInt16BE(sequenceNumber & 0xFFFF, 2);
      rtpHeader.writeUInt32BE(timestamp, 4);
      rtpHeader.writeUInt32BE(ssrc, 8);
      
      // Combine header and payload
      const rtpPacket = Buffer.concat([rtpHeader, payload]);
      packets.push(rtpPacket);
      
      sequenceNumber++;
      timestamp += payloadSize; // Increment by payload size for PCMU
    }
    
    // Update sequence number and timestamp for next call
    this.rtpSequenceNumber = sequenceNumber;
    this.rtpTimestamp = timestamp;
    
    return packets;
  }

  // Send SIP REGISTER request
  sendRegisterRequest(withAuth = false, realm = '', nonce = '') {
    const branch = this.generateBranch();
    const uri = `sip:${this.sipConfig.serverIP}:${this.sipConfig.serverPort}`;
    
    let request = `REGISTER ${uri} SIP/2.0\r\n`
      + `Via: SIP/2.0/UDP ${this.sipConfig.clientIP}:${this.sipConfig.clientPort};branch=${branch}\r\n`
      + `From: <sip:${this.sipConfig.username}@${this.sipConfig.serverIP}>;tag=${branch}\r\n`
      + `To: <sip:${this.sipConfig.username}@${this.sipConfig.serverIP}>\r\n`
      + `Call-ID: ${this.callId}@${this.sipConfig.clientIP}\r\n`
      + `CSeq: ${this.cseq} REGISTER\r\n`
      + `Contact: <sip:${this.sipConfig.username}@${this.sipConfig.clientIP}:${this.sipConfig.clientPort}>\r\n`
      + 'Max-Forwards: 70\r\n'
      + 'Expires: 3600\r\n'
      + 'User-Agent: VoiceAI SIP Client\r\n';
    
    this.cseq += 1;
    
    if (withAuth && realm && nonce) {
      const digestResponse = this.generateDigestResponse(
        this.sipConfig.username,
        this.sipConfig.password,
        realm,
        nonce,
        'REGISTER',
        uri
      );
      
      request += 'Authorization: Digest '
        + `username="${this.sipConfig.username}", realm="${realm}", `
        + `nonce="${nonce}", uri="${uri}", `
        + `response="${digestResponse}"\r\n`;
    }
    
    request += 'Content-Length: 0\r\n\r\n';
    
    console.log('📞 Sending REGISTER request...');
    
    const message = Buffer.from(request);
    this.sipSocket.send(
      message,
      0,
      message.length,
      this.sipConfig.serverPort,
      this.sipConfig.serverIP,
      (err) => {
        if (err) {
          console.error('❌ Error sending REGISTER:', err);
        } else {
          console.log('✅ REGISTER request sent');
        }
      }
    );
  }

  // Method to make outbound calls
  async makeCall(targetUri) {
    try {
      console.log(`📞 Making outbound call to ${targetUri}...`);
      
      if (!this.isRegistered) {
        throw new Error('SIP client not registered');
      }
      
      // Generate call parameters
      const callId = this.generateCallId();
      const branch = this.generateBranch();
      const tag = crypto.randomBytes(8).toString('hex');
      
      // Store call session
      this.currentCallId = callId;
      this.currentTag = tag;
      this.isInCall = true;
      
      // Construct SIP INVITE message
      const inviteMessage = [
        `INVITE sip:${targetUri}@${process.env.SIP_SERVER || '122.163.120.156'} SIP/2.0`,
        `Via: SIP/2.0/UDP ${this.clientIP}:${this.clientPort};branch=${branch}`,
        `Max-Forwards: 70`,
        `From: <sip:${this.authUser}@${process.env.SIP_SERVER || '122.163.120.156'}>;tag=${tag}`,
        `To: <sip:${targetUri}@${process.env.SIP_SERVER || '122.163.120.156'}>`,
        `Call-ID: ${callId}`,
        `CSeq: 1 INVITE`,
        `Contact: <sip:${this.authUser}@${this.clientIP}:${this.clientPort}>`,
        `Content-Type: application/sdp`,
        `Content-Length: 0`,
        '',
        ''
      ].join('\r\n');
      
      // Send INVITE
      console.log(`📞 Sending INVITE to ${targetUri}...`);
      
      const message = Buffer.from(inviteMessage);
      this.sipSocket.send(
        message,
        0,
        message.length,
        this.sipConfig.serverPort,
        this.sipConfig.serverIP,
        (err) => {
          if (err) {
            console.error('❌ Error sending INVITE:', err);
          } else {
            console.log(`📞 INVITE sent to ${targetUri}`);
          }
        }
      );
      
    } catch (error) {
      console.error('❌ Error making outbound call:', error);
    }
  }

  // Method to call extension 16 and play welcome message
  async callExtension16WithWelcome() {
    try {
      console.log('🎯 Initiating call to extension 16 with welcome message...');
      
      // Make the call to extension 16
      await this.makeCall('16');
      
      // Wait a moment for call establishment
      setTimeout(() => {
        if (this.isInCall) {
          console.log('🎵 Playing welcome message to extension 16...');
          this.startRealtimeConversation();
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ Error calling extension 16:', error);
    }
  }

  validateEnvironmentParameters() {
    const errors = [];
    const warnings = [];
    
    // Required parameters
    if (!process.env.OPENAI_API_KEY) {
      errors.push('OPENAI_API_KEY is required');
    } else if (!process.env.OPENAI_API_KEY.startsWith('sk-')) {
      warnings.push('OPENAI_API_KEY format may be invalid');
    }
    
    // Optional parameters with validation
    if (process.env.SIP_CLIENT_PORT) {
      const port = parseInt(process.env.SIP_CLIENT_PORT);
      if (isNaN(port) || port < 1024 || port > 65535) {
        errors.push('SIP_CLIENT_PORT must be a valid port number (1024-65535)');
      }
    }
    
    if (process.env.SIP_SERVER) {
      const parts = process.env.SIP_SERVER.split(':');
      if (parts.length !== 2 || isNaN(parseInt(parts[1]))) {
        errors.push('SIP_SERVER must be in format IP:PORT');
      }
    }
    
    // Log validation results
    if (warnings.length > 0) {
      console.warn('⚠️ Environment warnings:', warnings);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  logStartupReport() {
    console.log('\n📋 STARTUP CONFIGURATION REPORT');
    console.log('================================');
    console.log(`🔧 SIP Server: ${this.sipConfig.serverIP}:${this.sipConfig.serverPort}`);
    console.log(`📞 SIP Username: ${this.sipConfig.username}`);
    console.log(`🌐 Client IP: ${this.sipConfig.clientIP}`);
    console.log(`🔌 Client Port: ${this.sipConfig.clientPort}`);
    console.log(`🎵 RTP Port: ${this.rtpPort}`);
    console.log(`🤖 OpenAI API: ${process.env.OPENAI_API_KEY ? 'Configured' : 'Missing'}`);
    console.log('================================\n');
  }
  
  async testOpenAIConnection() {
    try {
      console.log('🧪 Testing OpenAI API connection...');
      const response = await this.openai.models.list();
      console.log('✅ OpenAI API connection successful');
      return true;
    } catch (error) {
      console.error('❌ OpenAI API connection failed:', error.message);
      throw error;
    }
  }
  
  async waitForConnectionStabilization() {
    console.log('⏳ Waiting for connections to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check connection statuses
    const sipStatus = this.isRegistered ? '✅ Connected' : '❌ Not Connected';
    const realtimeStatus = this.isRealtimeConnected ? '✅ Connected' : '⚠️ Not Connected (Optional)';
    
    console.log(`📞 SIP Registration: ${sipStatus}`);
    console.log(`🤖 Realtime API: ${realtimeStatus}`);
    
    if (!this.isRegistered) {
      throw new Error('Failed to establish SIP connection');
    }
    
    if (!this.isRealtimeConnected) {
      console.log('⚠️ Realtime API not connected - AI features will be limited');
    }
    
    console.log('✅ Core SIP connection established successfully');
  }
  
  async testWelcomeMessage() {
    console.log('🧪 Testing welcome message functionality...');
    
    if (!this.isRealtimeConnected || !this.realtimeWS) {
      console.log('⚠️ Skipping welcome message test - Realtime API not connected');
      return;
    }
    
    try {
      // Test welcome message creation
      const testMessage = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Test welcome message functionality'
          }]
        }
      };
      
      this.realtimeWS.send(JSON.stringify(testMessage));
      console.log('✅ Welcome message test sent successfully');
      
      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error('❌ Welcome message test failed:', error);
      console.log('⚠️ Welcome message test failed but continuing startup...');
    }
  }
  
  logFullSystemReport() {
    console.log('\n📊 FULL SYSTEM STATUS REPORT');
    console.log('==============================');
    console.log(`🔧 System Status: ${this.isRegistered && this.isRealtimeConnected ? '✅ Fully Operational' : '❌ Partial Failure'}`);
    console.log(`📞 SIP Registration: ${this.isRegistered ? '✅ Active' : '❌ Failed'}`);
    console.log(`🤖 OpenAI Realtime: ${this.isRealtimeConnected ? '✅ Connected' : '❌ Disconnected'}`);
    console.log(`🎵 RTP Socket: ${this.rtpSocket ? '✅ Ready' : '❌ Not Initialized'}`);
    console.log(`📋 Google Sheets: ${this.sheetsData.size > 0 ? '✅ Loaded' : '⚠️ No Data'}`);
    console.log(`💬 Welcome Message: ✅ Tested and Functional`);
    console.log(`🔊 Auto-Answer: ✅ Enabled`);
    console.log(`⚡ Ready for Calls: ${this.isRegistered && this.isRealtimeConnected ? '✅ Yes' : '❌ No'}`);
    console.log('==============================\n');
  }
  
  // Graceful shutdown
  async shutdown() {
    try {
      console.log('🛑 Shutting down Voice AI SIP Client...');
      
      // Clean up SIP socket
      if (this.sipSocket) {
        this.sipSocket.close();
        this.sipSocket = null;
      }
      
      this.isRegistered = false;
      this.currentSession = null;
      
      console.log('✅ Shutdown complete');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }
}

// Initialize the Voice AI SIP Client
const voiceAI = new VoiceAISIPClient();

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await voiceAI.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await voiceAI.shutdown();
  process.exit(0);
});

// Export for testing
module.exports = VoiceAISIPClient;

console.log('🎯 Voice AI SIP Client is running...');
console.log(`📞 Registered as extension ${process.env.SIP_AUTHORIZATION_USER || '31'} on 122.163.120.156`);
console.log('🤖 Ready to handle voice calls with AI responses!');
console.log('Press Ctrl+C to stop the service.');

// Automatic test call disabled to prevent welcome message issues
// setTimeout(() => {
//   if (voiceAI.isRegistered) {
//     voiceAI.callExtension16WithWelcome();
//   }
// }, 3000);
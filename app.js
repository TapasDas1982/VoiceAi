require('dotenv').config();
const VoiceAISIPClient = require('./index');
const VoiceAIDashboard = require('./dashboard');
const VoiceAIUtils = require('./utils');

class VoiceAIApp {
  constructor() {
    this.voiceAI = null;
    this.dashboard = null;
    this.utils = new VoiceAIUtils();
    this.isRunning = false;
  }

  async start() {
    try {
      console.log('🚀 Starting Voice AI SIP Application...');
      console.log('=====================================\n');
      
      // Show configuration
      this.utils.showConfiguration();
      console.log('');
      
      // Run system tests
      console.log('🧪 Running system tests...');
      const testsPass = await this.utils.runSystemTest();
      
      if (!testsPass) {
        console.log('\n❌ Critical system tests failed. Please fix the issues before continuing.');
        console.log('💡 Run "node utils.js test" for detailed diagnostics.');
        process.exit(1);
      }
      
      console.log('\n✅ All tests passed! Starting services...');
      
      // Initialize Voice AI SIP Client
      console.log('\n📞 Initializing SIP Voice AI Client...');
      this.voiceAI = new VoiceAISIPClient();
      
      // Wait a moment for SIP client to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Initialize Dashboard
      console.log('🌐 Starting Web Dashboard...');
      this.dashboard = new VoiceAIDashboard(this.voiceAI);
      this.dashboard.start();
      
      this.isRunning = true;
      
      console.log('\n🎉 Voice AI SIP Application is now running!');
      console.log('============================================');
      console.log(`📞 SIP Extension: ${process.env.SIP_AUTHORIZATION_USER || '31'}`);
      console.log(`🌐 Dashboard: http://localhost:${process.env.PORT || 3000}`);
      console.log('🤖 AI Voice Assistant is ready for calls!');
      console.log('\nPress Ctrl+C to stop the application.\n');
      
      // Log successful startup
      if (this.dashboard) {
        this.dashboard.logCall('system', 'startup', 'completed');
      }
      
    } catch (error) {
      console.error('❌ Failed to start Voice AI Application:', error);
      
      if (this.dashboard) {
        this.dashboard.logError('Application startup failed', error);
      }
      
      process.exit(1);
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    console.log('\n🛑 Shutting down Voice AI Application...');
    
    try {
      // Log shutdown
      if (this.dashboard) {
        this.dashboard.logCall('system', 'shutdown', 'initiated');
      }
      
      // Stop Voice AI SIP Client
      if (this.voiceAI && typeof this.voiceAI.shutdown === 'function') {
        console.log('📞 Stopping SIP client...');
        await this.voiceAI.shutdown();
      }
      
      // Clean up temporary files
      console.log('🧹 Cleaning up...');
      this.utils.cleanup();
      
      this.isRunning = false;
      console.log('✅ Shutdown complete. Goodbye!');
      
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }

  // Handle different types of process termination
  setupGracefulShutdown() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      
      if (this.dashboard) {
        this.dashboard.logError('Uncaught exception', error);
      }
      
      // Try to shutdown gracefully
      this.stop().finally(() => {
        process.exit(1);
      });
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      
      if (this.dashboard) {
        this.dashboard.logError('Unhandled promise rejection', reason);
      }
    });
  }

  // Method to restart the application
  async restart() {
    console.log('🔄 Restarting Voice AI Application...');
    
    await this.stop();
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await this.start();
  }

  // Health check method
  getHealthStatus() {
    return {
      isRunning: this.isRunning,
      hasVoiceAI: !!this.voiceAI,
      hasDashboard: !!this.dashboard,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      timestamp: new Date().toISOString()
    };
  }
}

// Create and start the application
const app = new VoiceAIApp();

// Setup graceful shutdown
app.setupGracefulShutdown();

// Start the application
app.start().catch(error => {
  console.error('💥 Fatal error starting application:', error);
  process.exit(1);
});

// Export for testing
module.exports = VoiceAIApp;
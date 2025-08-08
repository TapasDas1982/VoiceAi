const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class VoiceAIUtils {
  constructor() {
    this.sheetsAuth = null;
  }

  /**
   * Test OpenAI API connectivity and functionality
   */
  async testOpenAI() {
    console.log('🧪 Testing OpenAI API...');
    
    try {
      // Test ChatGPT
      console.log('  📝 Testing ChatGPT...');
      const chatResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Say "OpenAI API test successful"' }],
        max_tokens: 50
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('  ✅ ChatGPT Response:', chatResponse.data.choices[0].message.content);
      
      // Test TTS
      console.log('  🗣️ Testing Text-to-Speech...');
      const ttsResponse = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: 'tts-1',
        input: 'This is a test of the text to speech system.',
        voice: 'alloy',
        response_format: 'wav'
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });
      
      // Save test audio
      const testAudioPath = path.join(__dirname, 'test_tts_output.wav');
      fs.writeFileSync(testAudioPath, ttsResponse.data);
      console.log(`  ✅ TTS test successful! Audio saved to: ${testAudioPath}`);
      
      return true;
      
    } catch (error) {
      console.error('  ❌ OpenAI API test failed:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Test Google Sheets API connectivity
   */
  async testGoogleSheets() {
    console.log('🧪 Testing Google Sheets API...');
    
    try {
      const credentialsPath = path.join(__dirname, 'credentials.json');
      
      if (!fs.existsSync(credentialsPath)) {
        console.log('  ⚠️  credentials.json not found. Google Sheets integration will use sample data.');
        return false;
      }
      
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });
      
      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      
      if (!spreadsheetId || spreadsheetId === 'your_google_sheet_id_here') {
        console.log('  ⚠️  GOOGLE_SHEET_ID not configured. Please update .env file.');
        return false;
      }
      
      console.log('  📊 Testing sheet access...');
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!A:B'
      });
      
      const rows = result.data.values;
      if (rows && rows.length > 0) {
        console.log(`  ✅ Successfully accessed Google Sheet with ${rows.length} rows`);
        console.log('  📋 Sample data:');
        rows.slice(0, 3).forEach(([q, a], index) => {
          console.log(`    ${index + 1}. Q: "${q}" → A: "${a}"`);
        });
        return true;
      } else {
        console.log('  ⚠️  Google Sheet is empty or has no data in columns A and B');
        return false;
      }
      
    } catch (error) {
      console.error('  ❌ Google Sheets test failed:', error.message);
      return false;
    }
  }

  /**
   * Test SIP server connectivity
   */
  async testSIPConnectivity() {
    console.log('🧪 Testing SIP server connectivity...');
    
    try {
      const sipServer = process.env.SIP_SERVER || '122.163.120.156';
      const sipPort = process.env.SIP_PORT || '5060';
      
      console.log(`  📞 Testing connection to ${sipServer}:${sipPort}...`);
      
      // Simple TCP connectivity test
      const net = require('net');
      
      return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 5000;
        
        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
          console.log('  ✅ SIP server is reachable');
          socket.destroy();
          resolve(true);
        });
        
        socket.on('timeout', () => {
          console.log('  ❌ Connection timeout - SIP server may not be accessible');
          socket.destroy();
          resolve(false);
        });
        
        socket.on('error', (error) => {
          console.log(`  ❌ Connection failed: ${error.message}`);
          resolve(false);
        });
        
        socket.connect(parseInt(sipPort), sipServer);
      });
      
    } catch (error) {
      console.error('  ❌ SIP connectivity test failed:', error.message);
      return false;
    }
  }

  /**
   * Create a sample Google Sheet template
   */
  createSampleSheetData() {
    console.log('📝 Sample Google Sheet data format:');
    console.log('\nColumn A (Questions) | Column B (Answers)');
    console.log('---------------------|-------------------');
    
    const sampleData = [
      ['hello', 'Hello! How can I help you today?'],
      ['what is your name', 'I am your AI voice assistant. How may I assist you?'],
      ['how are you', 'I am doing well, thank you for asking! How can I help you?'],
      ['what time is it', 'I can help you with many things, but I cannot tell the current time. Is there anything else I can assist you with?'],
      ['goodbye', 'Goodbye! Have a wonderful day!'],
      ['thank you', 'You are very welcome! Is there anything else I can help you with?'],
      ['what can you do', 'I can answer questions, have conversations, and help with various tasks. What would you like to know?'],
      ['who created you', 'I am an AI assistant created to help with voice interactions and answer questions.'],
      ['help', 'I am here to help! You can ask me questions or have a conversation. What would you like to know?'],
      ['weather', 'I cannot check the current weather, but I can help you with other questions and tasks.']
    ];
    
    sampleData.forEach(([question, answer]) => {
      console.log(`${question.padEnd(20)} | ${answer}`);
    });
    
    console.log('\n💡 Copy this data to your Google Sheet for training the AI assistant.');
  }

  /**
   * Run comprehensive system test
   */
  async runSystemTest() {
    console.log('🚀 Running comprehensive system test...\n');
    
    const results = {
      openai: await this.testOpenAI(),
      googleSheets: await this.testGoogleSheets(),
      sipConnectivity: await this.testSIPConnectivity()
    };
    
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    console.log(`OpenAI API:        ${results.openai ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Google Sheets:     ${results.googleSheets ? '✅ PASS' : '⚠️  OPTIONAL'}`);
    console.log(`SIP Connectivity:  ${results.sipConnectivity ? '✅ PASS' : '❌ FAIL'}`);
    
    const criticalTests = results.openai && results.sipConnectivity;
    
    if (criticalTests) {
      console.log('\n🎉 System is ready for voice AI operations!');
      if (!results.googleSheets) {
        console.log('💡 Consider setting up Google Sheets for custom training data.');
      }
    } else {
      console.log('\n⚠️  System has critical issues that need to be resolved:');
      if (!results.openai) {
        console.log('   - Fix OpenAI API configuration');
      }
      if (!results.sipConnectivity) {
        console.log('   - Check SIP server connectivity');
      }
    }
    
    return criticalTests;
  }

  /**
   * Display system configuration
   */
  showConfiguration() {
    console.log('⚙️  Current System Configuration:');
    console.log('================================');
    console.log(`SIP Server:        ${process.env.SIP_SERVER || '122.163.120.156'}`);
    console.log(`SIP Extension:     ${process.env.SIP_AUTHORIZATION_USER || '31'}`);
    console.log(`SIP Port:          ${process.env.SIP_PORT || '5060'}`);
    console.log(`OpenAI API Key:    ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`Google Sheet ID:   ${process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SHEET_ID !== 'your_google_sheet_id_here' ? '✅ Configured' : '⚠️  Not configured'}`);
    console.log(`ChatGPT Model:     ${process.env.CHATGPT_MODEL || 'gpt-4'}`);
    console.log(`TTS Model:         ${process.env.TTS_MODEL || 'tts-1'}`);
    console.log(`TTS Voice:         ${process.env.TTS_VOICE || 'alloy'}`);
    console.log(`Whisper Model:     ${process.env.WHISPER_MODEL || 'whisper-1'}`);
  }

  /**
   * Clean up temporary files
   */
  cleanup() {
    console.log('🧹 Cleaning up temporary files...');
    
    const tempFiles = [
      'temp_audio.wav',
      'response_audio.wav',
      'test_tts_output.wav'
    ];
    
    let cleaned = 0;
    tempFiles.forEach(file => {
      const filePath = path.join(__dirname, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    });
    
    console.log(`✅ Cleaned up ${cleaned} temporary files`);
  }
}

// CLI interface
if (require.main === module) {
  const utils = new VoiceAIUtils();
  const command = process.argv[2];
  
  switch (command) {
    case 'test':
      utils.runSystemTest();
      break;
    case 'test-openai':
      utils.testOpenAI();
      break;
    case 'test-sheets':
      utils.testGoogleSheets();
      break;
    case 'test-sip':
      utils.testSIPConnectivity();
      break;
    case 'config':
      utils.showConfiguration();
      break;
    case 'sample-data':
      utils.createSampleSheetData();
      break;
    case 'cleanup':
      utils.cleanup();
      break;
    default:
      console.log('🛠️  VoiceAI Utilities');
      console.log('===================');
      console.log('Available commands:');
      console.log('  node utils.js test          - Run comprehensive system test');
      console.log('  node utils.js test-openai   - Test OpenAI API only');
      console.log('  node utils.js test-sheets   - Test Google Sheets API only');
      console.log('  node utils.js test-sip      - Test SIP connectivity only');
      console.log('  node utils.js config        - Show current configuration');
      console.log('  node utils.js sample-data   - Show sample Google Sheets data');
      console.log('  node utils.js cleanup       - Clean up temporary files');
      break;
  }
}

module.exports = VoiceAIUtils;
import dgram from 'dgram';
import crypto from 'crypto';

// Simple SIP registration test for Extension 30
class SimpleSIPTest {
    constructor(config) {
        this.config = config;
        this.socket = dgram.createSocket('udp4');
        this.registrationCSeq = 1;
    }

    md5(str) {
        return crypto.createHash('md5').update(str).digest('hex');
    }

    extractAuthParam(authHeader, param) {
        const quotedRegex = new RegExp(`${param}="([^"]+)"`);
        const quotedMatch = authHeader.match(quotedRegex);
        if (quotedMatch) {
            return quotedMatch[1];
        }
        
        const unquotedRegex = new RegExp(`${param}=([^\\s,]+)`);
        const unquotedMatch = authHeader.match(unquotedRegex);
        if (unquotedMatch) {
            return unquotedMatch[1];
        }
        
        return null;
    }

    generateBranch() {
        return 'z9hG4bK' + Math.random().toString(36).substring(2, 15);
    }

    generateCallId() {
        return Math.random().toString(36).substring(2, 15) + '@' + this.config.sipServer.split(':')[0];
    }

    generateTag() {
        return Math.random().toString(36).substring(2, 15);
    }

    async sendRegister(authHeader = null) {
        const [sipServerHost, sipServerPort] = this.config.sipServer.split(':');
        const callId = this.generateCallId();
        const fromTag = this.generateTag();
        const branch = this.generateBranch();
        
        let registerMessage = `REGISTER sip:${sipServerHost} SIP/2.0\r\n`;
        registerMessage += `Via: SIP/2.0/UDP ${sipServerHost}:${this.config.sipPort};rport;branch=${branch}\r\n`;
        registerMessage += `Max-Forwards: 70\r\n`;
        registerMessage += `From: <sip:${this.config.sipAuthUser}@${sipServerHost}:${sipServerPort}>;tag=${fromTag}\r\n`;
        registerMessage += `To: <sip:${this.config.sipAuthUser}@${sipServerHost}:${sipServerPort}>\r\n`;
        registerMessage += `Call-ID: ${callId}\r\n`;
        registerMessage += `CSeq: ${this.registrationCSeq} REGISTER\r\n`;
        registerMessage += `Contact: <sip:${this.config.sipAuthUser}@${sipServerHost}:${this.config.sipPort}>\r\n`;
        registerMessage += `Expires: 3600\r\n`;
        registerMessage += `User-Agent: VoiceAI-Extension-${this.config.sipAuthUser}\r\n`;
        
        if (authHeader) {
            registerMessage += `Authorization: ${authHeader}\r\n`;
        }
        
        registerMessage += `Content-Length: 0\r\n\r\n`;
        
        console.log(`📤 Sending REGISTER for Extension ${this.config.sipAuthUser}`);
        
        return new Promise((resolve, reject) => {
            this.socket.send(registerMessage, parseInt(sipServerPort), sipServerHost, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async handleAuthChallenge(authHeader) {
        const realm = this.extractAuthParam(authHeader, 'realm');
        const nonce = this.extractAuthParam(authHeader, 'nonce');
        const qop = this.extractAuthParam(authHeader, 'qop');
        const algorithm = this.extractAuthParam(authHeader, 'algorithm') || 'MD5';
        
        console.log(`🔍 Auth Challenge - Realm: ${realm}, QOP: ${qop}`);
        
        const [sipServerHost] = this.config.sipServer.split(':');
        const uri = `sip:${sipServerHost}`;
        const method = 'REGISTER';
        
        const ha1 = this.md5(`${this.config.sipAuthUser}:${realm}:${this.config.sipPassword}`);
        const ha2 = this.md5(`${method}:${uri}`);
        
        let authResponse;
        let authHeaderStr;
        
        if (qop && qop.includes('auth')) {
            const cnonce = Math.random().toString(36).substring(2, 15);
            const nc = '00000001';
            authResponse = this.md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
            authHeaderStr = `Digest username="${this.config.sipAuthUser}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${authResponse}", algorithm=${algorithm}, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
        } else {
            authResponse = this.md5(`${ha1}:${nonce}:${ha2}`);
            authHeaderStr = `Digest username="${this.config.sipAuthUser}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${authResponse}", algorithm=${algorithm}`;
        }
        
        console.log(`🔐 Generated auth response: ${authResponse}`);
        
        this.registrationCSeq++;
        await this.sendRegister(authHeaderStr);
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.socket.on('message', async (msg, rinfo) => {
                const message = msg.toString();
                console.log(`📨 Received: ${message.split('\\r\\n')[0]}`);
                
                if (message.includes('401 Unauthorized')) {
                    const authHeader = message.match(/WWW-Authenticate: (.+)/)?.[1];
                    if (authHeader) {
                        console.log(`🔐 Authentication required`);
                        await this.handleAuthChallenge(authHeader);
                    }
                } else if (message.includes('200 OK')) {
                    console.log(`✅ Registration successful for Extension ${this.config.sipAuthUser}!`);
                    resolve('success');
                } else if (message.includes('403 Forbidden')) {
                    console.log(`❌ Registration forbidden for Extension ${this.config.sipAuthUser}`);
                    resolve('forbidden');
                }
            });
            
            this.socket.on('error', (err) => {
                console.error('Socket error:', err);
                reject(err);
            });
            
            this.socket.bind(this.config.sipPort, () => {
                console.log(`🎧 Listening on port ${this.config.sipPort}`);
                this.sendRegister().catch(reject);
            });
            
            // Timeout after 15 seconds
            setTimeout(() => {
                resolve('timeout');
            }, 15000);
        });
    }

    close() {
        this.socket.close();
    }
}

// Test Extension 30
async function testExtension30() {
    console.log('🧪 Testing SIP registration with Extension 30...');
    
    const config = {
        sipAuthUser: '30',
        sipPassword: 'Twist@2025',
        sipServer: '122.163.120.156:5060',
        sipPort: 5061  // Use different port to avoid conflict
    };
    
    console.log(`📋 Testing Extension ${config.sipAuthUser} with password ${config.sipPassword}`);
    
    const test = new SimpleSIPTest(config);
    
    try {
        const result = await test.start();
        console.log(`📊 Test result: ${result}`);
        test.close();
        
        if (result === 'success') {
            console.log('🎉 Extension 30 registration SUCCESSFUL!');
        } else if (result === 'forbidden') {
            console.log('🚫 Extension 30 registration FORBIDDEN - credentials may be wrong');
        } else {
            console.log('⏰ Test timed out - may still be in auth loop');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        test.close();
    }
}

// Run the test
testExtension30();
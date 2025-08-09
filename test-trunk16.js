import dgram from 'dgram';

// Simple test to call SIP trunk 30
async function testTrunk30() {
    console.log('🧪 Testing SIP trunk 30 call...');
    
    const socket = dgram.createSocket('udp4');
    const sipServer = '122.163.120.156';
    const sipPort = 5060;
    const localPort = 5061; // Use different port to avoid conflict
    
    // Generate random IDs
    const callId = Math.random().toString(36).substring(2, 15) + '@test';
    const fromTag = Math.random().toString(36).substring(2, 15);
    const branch = Math.random().toString(36).substring(2, 15);
    
    const inviteMessage = [
         `INVITE sip:30@${sipServer} SIP/2.0`,
         `Via: SIP/2.0/UDP ${sipServer}:${localPort};branch=z9hG4bK${branch}`,
         `From: <sip:31@${sipServer}>;tag=${fromTag}`,
         `To: <sip:30@${sipServer}>`,
        `Call-ID: ${callId}`,
        `CSeq: 1 INVITE`,
        `Contact: <sip:31@${sipServer}:${localPort}>`,
        `Content-Type: application/sdp`,
        `User-Agent: VoiceAI-Test/1.0`,
        `Content-Length: 0`,
        '',
        ''
    ].join('\r\n');
    
    console.log('📋 INVITE Message:');
    console.log(inviteMessage);
    console.log('📤 Sending INVITE to trunk 30...');
    
    // Bind socket
    socket.bind(localPort, () => {
        console.log(`🎯 Socket bound to port ${localPort}`);
        
        // Send INVITE
        socket.send(inviteMessage, sipPort, sipServer, (error) => {
            if (error) {
                console.error('❌ Error sending INVITE:', error);
            } else {
                console.log('✅ INVITE sent to trunk 30');
            }
        });
    });
    
    // Listen for responses
    socket.on('message', (msg, rinfo) => {
        console.log(`\n📨 Received response from ${rinfo.address}:${rinfo.port}`);
        console.log('Response:', msg.toString());
    });
    
    socket.on('error', (err) => {
        console.error('❌ Socket error:', err);
    });
    
    // Wait for responses
    console.log('⏳ Waiting for responses (10 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('🛑 Closing socket...');
    socket.close();
    console.log('✅ Test completed');
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    process.exit(0);
});

// Start the test
testTrunk30().catch(console.error);
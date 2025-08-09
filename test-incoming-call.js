import dgram from 'dgram';

// Test script to simulate an incoming call to extension 31
async function testIncomingCall() {
    console.log('🧪 Testing incoming call to extension 31...');
    
    const socket = dgram.createSocket('udp4');
    const targetHost = '127.0.0.1'; // Local bridge
    const targetPort = 5060; // Bridge port
    const localPort = 5062; // Use different port
    
    // Generate random IDs
    const callId = Math.random().toString(36).substring(2, 15) + '@test-incoming';
    const fromTag = Math.random().toString(36).substring(2, 15);
    const branch = Math.random().toString(36).substring(2, 15);
    
    // Simulate INVITE from UCM to extension 31
    const inviteMessage = [
        `INVITE sip:31@${targetHost}:${targetPort} SIP/2.0`,
        `Via: SIP/2.0/UDP 122.163.120.156:5060;branch=z9hG4bK${branch}`,
        `From: <sip:100@122.163.120.156>;tag=${fromTag}`,
        `To: <sip:31@${targetHost}:${targetPort}>`,
        `Call-ID: ${callId}`,
        `CSeq: 1 INVITE`,
        `Contact: <sip:100@122.163.120.156:5060>`,
        `Content-Type: application/sdp`,
        `User-Agent: Grandstream-UCM6202/1.0`,
        `Content-Length: 142`,
        '',
        'v=0',
        'o=- 123456 654321 IN IP4 122.163.120.156',
        's=-',
        'c=IN IP4 122.163.120.156',
        't=0 0',
        'm=audio 5004 RTP/AVP 0',
        'a=rtpmap:0 PCMU/8000',
        ''
    ].join('\r\n');
    
    console.log('📋 INVITE Message:');
    console.log(inviteMessage);
    console.log('📤 Sending INVITE to SIP bridge...');
    
    // Handle responses
    socket.on('message', (msg, rinfo) => {
        console.log(`📨 Received response from ${rinfo.address}:${rinfo.port}:`);
        console.log(msg.toString());
        
        const response = msg.toString();
        if (response.includes('200 OK')) {
            console.log('✅ Call answered successfully!');
            
            // Send ACK
            const ackMessage = [
                `ACK sip:31@${targetHost}:${targetPort} SIP/2.0`,
                `Via: SIP/2.0/UDP 122.163.120.156:5060;branch=z9hG4bK${branch}`,
                `From: <sip:100@122.163.120.156>;tag=${fromTag}`,
                `To: <sip:31@${targetHost}:${targetPort}>`,
                `Call-ID: ${callId}`,
                `CSeq: 1 ACK`,
                `Content-Length: 0`,
                '',
                ''
            ].join('\r\n');
            
            console.log('📤 Sending ACK...');
            socket.send(ackMessage, targetPort, targetHost);
            
            // Wait a bit then send BYE
            setTimeout(() => {
                const byeMessage = [
                    `BYE sip:31@${targetHost}:${targetPort} SIP/2.0`,
                    `Via: SIP/2.0/UDP 122.163.120.156:5060;branch=z9hG4bK${Math.random().toString(36).substring(2, 15)}`,
                    `From: <sip:100@122.163.120.156>;tag=${fromTag}`,
                    `To: <sip:31@${targetHost}:${targetPort}>`,
                    `Call-ID: ${callId}`,
                    `CSeq: 2 BYE`,
                    `Content-Length: 0`,
                    '',
                    ''
                ].join('\r\n');
                
                console.log('📤 Sending BYE...');
                socket.send(byeMessage, targetPort, targetHost);
                
                setTimeout(() => {
                    console.log('🏁 Test completed');
                    socket.close();
                    process.exit(0);
                }, 2000);
            }, 5000);
        }
    });
    
    socket.on('error', (error) => {
        console.error('❌ Socket error:', error);
    });
    
    // Bind socket
    socket.bind(localPort, () => {
        console.log(`🎯 Socket bound to port ${localPort}`);
        
        // Send INVITE
        socket.send(inviteMessage, targetPort, targetHost, (error) => {
            if (error) {
                console.error('❌ Error sending INVITE:', error);
            } else {
                console.log('✅ INVITE sent successfully');
            }
        });
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
        console.log('⏰ Test timeout - no response received');
        socket.close();
        process.exit(1);
    }, 30000);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted');
    process.exit(0);
});

testIncomingCall().catch(console.error);
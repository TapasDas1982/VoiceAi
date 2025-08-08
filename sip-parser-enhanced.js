const sipParser = require('sip-parser');
const sdpTransform = require('sdp-transform');
const crypto = require('crypto');

/**
 * Enhanced SIP Message Parser
 * Provides robust parsing and validation of SIP messages
 */
class EnhancedSIPParser {
    constructor() {
        this.supportedMethods = [
            'INVITE', 'ACK', 'BYE', 'CANCEL', 'REGISTER', 
            'OPTIONS', 'INFO', 'PRACK', 'UPDATE', 'REFER', 
            'SUBSCRIBE', 'NOTIFY', 'MESSAGE'
        ];
        
        this.supportedHeaders = {
            // Core headers
            'via': 'Via',
            'from': 'From',
            'to': 'To',
            'call-id': 'Call-ID',
            'cseq': 'CSeq',
            'contact': 'Contact',
            'content-length': 'Content-Length',
            'content-type': 'Content-Type',
            
            // Authentication
            'authorization': 'Authorization',
            'www-authenticate': 'WWW-Authenticate',
            'proxy-authenticate': 'Proxy-Authenticate',
            'proxy-authorization': 'Proxy-Authorization',
            
            // Session management
            'session-expires': 'Session-Expires',
            'min-se': 'Min-SE',
            'refresher': 'Refresher',
            
            // Call control
            'refer-to': 'Refer-To',
            'referred-by': 'Referred-By',
            'replaces': 'Replaces',
            
            // Auto-answer (RFC 5373)
            'answer-mode': 'Answer-Mode',
            'priv-answer-mode': 'Priv-Answer-Mode',
            
            // Media
            'allow': 'Allow',
            'supported': 'Supported',
            'require': 'Require',
            'user-agent': 'User-Agent',
            'server': 'Server'
        };
        
        console.log('[EnhancedSIPParser] Initialized with support for', this.supportedMethods.length, 'methods');
    }

    /**
     * Parse SIP message with enhanced error handling
     */
    parseMessage(rawMessage) {
        try {
            // Basic validation
            if (!rawMessage || typeof rawMessage !== 'string') {
                throw new Error('Invalid message format');
            }

            const lines = rawMessage.trim().split('\r\n');
            if (lines.length < 1) {
                throw new Error('Empty message');
            }

            // Parse using sip-parser library
            const parsed = sipParser.parseSIPMessage(rawMessage);
            
            if (!parsed) {
                throw new Error('Failed to parse SIP message');
            }

            // Enhance parsed message with additional processing
            const enhanced = this.enhanceMessage(parsed, rawMessage);
            
            console.log(`[EnhancedSIPParser] Parsed ${enhanced.method || enhanced.status} message`);
            return enhanced;
            
        } catch (error) {
            console.error('[EnhancedSIPParser] Parse error:', error.message);
            return this.fallbackParse(rawMessage);
        }
    }

    /**
     * Fallback parser for malformed messages
     */
    fallbackParse(rawMessage) {
        console.log('[EnhancedSIPParser] Using fallback parser');
        
        const lines = rawMessage.trim().split('\r\n');
        const firstLine = lines[0];
        const headers = {};
        let body = '';
        
        // Parse first line
        let method, uri, version, status, reason;
        if (firstLine.startsWith('SIP/2.0')) {
            // Response
            const parts = firstLine.split(' ');
            version = parts[0];
            status = parseInt(parts[1]);
            reason = parts.slice(2).join(' ');
        } else {
            // Request
            const parts = firstLine.split(' ');
            method = parts[0];
            uri = parts[1];
            version = parts[2];
        }
        
        // Parse headers
        let bodyStartIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line === '') {
                bodyStartIndex = i + 1;
                break;
            }
            
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const name = line.substring(0, colonIndex).trim().toLowerCase();
                const value = line.substring(colonIndex + 1).trim();
                headers[name] = value;
            }
        }
        
        // Extract body
        if (bodyStartIndex > 0 && bodyStartIndex < lines.length) {
            body = lines.slice(bodyStartIndex).join('\r\n');
        }
        
        return {
            method,
            uri,
            version,
            status,
            reason,
            headers,
            body,
            raw: rawMessage,
            parsed: true,
            fallback: true
        };
    }

    /**
     * Enhance parsed message with additional processing
     */
    enhanceMessage(parsed, rawMessage) {
        const enhanced = {
            ...parsed,
            raw: rawMessage,
            parsed: true,
            fallback: false
        };
        
        // Extract common header values
        enhanced.callId = this.extractCallId(enhanced);
        enhanced.fromTag = this.extractTag(enhanced.headers.from);
        enhanced.toTag = this.extractTag(enhanced.headers.to);
        enhanced.branch = this.extractBranch(enhanced.headers.via);
        enhanced.cseq = this.extractCSeq(enhanced);
        
        // Parse authentication headers
        enhanced.auth = this.parseAuthHeaders(enhanced.headers);
        
        // Parse session timer headers
        enhanced.sessionTimer = this.parseSessionTimerHeaders(enhanced.headers);
        
        // Parse auto-answer headers
        enhanced.autoAnswer = this.parseAutoAnswerHeaders(enhanced.headers);
        
        // Parse SDP if present
        if (enhanced.body && enhanced.headers['content-type']?.includes('application/sdp')) {
            enhanced.sdp = this.parseSDP(enhanced.body);
        }
        
        return enhanced;
    }

    /**
     * Extract Call-ID header
     */
    extractCallId(message) {
        return message.headers['call-id'] || message.headers['i'];
    }

    /**
     * Extract tag from From/To header
     */
    extractTag(headerValue) {
        if (!headerValue) return null;
        const tagMatch = headerValue.match(/tag=([^;\s]+)/);
        return tagMatch ? tagMatch[1] : null;
    }

    /**
     * Extract branch from Via header
     */
    extractBranch(viaHeader) {
        if (!viaHeader) return null;
        const branchMatch = viaHeader.match(/branch=([^;\s]+)/);
        return branchMatch ? branchMatch[1] : null;
    }

    /**
     * Extract CSeq information
     */
    extractCSeq(message) {
        const cseqHeader = message.headers.cseq || message.headers['cseq'];
        if (!cseqHeader) return null;
        
        const parts = cseqHeader.trim().split(' ');
        return {
            sequence: parseInt(parts[0]),
            method: parts[1]
        };
    }

    /**
     * Parse authentication headers
     */
    parseAuthHeaders(headers) {
        const auth = {};
        
        // WWW-Authenticate
        if (headers['www-authenticate']) {
            auth.challenge = this.parseAuthChallenge(headers['www-authenticate']);
        }
        
        // Authorization
        if (headers.authorization) {
            auth.credentials = this.parseAuthCredentials(headers.authorization);
        }
        
        return Object.keys(auth).length > 0 ? auth : null;
    }

    /**
     * Parse authentication challenge
     */
    parseAuthChallenge(challengeHeader) {
        const challenge = { scheme: 'Digest' };
        const params = challengeHeader.replace(/^Digest\s+/, '').split(',');
        
        for (const param of params) {
            const [key, value] = param.trim().split('=');
            if (key && value) {
                challenge[key.toLowerCase()] = value.replace(/"/g, '');
            }
        }
        
        return challenge;
    }

    /**
     * Parse authentication credentials
     */
    parseAuthCredentials(authHeader) {
        const credentials = { scheme: 'Digest' };
        const params = authHeader.replace(/^Digest\s+/, '').split(',');
        
        for (const param of params) {
            const [key, value] = param.trim().split('=');
            if (key && value) {
                credentials[key.toLowerCase()] = value.replace(/"/g, '');
            }
        }
        
        return credentials;
    }

    /**
     * Parse session timer headers (RFC 4028)
     */
    parseSessionTimerHeaders(headers) {
        const sessionTimer = {};
        
        if (headers['session-expires']) {
            const parts = headers['session-expires'].split(';');
            sessionTimer.expires = parseInt(parts[0]);
            
            for (let i = 1; i < parts.length; i++) {
                const [key, value] = parts[i].trim().split('=');
                if (key === 'refresher') {
                    sessionTimer.refresher = value;
                }
            }
        }
        
        if (headers['min-se']) {
            sessionTimer.minSE = parseInt(headers['min-se']);
        }
        
        return Object.keys(sessionTimer).length > 0 ? sessionTimer : null;
    }

    /**
     * Parse auto-answer headers (RFC 5373)
     */
    parseAutoAnswerHeaders(headers) {
        const autoAnswer = {};
        
        if (headers['answer-mode']) {
            autoAnswer.mode = headers['answer-mode'];
        }
        
        if (headers['priv-answer-mode']) {
            autoAnswer.privMode = headers['priv-answer-mode'];
        }
        
        return Object.keys(autoAnswer).length > 0 ? autoAnswer : null;
    }

    /**
     * Parse SDP content
     */
    parseSDP(sdpContent) {
        try {
            const parsed = sdpTransform.parse(sdpContent);
            
            // Extract useful information
            const sdpInfo = {
                version: parsed.version,
                origin: parsed.origin,
                sessionName: parsed.name,
                connection: parsed.connection,
                media: []
            };
            
            // Process media descriptions
            if (parsed.media) {
                for (const media of parsed.media) {
                    const mediaInfo = {
                        type: media.type,
                        port: media.port,
                        protocol: media.protocol,
                        payloads: media.payloads,
                        connection: media.connection,
                        attributes: media.attributes || [],
                        rtpmap: {},
                        fmtp: {}
                    };
                    
                    // Parse RTP map and format parameters
                    if (media.rtp) {
                        for (const rtp of media.rtp) {
                            mediaInfo.rtpmap[rtp.payload] = {
                                codec: rtp.codec,
                                rate: rtp.rate,
                                encoding: rtp.encoding
                            };
                        }
                    }
                    
                    if (media.fmtp) {
                        for (const fmtp of media.fmtp) {
                            mediaInfo.fmtp[fmtp.payload] = fmtp.config;
                        }
                    }
                    
                    sdpInfo.media.push(mediaInfo);
                }
            }
            
            console.log('[EnhancedSIPParser] Parsed SDP with', sdpInfo.media.length, 'media streams');
            return sdpInfo;
            
        } catch (error) {
            console.error('[EnhancedSIPParser] SDP parse error:', error.message);
            return { raw: sdpContent, error: error.message };
        }
    }

    /**
     * Generate SIP response
     */
    generateResponse(request, statusCode, reasonPhrase, additionalHeaders = {}, body = '') {
        const headers = {
            'Via': request.headers.via,
            'From': request.headers.from,
            'To': request.headers.to,
            'Call-ID': request.headers['call-id'],
            'CSeq': request.headers.cseq,
            'Content-Length': body.length.toString(),
            ...additionalHeaders
        };
        
        // Add To tag if not present and this is a 2xx response
        if (statusCode >= 200 && statusCode < 300 && !this.extractTag(headers.To)) {
            const toTag = crypto.randomBytes(8).toString('hex');
            headers.To += `;tag=${toTag}`;
        }
        
        let response = `SIP/2.0 ${statusCode} ${reasonPhrase}\r\n`;
        
        for (const [name, value] of Object.entries(headers)) {
            response += `${name}: ${value}\r\n`;
        }
        
        response += '\r\n';
        
        if (body) {
            response += body;
        }
        
        return response;
    }

    /**
     * Generate SIP request
     */
    generateRequest(method, uri, headers = {}, body = '') {
        const defaultHeaders = {
            'Via': `SIP/2.0/UDP ${headers.localAddress || '127.0.0.1'}:${headers.localPort || 5060};branch=z9hG4bK${crypto.randomBytes(8).toString('hex')}`,
            'From': headers.from || `<sip:user@${headers.localAddress || '127.0.0.1'}>`,
            'To': headers.to || `<sip:${uri}>`,
            'Call-ID': headers.callId || crypto.randomBytes(16).toString('hex'),
            'CSeq': `${headers.sequence || 1} ${method}`,
            'Max-Forwards': '70',
            'User-Agent': 'VoiceAI-SIP/1.0',
            'Content-Length': body.length.toString()
        };
        
        const finalHeaders = { ...defaultHeaders, ...headers };
        
        let request = `${method} ${uri} SIP/2.0\r\n`;
        
        for (const [name, value] of Object.entries(finalHeaders)) {
            if (!['localAddress', 'localPort', 'sequence', 'callId'].includes(name)) {
                request += `${name}: ${value}\r\n`;
            }
        }
        
        request += '\r\n';
        
        if (body) {
            request += body;
        }
        
        return request;
    }

    /**
     * Validate SIP message
     */
    validateMessage(message) {
        const errors = [];
        
        // Check required headers for requests
        if (message.method) {
            const requiredHeaders = ['via', 'from', 'to', 'call-id', 'cseq'];
            for (const header of requiredHeaders) {
                if (!message.headers[header]) {
                    errors.push(`Missing required header: ${header}`);
                }
            }
            
            // Method-specific validation
            if (message.method === 'INVITE' && !message.headers.contact) {
                errors.push('INVITE missing Contact header');
            }
        }
        
        // Check required headers for responses
        if (message.status) {
            const requiredHeaders = ['via', 'from', 'to', 'call-id', 'cseq'];
            for (const header of requiredHeaders) {
                if (!message.headers[header]) {
                    errors.push(`Missing required header: ${header}`);
                }
            }
        }
        
        // Validate Content-Length
        const contentLength = parseInt(message.headers['content-length'] || '0');
        const actualLength = message.body ? message.body.length : 0;
        if (contentLength !== actualLength) {
            errors.push(`Content-Length mismatch: declared ${contentLength}, actual ${actualLength}`);
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get message summary for logging
     */
    getMessageSummary(message) {
        if (message.method) {
            return `${message.method} ${message.uri} (Call-ID: ${message.callId})`;
        } else if (message.status) {
            return `${message.status} ${message.reason} (Call-ID: ${message.callId})`;
        } else {
            return 'Unknown message type';
        }
    }
}

module.exports = {
    EnhancedSIPParser
};
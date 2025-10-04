import { nanoid } from 'nanoid';

// ✅ PRODUCTION: JWT_SECRET must match signaling server
const JWT_SECRET = '41db8ba3fa459485fc41b2a98a2d705ea32ffe41600200506949fb70f5046f02db54eeff';

// ✅ PRODUCTION: Configuration with environment detection
export const COLLABORATION_CONFIG = {
  // ✅ CRITICAL: Production signaling server URL
  SIGNALING_SERVER: process.env.NODE_ENV === 'production' 
    ? 'wss://signaling-server-production-af26.up.railway.app/signal'
    : 'ws://localhost:3003/signal',
  
  // ✅ PRODUCTION: Web client URL with Vercel domain
  WEB_CLIENT_URL: (() => {
    if (typeof window !== 'undefined') {
      // ✅ PRODUCTION: Use current domain (works for Vercel deployments)
      return window.location.origin;
    }
    
    // ✅ PRODUCTION: Server-side URL detection
    if (process.env.NODE_ENV === 'production') {
      return 'https://collate-mu.vercel.app';
    }
    
    return 'http://localhost:3000';
  })(),
  
  // ✅ PRODUCTION: API base URL for signaling server
  API_BASE_URL: process.env.NODE_ENV === 'production'
    ? 'https://signaling-server-production-af26.up.railway.app'
    : 'http://localhost:3003',
  
  TOKEN_EXPIRY: {
    PERMANENT: 30 * 24 * 60 * 60 * 1000, // 30 days
    INVITATION: 7 * 24 * 60 * 60 * 1000   // 7 days
  },
  
  // ✅ PRODUCTION: Environment info
  ENVIRONMENT: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production'
};

// Utility functions
export const generateRoomId = () => `room_${Date.now()}_${nanoid(8)}`;
export const generatePeerId = () => `peer_${Date.now()}_${nanoid(8)}`;

// ✅ PRODUCTION: Enhanced HMAC-SHA256 with better error handling
async function hmacSha256(key, data) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(key);
      const msgData = encoder.encode(data);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
      return btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch (error) {
      console.error('❌ Crypto.subtle HMAC failed:', error);
    }
  }

  // ✅ PRODUCTION: Better fallback warning
  console.warn('🚨 Using insecure token signing - crypto.subtle not available');
  console.warn('   This should not happen in production!');
  return btoa(`fallback-${Date.now()}-${Math.random()}`);
}

// Base64URL encoding
function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export class LinkGenerator {
  constructor() {
    this.isElectron = false;
    this.initialized = false;
    this.config = COLLABORATION_CONFIG;
  }

  initialize() {
    if (this.initialized) return;

    this.isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
    this.initialized = true;

    console.log('🔗 LinkGenerator initialized:', {
      environment: this.config.ENVIRONMENT,
      isProduction: this.config.IS_PRODUCTION,
      isElectron: this.isElectron,
      hasElectronJWT: this.isElectron && !!window.electronAPI?.generateJWT,
      baseUrl: this.config.WEB_CLIENT_URL,
      signalingServer: this.config.SIGNALING_SERVER,
      apiBase: this.config.API_BASE_URL,
      jwtSecret: JWT_SECRET.substring(0, 10) + '...'
    });
  }

  /**
   * ✅ PRODUCTION: Generate a proper JWT token with enhanced payload
   */
  async generateValidToken(payload) {
    // ✅ PRODUCTION: Enhanced payload with environment info
    const enhancedPayload = {
      documentId: payload.documentId,          
      roomId: `collab-${payload.documentId}`,  
      fieldName: `editor-${payload.documentId}`, 
      permissions: payload.permissions || ['read', 'write'],
      peerId: payload.peerId || generatePeerId(),
      type: payload.type || 'collaboration',
      linkId: payload.linkId || `link_${Date.now()}_${nanoid(8)}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (payload.expiryHours || 24 * 30) * 3600,
      
      // ✅ PRODUCTION: Environment metadata
      env: this.config.ENVIRONMENT,
      clientUrl: this.config.WEB_CLIENT_URL,
      signalingUrl: this.config.SIGNALING_SERVER,
      
      // ✅ PRODUCTION: Enhanced metadata
      recipientName: payload.recipientName || null,
      version: '2.0.0'
    };

    console.log('🔍 Generated production token payload:', {
      ...enhancedPayload,
      exp: new Date(enhancedPayload.exp * 1000).toISOString()
    });

    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedPayload = base64urlEncode(JSON.stringify(enhancedPayload));

    const signature = await hmacSha256(JWT_SECRET, `${encodedHeader}.${encodedPayload}`);

    const finalToken = `${encodedHeader}.${encodedPayload}.${signature}`;
    console.log('✅ Generated production JWT token:', finalToken.substring(0, 50) + '...');

    return finalToken;
  }

  /**
   * ✅ PRODUCTION: Generate a collaboration link with environment awareness
   */
  async generateCollaborationLink(documentId, permissions = ['read', 'write'], expiryHours = 24 * 30) {
    if (!this.initialized) this.initialize();

    console.log('🔗 Generating collaboration link for document:', documentId, 'in', this.config.ENVIRONMENT);

    const payload = {
      documentId: documentId,
      permissions: permissions,
      type: 'collaboration',
      expiryHours: expiryHours
    };

    let token;

    if (this.isElectron && window.electronAPI?.generateJWT) {
      try {
        console.log('🔐 Using Electron JWT generation');
        token = await window.electronAPI.generateJWT(payload);
      } catch (error) {
        console.warn('Electron JWT generation failed, using browser JWT:', error);
        token = await this.generateValidToken(payload);
      }
    } else {
      console.log('🌐 Using browser JWT generation');
      token = await this.generateValidToken(payload);
    }

    // ✅ PRODUCTION: Use proper base URL
    const url = `${this.config.WEB_CLIENT_URL}/editor/${documentId}?token=${token}`;

    const linkData = {
      documentId: documentId,
      url: url,
      token: token,
      permissions: permissions,
      roomId: `collab-${documentId}`,
      fieldName: `editor-${documentId}`,
      expiresAt: Date.now() + (expiryHours * 60 * 60 * 1000),
      createdAt: Date.now(),
      
      // ✅ PRODUCTION: Environment metadata
      environment: this.config.ENVIRONMENT,
      signalingServer: this.config.SIGNALING_SERVER
    };

    console.log('✅ Generated collaboration link:', url);
    return linkData;
  }

  /**
   * Generate a permanent collaboration link (30 days)
   */
  async generatePermanentLink(documentId, roomId = null, permissions = ['read', 'write']) {
    console.log('🔗 Generating permanent link for document:', documentId);
    return await this.generateCollaborationLink(documentId, permissions, 24 * 30); // 30 days
  }

  /**
   * Generate an invitation collaboration link (7 days)
   */
  async generateInvitationLink(documentId, roomId, permissions = ['read', 'write'], recipientName = null) {
    console.log('🔗 Generating invitation link for document:', documentId);
    return await this.generateCollaborationLink(documentId, permissions, 24 * 7); // 7 days
  }

  /**
   * ✅ PRODUCTION: Enhanced one-time invitation link
   */
  async generateOneTimeLink(documentId, recipientName = null) {
    if (!this.initialized) this.initialize();

    console.log('🔗 Generating ONE-TIME link for:', documentId, 'recipient:', recipientName, 'in', this.config.ENVIRONMENT);

    const linkId = `onetime_${Date.now()}_${nanoid(8)}`;

    const payload = {
      documentId: documentId,
      type: 'one-time',
      linkId: linkId,
      permissions: ['read', 'write'],
      recipientName: recipientName,
      expiryHours: 24 * 7, // 7 days to use the link
      peerId: generatePeerId()
    };

    const token = await this.generateValidToken(payload);

    const linkData = {
      documentId: documentId,
      linkId: linkId,
      url: `${this.config.WEB_CLIENT_URL}/editor/${documentId}?token=${token}`,
      token: token,
      type: 'one-time',
      recipientName: recipientName || 'Anonymous',
      used: false,
      usedAt: null,
      usedBy: null,
      roomId: `collab-${documentId}`,
      fieldName: `editor-${documentId}`,
      expiresAt: Date.now() + (24 * 7 * 60 * 60 * 1000), // 7 days
      createdAt: Date.now(),
      
      // ✅ PRODUCTION: Environment metadata
      environment: this.config.ENVIRONMENT,
      signalingServer: this.config.SIGNALING_SERVER
    };

    console.log('✅ One-time link generated:', linkData.url);
    return linkData;
  }

  /**
   * ✅ PRODUCTION: Enhanced long-expiry permanent link
   */
  async generateLongExpiryLink(documentId, permissions = ['read', 'write']) {
    if (!this.initialized) this.initialize();

    console.log('🔗 Generating LONG-EXPIRY link for:', documentId, 'permissions:', permissions, 'in', this.config.ENVIRONMENT);

    const linkId = `permanent_${Date.now()}_${nanoid(8)}`;

    const payload = {
      documentId: documentId,
      type: 'permanent',
      linkId: linkId,
      permissions: permissions,
      expiryHours: 24 * 30, // 30 days
      peerId: generatePeerId()
    };

    const token = await this.generateValidToken(payload);

    const linkData = {
      documentId: documentId,
      linkId: linkId,
      url: `${this.config.WEB_CLIENT_URL}/editor/${documentId}?token=${token}`,
      token: token,
      type: 'permanent',
      permissions: permissions,
      roomId: `collab-${documentId}`,
      fieldName: `editor-${documentId}`,
      expiresAt: Date.now() + (24 * 30 * 60 * 60 * 1000), // 30 days
      createdAt: Date.now(),
      
      // ✅ PRODUCTION: Environment metadata
      environment: this.config.ENVIRONMENT,
      signalingServer: this.config.SIGNALING_SERVER
    };

    console.log('✅ Long-expiry link generated:', linkData.url);
    return linkData;
  }

  /**
   * ✅ PRODUCTION: Enhanced token validation with better error reporting
   */
  validateTokenWithUsage(token, collaborationData = null) {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload) {
      console.warn('❌ Token validation failed: invalid token structure');
      return { valid: false, reason: 'invalid-token' };
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (decoded.payload.exp <= now) {
      console.warn('❌ Token validation failed: expired', {
        expired: new Date(decoded.payload.exp * 1000),
        now: new Date()
      });
      return { valid: false, reason: 'expired' };
    }

    // Check if token is revoked
    if (collaborationData?.revoked?.includes(decoded.payload.linkId)) {
      console.warn('❌ Token validation failed: revoked');
      return { valid: false, reason: 'revoked' };
    }

    // ✅ PRODUCTION: Enhanced one-time usage checking
    if (decoded.payload.type === 'one-time') {
      const oneTimeLink = collaborationData?.links?.oneTime?.find(
        link => link.linkId === decoded.payload.linkId
      );

      if (oneTimeLink?.used) {
        console.warn('❌ Token validation failed: already used', {
          usedAt: oneTimeLink.usedAt,
          usedBy: oneTimeLink.usedBy
        });
        return {
          valid: false,
          reason: 'already-used',
          usedAt: oneTimeLink.usedAt,
          usedBy: oneTimeLink.usedBy
        };
      }
    }

    console.log('✅ Token validation successful:', {
      type: decoded.payload.type,
      documentId: decoded.payload.documentId,
      environment: decoded.payload.env
    });

    return {
      valid: true,
      payload: decoded.payload,
      linkType: decoded.payload.type,
      linkId: decoded.payload.linkId
    };
  }

  /**
   * ✅ PRODUCTION: Enhanced token decoding with better error handling
   */
  decodeToken(token) {
    try {
      if (!token || typeof token !== 'string') {
        console.error('❌ Invalid token: not a string');
        return null;
      }

      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('❌ Invalid token format - expected 3 parts, got', parts.length);
        return null;
      }

      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

      console.log('📋 Decoded token:', { 
        header, 
        payload: {
          ...payload,
          exp: new Date(payload.exp * 1000).toISOString()
        }
      });
      
      return { header, payload, signature: parts[2] };
    } catch (error) {
      console.error('❌ Failed to decode token:', error.message);
      return null;
    }
  }

  /**
   * ✅ PRODUCTION: Enhanced token validation with detailed logging
   */
  isTokenValid(token) {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload) {
      console.warn('❌ Token invalid: failed to decode');
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const isNotExpired = decoded.payload.exp > now;
    const timeUntilExpiry = decoded.payload.exp - now;

    console.log('🔍 Token validation:', {
      valid: isNotExpired,
      expired: !isNotExpired,
      expiresAt: new Date(decoded.payload.exp * 1000).toISOString(),
      currentTime: new Date().toISOString(),
      timeUntilExpiry: timeUntilExpiry > 0 ? `${Math.floor(timeUntilExpiry / 3600)}h ${Math.floor((timeUntilExpiry % 3600) / 60)}m` : 'expired',
      environment: decoded.payload.env || 'unknown'
    });

    return isNotExpired;
  }

  /**
   * ✅ PRODUCTION: Get current configuration
   */
  getConfig() {
    return {
      ...this.config,
      initialized: this.initialized,
      isElectron: this.isElectron
    };
  }

  /**
   * ✅ PRODUCTION: Test connectivity to signaling server
   */
  async testConnectivity() {
    if (!this.initialized) this.initialize();

    try {
      const response = await fetch(this.config.API_BASE_URL + '/health');
      const data = await response.json();
      
      console.log('✅ Signaling server connectivity test passed:', data);
      return {
        success: true,
        server: data,
        environment: this.config.ENVIRONMENT
      };
    } catch (error) {
      console.error('❌ Signaling server connectivity test failed:', error);
      return {
        success: false,
        error: error.message,
        environment: this.config.ENVIRONMENT
      };
    }
  }
}

// ✅ PRODUCTION: Create singleton instance
export const linkGenerator = new LinkGenerator();

// ✅ PRODUCTION: Export configuration for use elsewhere

console.log('🔗 LinkGenerator module loaded:', {
  environment: COLLABORATION_CONFIG.ENVIRONMENT,
  signalingServer: COLLABORATION_CONFIG.SIGNALING_SERVER,
  webClientUrl: COLLABORATION_CONFIG.WEB_CLIENT_URL
});

/**
 * Auth Controller
 * 
 * Fastify routes for authentication management.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth.service.js';

// Extend Fastify instance
declare module 'fastify' {
  interface FastifyInstance {
    authService: AuthService;
  }
}

export async function authController(app: FastifyInstance) {
  const authService = app.authService;

  /**
   * GET /api/auth/state
   * Get current auth state (public - no token required)
   */
  app.get('/state', async () => {
    return authService.getAuthState();
  });

  /**
   * POST /api/auth/verify
   * Verify a token (public - used for login)
   */
  app.post('/verify', async (request, reply) => {
    const body = request.body as { token?: string };
    const token = body?.token;

    if (!token) {
      return reply.status(400).send({ 
        valid: false, 
        message: 'Token is required' 
      });
    }

    const result = await authService.verifyToken(token);
    
    if (result.valid) {
      // Set valid token as HttpOnly cookie
      const isProduction = process.env.NODE_ENV === 'production';
      reply.setCookie('neko-session', token, {
        path: '/',
        httpOnly: true, 
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
    }

    return result;
  });

  /**
   * POST /api/auth/logout
   * Clear session cookie
   */
  app.post('/logout', async (request, reply) => {
    reply.clearCookie('neko-session', { path: '/' });
    return { success: true };
  });

  /**
   * POST /api/auth/enable
   * Enable authentication (requires no auth when first enabling, 
   * but requires existing token if already enabled)
   */
  app.post('/enable', async (request, reply) => {
    if (authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = request.body as { token?: string };
    const token = body?.token;

    if (!token) {
      return reply.status(400).send({ 
        error: 'Token is required' 
      });
    }

    try {
      await authService.enableAuth(token);
      return { 
        success: true, 
        message: 'Authentication enabled successfully' 
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to enable authentication';
      return reply.status(400).send({ error: message });
    }
  });

  /**
   * POST /api/auth/disable
   * Disable authentication (requires valid token)
   */
  app.post('/disable', async (request, reply) => {
    if (authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = request.body as { token?: string };
    const token = body?.token;

    // If auth is required, verify token first
    // Skip verification if forced off
    if (authService.isAuthRequired() && !authService.isForceAccessControlOff()) {
      // Check cookie first
      let valid = false;
      const cookieToken = request.cookies?.['neko-session'];
      
      if (cookieToken) {
        const verifyResult = await authService.verifyToken(cookieToken);
        if (verifyResult.valid) {
          valid = true;
        }
      }

      if (!valid) {
        if (!token) {
          return reply.status(401).send({ 
            error: 'Token is required to disable authentication' 
          });
        }
  
        const verifyResult = await authService.verifyToken(token);
        if (!verifyResult.valid) {
          return reply.status(401).send({ 
            error: verifyResult.message || 'Invalid token' 
          });
        }
      }
    }

    authService.disableAuth();
    return { 
      success: true, 
      message: 'Authentication disabled successfully' 
    };
  });

  /**
   * PUT /api/auth/token
   * Update token (requires valid existing token)
   */
  app.put('/token', async (request, reply) => {
    if (authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = request.body as { currentToken?: string; newToken?: string };
    const { currentToken, newToken } = body;

    // Verify current token if auth is enabled
    // Skip verification if forced off
    if (authService.isAuthRequired() && !authService.isForceAccessControlOff()) {
      // Check cookie first
      let valid = false;
      const cookieToken = request.cookies?.['neko-session'];
      
      if (cookieToken) {
        const verifyResult = await authService.verifyToken(cookieToken);
        if (verifyResult.valid) {
          valid = true;
        }
      }

      if (!valid) {
        if (!currentToken) {
          return reply.status(401).send({ 
            error: 'Current token is required' 
          });
        }
  
        const verifyResult = await authService.verifyToken(currentToken);
        if (!verifyResult.valid) {
          return reply.status(401).send({ 
            error: verifyResult.message || 'Invalid current token' 
          });
        }
      }
    }

    if (!newToken) {
      return reply.status(400).send({ 
        error: 'New token is required' 
      });
    }

    try {
      await authService.updateToken(newToken);
      return { 
        success: true, 
        message: 'Token updated successfully' 
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update token';
      return reply.status(400).send({ error: message });
    }
  });
}

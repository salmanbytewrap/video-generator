import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { createApp } from '../../src/app';
import { errorHandler } from '../../src/middleware/errorHandler';
import { corsMiddleware, createRateLimit, createRateLimiters } from '../../src/middleware/security';

describe('security middleware', () => {
  it('createRateLimit_AfterLimit_Returns429InStandardResponseShape', async () => {
    const app = express();
    app.get('/', createRateLimit({ windowMs: 60_000, limit: 2, message: 'Slow down' }), (_req, res) => {
      res.send('ok');
    });

    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await request(app).get('/')).status);
    const blocked = await request(app).get('/');

    expect(statuses).toEqual([200, 200, 429]);
    expect(blocked.body).toEqual({ success: false, error: 'TooManyRequestsError', message: 'Slow down' });
    expect(blocked.headers).toHaveProperty('ratelimit-policy');
  });

  it('createRateLimiters_WhenDisabled_ReturnsNoLimiters', () => {
    expect(createRateLimiters(false)).toEqual({});
    expect(Object.keys(createRateLimiters(true))).toEqual(['auth', 'upload', 'createJob']);
  });

  it('corsMiddleware_AllowsListedOriginOnly', async () => {
    const app = express();
    app.use(corsMiddleware('https://app.example.com, http://localhost:5173'));
    app.get('/', (_req, res) => res.send('ok'));

    const allowed = await request(app).get('/').set('Origin', 'https://app.example.com');
    const denied = await request(app).get('/').set('Origin', 'https://evil.example.com');

    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('createApp_SetsSecurityHeaders', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('errorHandler_WithMalformedJson_Returns400', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Malformed JSON body');
  });

  it('errorHandler_WithOversizedUpload_Returns413', async () => {
    const app = express();
    app.post('/', multer({ limits: { fileSize: 10 } }).single('file'), (_req, res) => res.send('ok'));
    app.use(errorHandler);

    const res = await request(app).post('/').attach('file', Buffer.alloc(100), 'big.mp4');

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, error: 'PayloadTooLargeError' });
  });

  it('errorHandler_WithOtherMulterError_Returns400', async () => {
    const app = express();
    app.post('/', multer().single('file'), (_req, res) => res.send('ok'));
    app.use(errorHandler);

    const res = await request(app).post('/').attach('other', Buffer.alloc(10), 'x.mp4');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('LIMIT_UNEXPECTED_FILE');
  });
});

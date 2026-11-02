import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { decodeToken } from '../../../src/modules/auth/auth.middleware';
import { createToken, verifyToken } from '../../../src/modules/auth/token';

const secret = process.env.JWT_SECRET!;
const payload = { id: 'user-1', email: 'jane@example.com' };

function run(token?: string) {
  const req = { header: vi.fn().mockReturnValue(token) } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  decodeToken(req, res as unknown as Response, next);
  return { req, res, next };
}

describe('auth token + decodeToken', () => {
  it('createToken_ThenVerifyToken_RoundTripsPayload', () => {
    expect(verifyToken(createToken(payload))).toEqual(payload);
  });

  it('decodeToken_WithValidIdToken_SetsUserAndCallsNext', () => {
    const { req, res, next } = run(createToken(payload));

    expect(req.header).toHaveBeenCalledWith('idToken');
    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('decodeToken_WithoutIdToken_Returns401WithRequiredMessage', () => {
    const { req, res, next } = run(undefined);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "'idToken' header is required" }),
    );
    expect(req.user).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['garbage token', 'not-a-jwt'],
    ['wrong secret', jwt.sign({}, 'x'.repeat(40), { algorithm: 'HS384', subject: 'u', issuer: 'video-generator' })],
    ['wrong algorithm', jwt.sign({}, secret, { algorithm: 'HS256', subject: 'u', issuer: 'video-generator' })],
    ['wrong issuer', jwt.sign({}, secret, { algorithm: 'HS384', subject: 'u', issuer: 'someone-else' })],
    ['expired token', jwt.sign({}, secret, { algorithm: 'HS384', subject: 'u', issuer: 'video-generator', expiresIn: -10 })],
    ['missing subject', jwt.sign({}, secret, { algorithm: 'HS384', issuer: 'video-generator' })],
  ])('decodeToken_With%s_Returns401', (_name, token) => {
    const { req, res, next } = run(token);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Invalid or expired token' }),
    );
    expect(req.user).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});

import request from 'supertest';
import { createApp } from '../../../src/app';
import { UserModel } from '../../../src/modules/user/user.model';
import { useInMemoryDatabase } from '../../support/db';

describe('Auth API', () => {
  useInMemoryDatabase();
  const app = createApp();
  const credentials = { name: 'Jane', email: 'Jane@Example.com', password: 'correct-horse' };

  it('POST /api/auth/register creates a user and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send(credentials);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, message: 'User created successfully' });
    expect(res.body.data.user).toEqual({ id: expect.any(String), name: 'Jane', email: 'jane@example.com' });
    expect(res.body.data.token).toEqual(expect.any(String));

    const stored = await UserModel.findById(res.body.data.user.id).select('+password').lean();
    expect(stored?.password).not.toBe(credentials.password);
  });

  it('POST /api/auth/register with duplicate email returns 409', async () => {
    await request(app).post('/api/auth/register').send(credentials);

    const res = await request(app).post('/api/auth/register').send(credentials);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: 'ConflictError' });
  });

  it('POST /api/auth/register with invalid body returns 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'Validation failed' });
  });

  it('POST /api/auth/login with valid credentials returns a token usable on /me', async () => {
    await request(app).post('/api/auth/register').send(credentials);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    const me = await request(app).get('/api/auth/me').set('idToken', login.body.data.token);

    expect(login.status).toBe(200);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual(login.body.data.user);
    expect(me.body.data).not.toHaveProperty('password');
  });

  it('POST /api/auth/login with wrong password returns 401 with a generic message', async () => {
    await request(app).post('/api/auth/register').send(credentials);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'wrong-pass' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid email or password' });
  });

  it('GET /api/auth/me without a token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });
});

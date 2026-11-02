import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../../src/app';
import { createToken } from '../../../src/modules/auth/token';
import { UserRepository } from '../../../src/modules/user';
import { useInMemoryDatabase } from '../../support/db';

describe('Users API', () => {
  useInMemoryDatabase();
  const app = createApp();

  async function register(email = 'jane@example.com') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Jane', email, password: 'correct-horse' });
    return { id: res.body.data.user.id as string, token: res.body.data.token as string };
  }

  it('GET /health returns ok without auth', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Server is running' });
  });

  it('GET /api/users without a token returns 401', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(401);
  });

  it('GET /api/users and /api/users/:id return users without passwords', async () => {
    const { id, token } = await register();

    const list = await request(app).get('/api/users').set('idToken', token);
    const one = await request(app).get(`/api/users/${id}`).set('idToken', token);

    expect(list.body).toEqual({
      success: true,
      message: 'Success',
      data: [{ id, name: 'Jane', email: 'jane@example.com' }],
    });
    expect(one.body.data).toEqual(list.body.data[0]);
  });

  it('GET /api/users/:id with unknown or malformed id returns 404', async () => {
    const { token } = await register();

    const unknown = await request(app)
      .get(`/api/users/${new mongoose.Types.ObjectId()}`)
      .set('idToken', token);
    const malformed = await request(app).get('/api/users/not-an-id').set('idToken', token);

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
  });

  it('PATCH /api/users/:id updates own name', async () => {
    const { id, token } = await register();

    const res = await request(app).patch(`/api/users/${id}`).set('idToken', token).send({ name: 'Janet' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Janet');
  });

  it('PATCH /api/users/:id for another user returns 403', async () => {
    const jane = await register('jane@example.com');
    const bob = await register('bob@example.com');

    const res = await request(app)
      .patch(`/api/users/${jane.id}`)
      .set('idToken', bob.token)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(403);
  });

  it('DELETE /api/users/:id deletes own account, then token owner is gone', async () => {
    const { id, token } = await register();

    const del = await request(app).delete(`/api/users/${id}`).set('idToken', token);
    const me = await request(app).get('/api/auth/me').set('idToken', token);

    expect(del.status).toBe(200);
    expect(del.body).toEqual({ success: true, message: 'User deleted successfully' });
    expect(me.status).toBe(404);
  });

  it('PATCH and DELETE with a malformed id of own token return 404', async () => {
    const token = createToken({ id: 'not-an-id', email: 'x@example.com' });

    const del = await request(app).delete('/api/users/not-an-id').set('idToken', token);
    const patch = await request(app).patch('/api/users/not-an-id').set('idToken', token).send({ name: 'X' });

    expect(del.status).toBe(404);
    expect(patch.status).toBe(404);
  });

  it('unknown API route returns 404', async () => {
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('unexpected errors return a generic 500', async () => {
    const failingRepo = {
      find: vi.fn().mockRejectedValue(new Error('secret db detail')),
    } as unknown as UserRepository;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(createApp({ userRepository: failingRepo }))
      .get('/api/users')
      .set('idToken', createToken({ id: 'user-1', email: 'x@example.com' }));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });
});

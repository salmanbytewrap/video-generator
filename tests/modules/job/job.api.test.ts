import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../../src/app';
import { JobModel } from '../../../src/modules/job/job.model';
import { useInMemoryDatabase } from '../../support/db';
import { createSampleImage, createSampleVideo, makeTempDir } from '../../support/media';

describe('Assets and Jobs API', () => {
  useInMemoryDatabase();
  const app = createApp();
  let dir: string;
  let cleanup: () => Promise<void>;
  let videoPath: string;
  let imagePath: string;

  beforeAll(async () => {
    ({ dir, cleanup } = await makeTempDir());
    videoPath = await createSampleVideo(`${dir}/sample.mp4`, { seconds: 2 });
    imagePath = await createSampleImage(`${dir}/photo.png`);
  });

  afterAll(() => cleanup());

  async function register(email = 'jane@example.com') {
    const res = await request(app).post('/api/auth/register').send({ name: 'Jane', email, password: 'correct-horse' });
    return res.body.data.token as string;
  }

  async function uploadVideo(token: string, file = videoPath, name = 'Cool Sneakers.mp4') {
    return request(app).post('/api/assets').set('idToken', token).attach('file', file, name);
  }

  describe('POST /api/assets', () => {
    it('uploads a video, probes it and returns a playable signed URL', async () => {
      const token = await register();

      const res = await uploadVideo(token);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        kind: 'video',
        mimeType: 'video/mp4',
        originalName: 'Cool Sneakers.mp4',
        metadata: { width: 320, height: 180, hasAudio: true },
      });
      const file = await request(app).get(res.body.data.url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('video/mp4');
    });

    it('accepts images', async () => {
      const token = await register();

      const res = await uploadVideo(token, imagePath, 'photo.png');

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    });

    it('rejects files whose content is not a supported media type', async () => {
      const token = await register();

      const res = await request(app)
        .post('/api/assets')
        .set('idToken', token)
        .attach('file', Buffer.from('<html>not a video</html>'), { filename: 'fake.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(415);
    });

    it('rejects a request without a file', async () => {
      const token = await register();

      const res = await request(app).post('/api/assets').set('idToken', token).field('x', 'y');

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/assets');

      expect(res.status).toBe(401);
    });

    it("hides other users' assets", async () => {
      const owner = await register('owner@example.com');
      const other = await register('other@example.com');
      const asset = (await uploadVideo(owner)).body.data;

      expect((await request(app).get(`/api/assets/${asset.id}`).set('idToken', owner)).status).toBe(200);
      expect((await request(app).get(`/api/assets/${asset.id}`).set('idToken', other)).status).toBe(404);
    });
  });

  describe('/api/jobs', () => {
    it('GET /presets is public and lists formats per platform', async () => {
      const res = await request(app).get('/api/jobs/presets');

      expect(res.status).toBe(200);
      expect(res.body.data.tiktok[0]).toMatchObject({ format: 'vertical', width: 1080, height: 1920 });
    });

    it('creates a job, honours Idempotency-Key and lists it', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;
      const body = { inputAssetId: asset.id, platform: 'instagram', format: 'reel', options: { fit: 'blur' } };

      const first = await request(app).post('/api/jobs').set('idToken', token).set('Idempotency-Key', 'click-0001').send(body);
      const second = await request(app).post('/api/jobs').set('idToken', token).set('Idempotency-Key', 'click-0001').send(body);
      const list = await request(app).get('/api/jobs').set('idToken', token);

      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({ status: 'queued', platform: 'instagram', format: 'reel', options: { fit: 'blur' } });
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(list.body.data).toMatchObject({ total: 1, page: 1 });
    });

    it('rejects invalid platform/format combinations', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;

      const res = await request(app)
        .post('/api/jobs')
        .set('idToken', token)
        .send({ inputAssetId: asset.id, platform: 'tiktok', format: 'square' });

      expect(res.status).toBe(400);
    });

    it("cannot use another user's asset or see another user's job", async () => {
      const owner = await register('owner@example.com');
      const other = await register('other@example.com');
      const asset = (await uploadVideo(owner)).body.data;
      const job = (
        await request(app).post('/api/jobs').set('idToken', owner).send({ inputAssetId: asset.id, platform: 'tiktok', format: 'vertical' })
      ).body.data;

      const steal = await request(app)
        .post('/api/jobs')
        .set('idToken', other)
        .send({ inputAssetId: asset.id, platform: 'tiktok', format: 'vertical' });
      const peek = await request(app).get(`/api/jobs/${job.id}`).set('idToken', other);

      expect(steal.status).toBe(404);
      expect(peek.status).toBe(404);
    });

    it('enforces the per-user active job limit', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;
      const body = { inputAssetId: asset.id, platform: 'tiktok', format: 'vertical' };

      const statuses = [];
      for (let i = 0; i < 4; i += 1) {
        statuses.push((await request(app).post('/api/jobs').set('idToken', token).send(body)).status);
      }

      expect(statuses).toEqual([201, 201, 201, 429]);
    });

    it('cancels a queued job, then allows retry, but not retry of a queued job', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;
      const job = (
        await request(app).post('/api/jobs').set('idToken', token).send({ inputAssetId: asset.id, platform: 'youtube', format: 'short' })
      ).body.data;

      const retryQueued = await request(app).post(`/api/jobs/${job.id}/retry`).set('idToken', token);
      const cancel = await request(app).post(`/api/jobs/${job.id}/cancel`).set('idToken', token);
      const cancelAgain = await request(app).post(`/api/jobs/${job.id}/cancel`).set('idToken', token);
      const retry = await request(app).post(`/api/jobs/${job.id}/retry`).set('idToken', token);

      expect(retryQueued.status).toBe(409);
      expect(cancel.body.data.status).toBe('cancelled');
      expect(cancelAgain.status).toBe(409);
      expect(retry.body.data).toMatchObject({ status: 'queued', attempts: 0 });
    });

    it('download and preview return 409 until the job completes', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;
      const job = (
        await request(app).post('/api/jobs').set('idToken', token).send({ inputAssetId: asset.id, platform: 'tiktok', format: 'vertical' })
      ).body.data;

      expect((await request(app).get(`/api/jobs/${job.id}/download`).set('idToken', token)).status).toBe(409);
      expect((await request(app).get(`/api/jobs/${job.id}/preview`).set('idToken', token)).status).toBe(409);
    });

    it('returns signed download and preview URLs for a completed job', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;
      const job = (
        await request(app).post('/api/jobs').set('idToken', token).send({ inputAssetId: asset.id, platform: 'tiktok', format: 'vertical' })
      ).body.data;
      await JobModel.updateOne({ _id: job.id }, { status: 'completed', outputAssetId: asset.id });

      const download = await request(app).get(`/api/jobs/${job.id}/download`).set('idToken', token);
      const preview = await request(app).get(`/api/jobs/${job.id}/preview`).set('idToken', token);
      const file = await request(app).get(download.body.data.url);

      expect(download.body.data.url).toContain('name=');
      expect(preview.body.data.url).not.toContain('name=');
      expect(file.headers['content-disposition']).toContain('attachment');
    });

    it('returns 404 for unknown job ids', async () => {
      const token = await register();

      const res = await request(app).get(`/api/jobs/${new mongoose.Types.ObjectId()}`).set('idToken', token);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/files', () => {
    it('rejects missing, tampered and traversal links', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;
      const url = new URL(asset.url, 'http://x');

      const missing = await request(app).get('/api/files');
      const tampered = await request(app).get(`${url.pathname}${url.search.replace('sig=', 'sig=zz')}`);
      url.searchParams.set('key', '../../etc/passwd');
      const traversal = await request(app).get(`${url.pathname}${url.search}`);

      expect(missing.status).toBe(400);
      expect(tampered.status).toBe(403);
      expect(traversal.status).toBe(400);
    });

    it('supports HTTP range requests for video seeking', async () => {
      const token = await register();
      const asset = (await uploadVideo(token)).body.data;

      const res = await request(app).get(asset.url).set('Range', 'bytes=0-99');

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toMatch(/^bytes 0-99\//);
    });
  });
});

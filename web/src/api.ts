import type { Asset, AuthResult, CreateJobInput, Job, JobPage, PresetCatalog } from './types';

const TOKEN_KEY = 'clipforge.token';
const TOKEN_HEADER = 'idToken';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
  onUnauthorized: (handler: () => void) => {
    onUnauthorized = handler;
  },
};

interface Envelope<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

function errorFrom(status: number, body: Envelope<unknown> | null): ApiError {
  const generic = !body?.message || body.message === 'Authorization failed.';
  const message = (generic ? body?.error : body?.message) ?? `Request failed (${status})`;
  if (status === 401) onUnauthorized();
  return new ApiError(message, status);
}

function authHeaders(): Record<string, string> {
  const token = tokenStore.get();
  return token ? { [TOKEN_HEADER]: token } : {};
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...authHeaders(),
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success) throw errorFrom(res.status, body);
  return body.data as T;
}

function uploadFile(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/assets');
    for (const [name, value] of Object.entries(authHeaders())) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: Envelope<Asset> | null = null;
      try {
        body = JSON.parse(xhr.responseText) as Envelope<Asset>;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.success) resolve(body.data as Asset);
      else reject(errorFrom(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0));
    signal?.addEventListener('abort', () => xhr.abort());

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export const api = {
  register: (input: { name: string; email: string; password: string }) =>
    request<AuthResult>('/auth/register', { method: 'POST', body: input }),
  login: (input: { email: string; password: string }) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: input }),
  me: () => request<AuthResult['user']>('/auth/me'),

  presets: () => request<PresetCatalog>('/jobs/presets'),
  uploadFile,
  importUrl: (url: string) => request<Asset>('/assets/url', { method: 'POST', body: { url } }),

  createJob: (input: CreateJobInput, idempotencyKey: string) =>
    request<Job>('/jobs', { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } }),
  listJobs: (page: number, limit = 12) => request<JobPage>(`/jobs?page=${page}&limit=${limit}`),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  retryJob: (id: string) => request<Job>(`/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => request<Job>(`/jobs/${id}/cancel`, { method: 'POST' }),
  downloadUrl: (id: string) => request<{ url: string }>(`/jobs/${id}/download`),
};

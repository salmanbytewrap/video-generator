import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';

type Mode = 'login' | 'register';

export function AuthPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.login({ email: form.email, password: form.password })
        : api.register(form),
    onSuccess: (result) => {
      signIn(result);
      navigate(from, { replace: true });
    },
  });

  if (user) return <Navigate to={from} replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  return (
    <div className="auth-wrap">
      <section className="hero">
        <h1>Turn one clip into every format.</h1>
        <p className="muted">
          Upload a video or image, pick Instagram, TikTok or YouTube, and get a correctly sized MP4 with a ready-to-post
          caption.
        </p>
      </section>
      <form className="card auth-card" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'tab active' : 'tab'}
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>
        {mode === 'register' && (
          <label>
            Name
            <input value={form.name} onChange={update('name')} required maxLength={100} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            required
            minLength={mode === 'register' ? 8 : 1}
            maxLength={72}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mutation.error && <p className="error">{mutation.error.message}</p>}
        <button className="btn primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

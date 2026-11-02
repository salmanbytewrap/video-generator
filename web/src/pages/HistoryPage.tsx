import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { formatDate, PLATFORM_LABELS } from '../format';
import { ACTIVE_STATUSES } from '../types';

const PAGE_SIZE = 12;

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['jobs', page],
    queryFn: () => api.listJobs(page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 4000 : false),
  });

  if (query.isLoading) return <div className="center muted">Loading history…</div>;
  if (query.error) return <p className="error">{query.error.message}</p>;
  const { items, total } = query.data!;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total === 0) {
    return (
      <div className="center stack">
        <p className="muted">No generations yet.</p>
        <Link to="/" className="btn primary">
          Create your first
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>History</h1>
      <div className="history-grid">
        {items.map((job) => (
          <Link key={job.id} to={`/jobs/${job.id}`} className="card history-item">
            <div className="history-thumb">
              {job.thumbnailUrl ? (
                <img src={job.thumbnailUrl} alt="" />
              ) : (
                <span className="muted">{job.progress}%</span>
              )}
            </div>
            <div className="stack small-gap">
              <div className="row between">
                <strong>{PLATFORM_LABELS[job.platform]}</strong>
                <StatusBadge status={job.status} />
              </div>
              <span className="muted">{job.preset.label}</span>
              <small className="muted">{formatDate(job.createdAt)}</small>
            </div>
          </Link>
        ))}
      </div>
      {pages > 1 && (
        <div className="row center-row">
          <button className="btn ghost small" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

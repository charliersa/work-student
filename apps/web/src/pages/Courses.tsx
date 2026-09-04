import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function Courses() {
  const { data, isLoading, error } = useQuery({ queryKey: ['courses'], queryFn: api.courses });

  if (isLoading) return <div className="muted">載入中…</div>;
  if (error) return <div className="alert">{(error as Error).message}</div>;
  if (!data?.length) return <div className="card muted">目前沒有任何課程。</div>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>我的課程</h2>
      {data.map((c) => (
        <Link key={c.id} to={`/courses/${c.id}`} style={{ display: 'block', color: 'inherit' }}>
          <div className="card">
            <div className="row between">
              <div>
                <h3>{c.title}</h3>
                <div className="muted">
                  {c.code} · {c.term} 學期
                </div>
              </div>
              <span className="badge none">{c.myRole === 'student' ? '修課學生' : '授課教師'}</span>
            </div>
          </div>
        </Link>
      ))}
    </>
  );
}

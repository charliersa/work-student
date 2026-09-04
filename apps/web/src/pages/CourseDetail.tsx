import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { AssignmentDto } from '@ws/shared';
import { api } from '../api';
import { fmtDateTime, relativeToNow } from '../format';

export function CourseDetail() {
  const courseId = Number(useParams().courseId);
  const qc = useQueryClient();

  const course = useQuery({ queryKey: ['course', courseId], queryFn: () => api.course(courseId) });
  const list = useQuery({
    queryKey: ['assignments', courseId],
    queryFn: () => api.assignments(courseId),
  });

  const publish = useMutation({
    mutationFn: api.publishAssignment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments', courseId] }),
  });

  const isStaff = course.data?.myRole !== 'student';

  if (list.isLoading) return <div className="muted">載入中…</div>;
  if (list.error) return <div className="alert">{(list.error as Error).message}</div>;

  return (
    <>
      <div className="row between" style={{ marginBottom: 18 }}>
        <div>
          <Link to="/" className="muted">
            ← 我的課程
          </Link>
          <h2 style={{ margin: '4px 0 0' }}>{course.data?.title ?? '課程'}</h2>
          <div className="muted">
            {course.data?.code} · {course.data?.term} 學期
          </div>
        </div>
      </div>

      {list.data?.length === 0 && <div className="card muted">這門課還沒有作業。</div>}

      {list.data?.map((a) => (
        <div className="card" key={a.id}>
          <div className="row between">
            <div style={{ flex: 1, minWidth: 240 }}>
              <Link to={`/assignments/${a.id}`} style={{ color: 'inherit' }}>
                <h3>{a.title}</h3>
              </Link>
              <div className="muted">
                截止：{fmtDateTime(a.effectiveDueAt)}（{relativeToNow(a.effectiveDueAt)}）
                {a.lateUntil && ` · 補交至 ${fmtDateTime(a.lateUntil)}`}
              </div>
            </div>
            <div className="row">
              {isStaff ? (
                <StaffBadges a={a} onPublish={() => publish.mutate(a.id)} busy={publish.isPending} />
              ) : (
                <StudentBadge a={a} />
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function StudentBadge({ a }: { a: AssignmentDto }) {
  const s = a.mySubmission;
  if (!s || s.status === 'draft') return <span className="badge none">尚未繳交</span>;
  return (
    <span className={`badge ${s.isLate ? 'late' : 'ok'}`}>{s.isLate ? '已繳交（遲交）' : '已繳交'}</span>
  );
}

function StaffBadges({
  a,
  onPublish,
  busy,
}: {
  a: AssignmentDto;
  onPublish: () => void;
  busy: boolean;
}) {
  return (
    <>
      <span className="badge none">
        已交 {a.submittedCount ?? 0} / {a.totalStudents ?? 0}
      </span>
      {a.publishedAt ? (
        <span className="badge ok">已發布</span>
      ) : (
        <button className="small ghost" onClick={onPublish} disabled={busy}>
          發布給學生
        </button>
      )}
    </>
  );
}

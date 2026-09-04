import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { formatBytes, isAllowedExt, type AssignmentDto, type SubmissionDto } from '@ws/shared';
import { api, uploadFile } from '../api';
import { useAuth } from '../auth';
import { fmtDateTime, relativeToNow } from '../format';

export function AssignmentDetail() {
  const assignmentId = Number(useParams().assignmentId);
  const { me } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['assignment', assignmentId],
    queryFn: () => api.assignment(assignmentId),
  });

  if (isLoading) return <div className="muted">載入中…</div>;
  if (error) return <div className="alert">{(error as Error).message}</div>;
  if (!data) return null;

  const isStudent = me?.role === 'student';

  return (
    <>
      <Link to={`/courses/${data.courseId}`} className="muted">
        ← 返回課程
      </Link>
      <h2 style={{ margin: '4px 0 2px' }}>{data.title}</h2>
      <div className="muted" style={{ marginBottom: 18 }}>
        截止：{fmtDateTime(data.effectiveDueAt)}（{relativeToNow(data.effectiveDueAt)}）
        {data.lateUntil ? ` · 可補交至 ${fmtDateTime(data.lateUntil)}（記為遲交）` : ' · 逾期不收'}
      </div>

      {data.descriptionMd && (
        <div className="card" style={{ whiteSpace: 'pre-wrap' }}>
          {data.descriptionMd}
        </div>
      )}

      {isStudent ? <StudentPanel assignment={data} /> : <TeacherPanel assignment={data} />}
    </>
  );
}

/* ================================================================== *
 * 學生端
 * ================================================================== */
function StudentPanel({ assignment }: { assignment: AssignmentDto }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submissions = useQuery({
    queryKey: ['mySubmissions', assignment.id],
    queryFn: () => api.mySubmissions(assignment.id),
  });

  const draft = submissions.data?.find((s) => s.status === 'draft') ?? null;
  const submitted = submissions.data?.filter((s) => s.status !== 'draft') ?? [];
  const attemptsUsed = submitted.length;
  const canStartNew = !draft && attemptsUsed < assignment.maxAttempts;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['mySubmissions', assignment.id] });
    void qc.invalidateQueries({ queryKey: ['assignment', assignment.id] });
  };

  const startDraft = useMutation({
    mutationFn: () => api.createDraft(assignment.id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const submit = useMutation({
    mutationFn: (id: number) => api.submit(id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const removeFile = useMutation({
    mutationFn: ({ sid, fid }: { sid: number; fid: number }) => api.removeFile(sid, fid),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !draft) return;
    setError(null);

    for (const file of Array.from(files)) {
      // 前端先擋一次，減少無效上傳；後端仍會完整再驗一次
      if (!isAllowedExt(file.name, assignment.allowedExt)) {
        setError(`${file.name}：只接受 ${assignment.allowedExt.join('、')} 格式`);
        continue;
      }
      if (file.size > assignment.maxFileBytes) {
        setError(`${file.name}：超過 ${formatBytes(assignment.maxFileBytes)} 上限`);
        continue;
      }
      try {
        await uploadFile(draft.id, file, (p) =>
          setPhase(p === 'presign' ? '準備上傳…' : p === 'upload' ? `上傳 ${file.name}…` : '驗證檔案…'),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : '上傳失敗');
      }
    }
    setPhase(null);
    refresh();
  }

  return (
    <>
      {error && <div className="alert">{error}</div>}

      {submitted.length > 0 && (
        <div className="card">
          <h3>已送出的版本</h3>
          {submitted.map((s) => (
            <div key={s.id} className="row between" style={{ paddingTop: 8 }}>
              <div>
                <span className={`badge ${s.isLate ? 'late' : 'ok'}`}>
                  第 {s.attemptNo} 次 · {s.isLate ? '遲交' : '準時'}
                </span>
                <span className="muted" style={{ marginLeft: 10 }}>
                  {fmtDateTime(s.submittedAt)}
                </span>
              </div>
              <FileList submission={s} />
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="card">
          <div className="row between">
            <h3>繳交內容（第 {draft.attemptNo} 次 · 尚未送出）</h3>
            <span className="muted">
              {draft.files.length} / {assignment.maxFiles} 個檔案
            </span>
          </div>

          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
          >
            {phase ?? (
              <>
                點擊或拖曳檔案到這裡上傳
                <div className="muted" style={{ marginTop: 4 }}>
                  接受 {assignment.allowedExt.join('、')}，單檔上限 {formatBytes(assignment.maxFileBytes)}
                </div>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <FileList
            submission={draft}
            onRemove={(fid) => removeFile.mutate({ sid: draft.id, fid })}
          />

          <div className="row between" style={{ marginTop: 18 }}>
            <span className="muted">送出後就不能再修改，請確認檔案無誤。</span>
            <button
              onClick={() => submit.mutate(draft.id)}
              disabled={submit.isPending || draft.files.length === 0}
            >
              {submit.isPending ? '送出中…' : '正式送出'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card row between">
          <span className="muted">
            {canStartNew
              ? `你還可以繳交 ${assignment.maxAttempts - attemptsUsed} 次。`
              : '已用完所有繳交次數。'}
          </span>
          <button onClick={() => startDraft.mutate()} disabled={!canStartNew || startDraft.isPending}>
            開始繳交
          </button>
        </div>
      )}
    </>
  );
}

function FileList({
  submission,
  onRemove,
}: {
  submission: SubmissionDto;
  onRemove?: (fileId: number) => void;
}) {
  if (submission.files.length === 0) return null;

  async function download(fileId: number) {
    const { url } = await api.downloadUrl(fileId);
    window.location.href = url; // 短效簽章網址，一律以 attachment 下載
  }

  return (
    <ul className="filelist">
      {submission.files.map((f) => (
        <li key={f.id}>
          <span>
            {f.originalName}
            <span className="muted"> · {formatBytes(f.sizeBytes)}</span>
          </span>
          <span className="row">
            <button className="small ghost" onClick={() => void download(f.id)}>
              下載
            </button>
            {onRemove && (
              <button className="small danger" onClick={() => onRemove(f.id)}>
                移除
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ================================================================== *
 * 教師端
 * ================================================================== */
function TeacherPanel({ assignment }: { assignment: AssignmentDto }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['classSubmissions', assignment.id],
    queryFn: () => api.classSubmissions(assignment.id),
  });

  if (isLoading) return <div className="muted">載入中…</div>;
  if (error) return <div className="alert">{(error as Error).message}</div>;

  const submittedCount = data?.filter((s) => s.id !== 0).length ?? 0;

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3>全班繳交狀況</h3>
        <span className="muted">
          已交 {submittedCount} / {data?.length ?? 0}
        </span>
      </div>

      <table>
        <thead>
          <tr>
            <th>學號</th>
            <th>姓名</th>
            <th>狀態</th>
            <th>繳交時間</th>
            <th>檔案</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.studentId}>
              <td>{s.studentNo ?? '—'}</td>
              <td>{s.studentName}</td>
              <td>
                {s.id === 0 ? (
                  <span className="badge none">未繳交</span>
                ) : (
                  <span className={`badge ${s.isLate ? 'late' : 'ok'}`}>
                    {s.isLate ? '遲交' : '準時'}
                  </span>
                )}
              </td>
              <td className="muted">{fmtDateTime(s.submittedAt)}</td>
              <td>
                {s.files.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <FileList submission={s} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

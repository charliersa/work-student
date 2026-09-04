import type {
  AssignmentDto,
  ConfirmFileInput,
  CourseDto,
  MeDto,
  SubmissionDto,
} from '@ws/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include', // httpOnly cookie
    headers: init.body ? { 'Content-Type': 'application/json' } : {},
    ...init,
  });

  if (!res.ok) {
    let message = `請求失敗（${res.status}）`;
    let issues: { path: string; message: string }[] | undefined;
    try {
      const body = await res.json();
      message = body.message ?? message;
      issues = body.issues;
      if (Array.isArray(message)) message = message.join('、');
    } catch {
      /* 忽略非 JSON 回應 */
    }
    throw new ApiError(message, res.status, issues);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  /* ---- 認證 ---- */
  me: () => request<MeDto>('/api/me'),
  login: (account: string, password: string) => post<MeDto>('/api/auth/login', { account, password }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),

  /* ---- 課程與作業 ---- */
  courses: () => request<CourseDto[]>('/api/courses'),
  course: (id: number) => request<CourseDto>(`/api/courses/${id}`),
  assignments: (courseId: number) => request<AssignmentDto[]>(`/api/courses/${courseId}/assignments`),
  assignment: (id: number) => request<AssignmentDto>(`/api/assignments/${id}`),
  publishAssignment: (id: number) => post<AssignmentDto>(`/api/assignments/${id}/publish`),

  /* ---- 繳交 ---- */
  createDraft: (assignmentId: number) =>
    post<SubmissionDto>(`/api/assignments/${assignmentId}/submissions`),
  updateDraft: (id: number, textContent: string) =>
    request<SubmissionDto>(`/api/submissions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ textContent }),
    }),
  submit: (id: number) => post<SubmissionDto>(`/api/submissions/${id}/submit`),
  mySubmissions: (assignmentId: number) =>
    request<SubmissionDto[]>(`/api/submissions/mine?assignmentId=${assignmentId}`),
  classSubmissions: (assignmentId: number) =>
    request<SubmissionDto[]>(`/api/assignments/${assignmentId}/submissions`),
  removeFile: (submissionId: number, fileId: number) =>
    request<SubmissionDto>(`/api/submissions/${submissionId}/files/${fileId}`, { method: 'DELETE' }),
  downloadUrl: (fileId: number) => request<{ url: string }>(`/api/files/${fileId}/download-url`),
};

/**
 * 三段式上傳：presign → 直傳位元組 → 確認。
 * 檔案位元組完全不經過 API 伺服器的記憶體，換成 S3/R2 時這段程式碼一行都不用改。
 */
export async function uploadFile(
  submissionId: number,
  file: File,
  onProgress?: (phase: 'presign' | 'upload' | 'confirm') => void,
): Promise<SubmissionDto> {
  onProgress?.('presign');
  const ticket = await post<{
    uploadUrl: string;
    method: 'PUT';
    storageKey: string;
    uploadToken: string;
  }>('/api/uploads/presign', {
    submissionId,
    filename: file.name,
    size: file.size,
    mimeType: file.type || undefined,
  });

  onProgress?.('upload');
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    // 一律以 octet-stream 上傳；真正的型別由伺服器讀 magic bytes 判定
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new ApiError(`檔案上傳失敗（${put.status}）`, put.status);

  onProgress?.('confirm');
  const payload: ConfirmFileInput = {
    storageKey: ticket.storageKey,
    uploadToken: ticket.uploadToken,
  };
  return post<SubmissionDto>(`/api/submissions/${submissionId}/files`, payload);
}

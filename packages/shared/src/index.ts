import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * 角色與狀態（與 DB enum 一一對應）
 * ------------------------------------------------------------------ */
export const USER_ROLES = ['student', 'teacher', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const COURSE_ROLES = ['student', 'teacher', 'ta'] as const;
export type CourseRole = (typeof COURSE_ROLES)[number];

export const SUBMISSION_STATUSES = ['draft', 'submitted', 'graded', 'returned'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/* ------------------------------------------------------------------ *
 * 上傳規則：前後端共用同一份，前端先擋、後端必再驗一次
 * ------------------------------------------------------------------ */
export const DEFAULT_ALLOWED_EXT = ['pdf', 'zip', 'docx', 'pptx', 'png', 'jpg'] as const;
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
export const ABSOLUTE_MAX_FILE_BYTES = 200 * 1024 * 1024; // 全站硬上限
export const DEFAULT_MAX_FILES = 5;

/** 取得小寫副檔名（不含點）；沒有副檔名回傳 '' */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(i + 1).toLowerCase() : '';
}

export function isAllowedExt(filename: string, allowed: readonly string[]): boolean {
  return allowed.map((e) => e.toLowerCase()).includes(extOf(filename));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** 遲交判定：一律以伺服器時間為準，且送出當下就凍結成欄位 */
export function computeLate(now: Date, dueAt: Date, lateUntil: Date | null): {
  isLate: boolean;
  rejected: boolean;
} {
  if (now <= dueAt) return { isLate: false, rejected: false };
  if (lateUntil && now <= lateUntil) return { isLate: true, rejected: false };
  return { isLate: true, rejected: true };
}

/* ------------------------------------------------------------------ *
 * 請求驗證 Schema
 * ------------------------------------------------------------------ */
export const loginSchema = z.object({
  account: z.string().min(1, '請輸入 email 或學號').max(200),
  password: z.string().min(6, '密碼至少 6 碼').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, '時間格式錯誤'));

export const createAssignmentSchema = z
  .object({
    title: z.string().min(1, '請輸入標題').max(200),
    descriptionMd: z.string().max(20000).optional().nullable(),
    dueAt: isoDate,
    lateUntil: isoDate.optional().nullable(),
    maxScore: z.number().min(0).max(1000).default(100),
    maxAttempts: z.number().int().min(1).max(50).default(1),
    maxFiles: z.number().int().min(1).max(20).default(DEFAULT_MAX_FILES),
    maxFileBytes: z.number().int().min(1).max(ABSOLUTE_MAX_FILE_BYTES).default(DEFAULT_MAX_FILE_BYTES),
    allowedExt: z.array(z.string().regex(/^[a-z0-9]{1,10}$/i)).min(1).default([...DEFAULT_ALLOWED_EXT]),
  })
  .refine((v) => !v.lateUntil || new Date(v.lateUntil) >= new Date(v.dueAt), {
    message: '補交截止時間不可早於截止時間',
    path: ['lateUntil'],
  });
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = createAssignmentSchema.innerType().partial();
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const presignSchema = z.object({
  submissionId: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive().max(ABSOLUTE_MAX_FILE_BYTES),
  mimeType: z.string().max(200).optional(),
});
export type PresignInput = z.infer<typeof presignSchema>;

export const confirmFileSchema = z.object({
  storageKey: z.string().min(1).max(500),
  uploadToken: z.string().min(1),
});
export type ConfirmFileInput = z.infer<typeof confirmFileSchema>;

export const updateSubmissionSchema = z.object({
  textContent: z.string().max(50000).nullable().optional(),
});

/* ------------------------------------------------------------------ *
 * 回傳型別（前端直接用）
 * ------------------------------------------------------------------ */
export interface MeDto {
  id: number;
  email: string;
  name: string;
  studentNo: string | null;
  role: UserRole;
}

export interface CourseDto {
  id: number;
  code: string;
  title: string;
  term: string;
  myRole: CourseRole;
}

export interface AssignmentDto {
  id: number;
  courseId: number;
  courseTitle?: string;
  title: string;
  descriptionMd: string | null;
  dueAt: string;
  effectiveDueAt: string; // 套用個別延期後的截止時間
  lateUntil: string | null;
  maxScore: number;
  maxAttempts: number;
  maxFiles: number;
  maxFileBytes: number;
  allowedExt: string[];
  publishedAt: string | null;
  mySubmission?: SubmissionDto | null;
  submittedCount?: number;
  totalStudents?: number;
}

export interface SubmissionFileDto {
  id: number;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  scan: ScanStatus;
  uploadedAt: string;
}

export interface SubmissionDto {
  id: number;
  assignmentId: number;
  studentId: number;
  studentName?: string;
  studentNo?: string | null;
  attemptNo: number;
  status: SubmissionStatus;
  textContent: string | null;
  submittedAt: string | null;
  isLate: boolean;
  files: SubmissionFileDto[];
}

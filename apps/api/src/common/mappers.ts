import type { AssignmentDto, SubmissionDto, SubmissionFileDto } from '@ws/shared';
import type { assignments, submissionFiles, submissions } from '../db/schema';

type AssignmentRow = typeof assignments.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;
type FileRow = typeof submissionFiles.$inferSelect;

export function toAssignmentDto(
  a: AssignmentRow,
  extra: {
    courseTitle?: string;
    /** 個別延期後的截止時間；沒有延期就用 due_at */
    effectiveDueAt?: Date | null;
    mySubmission?: SubmissionDto | null;
    submittedCount?: number;
    totalStudents?: number;
  } = {},
): AssignmentDto {
  return {
    id: a.id,
    courseId: a.courseId,
    courseTitle: extra.courseTitle,
    title: a.title,
    descriptionMd: a.descriptionMd,
    dueAt: a.dueAt.toISOString(),
    effectiveDueAt: (extra.effectiveDueAt ?? a.dueAt).toISOString(),
    lateUntil: a.lateUntil ? a.lateUntil.toISOString() : null,
    maxScore: Number(a.maxScore),
    maxAttempts: a.maxAttempts,
    maxFiles: a.maxFiles,
    maxFileBytes: Number(a.maxFileBytes),
    allowedExt: a.allowedExt,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    mySubmission: extra.mySubmission,
    submittedCount: extra.submittedCount,
    totalStudents: extra.totalStudents,
  };
}

export function toFileDto(f: FileRow): SubmissionFileDto {
  return {
    id: f.id,
    originalName: f.originalName,
    sizeBytes: Number(f.sizeBytes),
    mimeType: f.mimeType,
    scan: f.scan,
    uploadedAt: f.uploadedAt.toISOString(),
  };
}

export function toSubmissionDto(
  s: SubmissionRow,
  files: FileRow[] = [],
  student?: { name: string; studentNo: string | null },
): SubmissionDto {
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    studentId: s.studentId,
    studentName: student?.name,
    studentNo: student?.studentNo,
    attemptNo: s.attemptNo,
    status: s.status,
    textContent: s.textContent,
    submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
    isLate: s.isLate,
    files: files.map(toFileDto),
  };
}

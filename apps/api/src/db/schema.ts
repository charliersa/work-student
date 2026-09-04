/**
 * Drizzle schema — 型別鏡像。schema 的真實來源是 migrations/*.sql。
 * 改動 schema 時：先寫新的 migration SQL，再同步這個檔案。
 */
import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['student', 'teacher', 'admin']);
export const courseRole = pgEnum('course_role', ['student', 'teacher', 'ta']);
export const submissionStatus = pgEnum('submission_status', [
  'draft',
  'submitted',
  'graded',
  'returned',
]);
export const scanStatus = pgEnum('scan_status', ['pending', 'clean', 'infected', 'failed']);

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  ssoSubject: text('sso_subject'),
  name: text('name').notNull(),
  studentNo: text('student_no'),
  role: userRole('role').notNull().default('student'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courses = pgTable('courses', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  term: text('term').notNull(),
  ownerId: bigint('owner_id', { mode: 'number' }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enrollments = pgTable(
  'enrollments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    courseId: bigint('course_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    role: courseRole('role').notNull().default('student'),
  },
  (t) => [uniqueIndex('enrollments_course_user_uniq').on(t.courseId, t.userId)],
);

export const assignments = pgTable(
  'assignments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    courseId: bigint('course_id', { mode: 'number' }).notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    lateUntil: timestamp('late_until', { withTimezone: true }),
    maxScore: numeric('max_score').notNull().default('100'),
    maxAttempts: integer('max_attempts').notNull().default(1),
    maxFiles: integer('max_files').notNull().default(5),
    maxFileBytes: bigint('max_file_bytes', { mode: 'number' }).notNull().default(20971520),
    allowedExt: text('allowed_ext').array().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: bigint('created_by', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assignments_course_due_idx').on(t.courseId, t.dueAt)],
);

export const extensions = pgTable(
  'extensions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    assignmentId: bigint('assignment_id', { mode: 'number' }).notNull(),
    studentId: bigint('student_id', { mode: 'number' }).notNull(),
    newDueAt: timestamp('new_due_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    grantedBy: bigint('granted_by', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('extensions_assignment_student_uniq').on(t.assignmentId, t.studentId)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    assignmentId: bigint('assignment_id', { mode: 'number' }).notNull(),
    studentId: bigint('student_id', { mode: 'number' }).notNull(),
    attemptNo: integer('attempt_no').notNull().default(1),
    status: submissionStatus('status').notNull().default('draft'),
    textContent: text('text_content'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    isLate: boolean('is_late').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('submissions_attempt_uniq').on(t.assignmentId, t.studentId, t.attemptNo),
    uniqueIndex('submissions_one_draft_per_student')
      .on(t.assignmentId, t.studentId)
      .where(sql`status = 'draft'`),
  ],
);

export const submissionFiles = pgTable(
  'submission_files',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    submissionId: bigint('submission_id', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    scan: scanStatus('scan').notNull().default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('submission_files_submission_idx').on(t.submissionId)],
);

export const grades = pgTable('grades', {
  submissionId: bigint('submission_id', { mode: 'number' }).primaryKey(),
  score: numeric('score'),
  feedbackMd: text('feedback_md'),
  gradedBy: bigint('graded_by', { mode: 'number' }).notNull(),
  gradedAt: timestamp('graded_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
});

export const comments = pgTable('comments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  submissionId: bigint('submission_id', { mode: 'number' }).notNull(),
  authorId: bigint('author_id', { mode: 'number' }).notNull(),
  body: text('body').notNull(),
  isPrivate: boolean('is_private').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: bigint('actor_id', { mode: 'number' }),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: bigint('entity_id', { mode: 'number' }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  meta: jsonb('meta').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

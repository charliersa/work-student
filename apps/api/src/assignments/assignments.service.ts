import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AssignmentDto, CreateAssignmentInput, SubmissionDto, UpdateAssignmentInput } from '@ws/shared';
import { DB } from '../db/db.module';
import type { Db } from '../db/client';
import { assignments, courses, enrollments, extensions, submissionFiles, submissions, users } from '../db/schema';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../common/current-user.decorator';
import { toAssignmentDto, toSubmissionDto } from '../common/mappers';

@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
  ) {}

  async listForCourse(user: AuthUser, courseId: number): Promise<AssignmentDto[]> {
    const role = await this.access.assertCourseMember(user, courseId);

    const rows = await this.db
      .select()
      .from(assignments)
      .where(
        role === 'student'
          ? and(eq(assignments.courseId, courseId), isNotNull(assignments.publishedAt))
          : eq(assignments.courseId, courseId),
      )
      .orderBy(assignments.dueAt);

    if (rows.length === 0) return [];

    if (role === 'student') {
      const ids = rows.map((r) => r.id);
      const mySubs = await this.latestSubmissionsOf(ids, user.id);
      const myExt = await this.extensionsOf(ids, user.id);
      return rows.map((r) =>
        toAssignmentDto(r, {
          mySubmission: mySubs.get(r.id) ?? null,
          effectiveDueAt: myExt.get(r.id) ?? r.dueAt,
        }),
      );
    }

    // 教師端：帶上「已交 / 全班人數」
    const ids = rows.map((r) => r.id);
    const counts = await this.db
      .select({ assignmentId: submissions.assignmentId, n: count() })
      .from(submissions)
      .where(and(inArray(submissions.assignmentId, ids), eq(submissions.status, 'submitted')))
      .groupBy(submissions.assignmentId);
    const countMap = new Map(counts.map((c) => [c.assignmentId, Number(c.n)]));

    const [{ n: totalStudents }] = await this.db
      .select({ n: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.role, 'student')));

    return rows.map((r) =>
      toAssignmentDto(r, {
        submittedCount: countMap.get(r.id) ?? 0,
        totalStudents: Number(totalStudents),
      }),
    );
  }

  async getOne(user: AuthUser, assignmentId: number): Promise<AssignmentDto> {
    const { assignment, role } = await this.access.loadAssignmentForUser(user, assignmentId);
    const [course] = await this.db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, assignment.courseId))
      .limit(1);

    if (role === 'student') {
      const subs = await this.latestSubmissionsOf([assignment.id], user.id);
      const ext = await this.extensionsOf([assignment.id], user.id);
      return toAssignmentDto(assignment, {
        courseTitle: course?.title,
        mySubmission: subs.get(assignment.id) ?? null,
        effectiveDueAt: ext.get(assignment.id) ?? assignment.dueAt,
      });
    }

    const [{ n: submittedCount }] = await this.db
      .select({ n: count() })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignment.id), eq(submissions.status, 'submitted')));
    const [{ n: totalStudents }] = await this.db
      .select({ n: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, assignment.courseId), eq(enrollments.role, 'student')));

    return toAssignmentDto(assignment, {
      courseTitle: course?.title,
      submittedCount: Number(submittedCount),
      totalStudents: Number(totalStudents),
    });
  }

  async create(user: AuthUser, courseId: number, input: CreateAssignmentInput): Promise<AssignmentDto> {
    await this.access.assertCourseStaff(user, courseId);
    const [row] = await this.db
      .insert(assignments)
      .values({
        courseId,
        title: input.title,
        descriptionMd: input.descriptionMd ?? null,
        dueAt: new Date(input.dueAt),
        lateUntil: input.lateUntil ? new Date(input.lateUntil) : null,
        maxScore: String(input.maxScore),
        maxAttempts: input.maxAttempts,
        maxFiles: input.maxFiles,
        maxFileBytes: input.maxFileBytes,
        allowedExt: input.allowedExt.map((e) => e.toLowerCase()),
        publishedAt: null, // 一律先存成草稿，按「發布」才對學生可見
        createdBy: user.id,
      })
      .returning();
    return toAssignmentDto(row);
  }

  async update(user: AuthUser, assignmentId: number, input: UpdateAssignmentInput): Promise<AssignmentDto> {
    const { assignment } = await this.access.loadAssignmentForUser(user, assignmentId);
    await this.access.assertCourseStaff(user, assignment.courseId);

    const patch: Partial<typeof assignments.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.descriptionMd !== undefined) patch.descriptionMd = input.descriptionMd ?? null;
    if (input.dueAt !== undefined) patch.dueAt = new Date(input.dueAt);
    if (input.lateUntil !== undefined) patch.lateUntil = input.lateUntil ? new Date(input.lateUntil) : null;
    if (input.maxScore !== undefined) patch.maxScore = String(input.maxScore);
    if (input.maxAttempts !== undefined) patch.maxAttempts = input.maxAttempts;
    if (input.maxFiles !== undefined) patch.maxFiles = input.maxFiles;
    if (input.maxFileBytes !== undefined) patch.maxFileBytes = input.maxFileBytes;
    if (input.allowedExt !== undefined) patch.allowedExt = input.allowedExt.map((e) => e.toLowerCase());

    const [row] = await this.db
      .update(assignments)
      .set(patch)
      .where(eq(assignments.id, assignmentId))
      .returning();
    return toAssignmentDto(row);
  }

  async publish(user: AuthUser, assignmentId: number): Promise<AssignmentDto> {
    const { assignment } = await this.access.loadAssignmentForUser(user, assignmentId);
    await this.access.assertCourseStaff(user, assignment.courseId);
    const [row] = await this.db
      .update(assignments)
      .set({ publishedAt: assignment.publishedAt ?? new Date() })
      .where(eq(assignments.id, assignmentId))
      .returning();
    return toAssignmentDto(row);
  }

  /** 教師端：全班繳交總覽（含未繳交者） */
  async listSubmissions(user: AuthUser, assignmentId: number): Promise<SubmissionDto[]> {
    const { assignment } = await this.access.loadAssignmentForUser(user, assignmentId);
    await this.access.assertCourseStaff(user, assignment.courseId);

    const students = await this.db
      .select({ id: users.id, name: users.name, studentNo: users.studentNo })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(and(eq(enrollments.courseId, assignment.courseId), eq(enrollments.role, 'student')))
      .orderBy(users.studentNo);

    const subs = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), inArray(submissions.status, ['submitted', 'graded', 'returned'])))
      .orderBy(desc(submissions.attemptNo));

    const latest = new Map<number, (typeof subs)[number]>();
    for (const s of subs) if (!latest.has(s.studentId)) latest.set(s.studentId, s);

    const files = latest.size
      ? await this.db
          .select()
          .from(submissionFiles)
          .where(inArray(submissionFiles.submissionId, [...latest.values()].map((s) => s.id)))
      : [];

    return students.map((stu) => {
      const s = latest.get(stu.id);
      if (!s) {
        // 未繳交：回傳一個 id = 0 的佔位，讓教師端一眼看到誰沒交
        return {
          id: 0,
          assignmentId,
          studentId: stu.id,
          studentName: stu.name,
          studentNo: stu.studentNo,
          attemptNo: 0,
          status: 'draft' as const,
          textContent: null,
          submittedAt: null,
          isLate: false,
          files: [],
        };
      }
      return toSubmissionDto(
        s,
        files.filter((f) => f.submissionId === s.id),
        stu,
      );
    });
  }

  /* ---------------- 內部工具 ---------------- */

  private async latestSubmissionsOf(assignmentIds: number[], studentId: number) {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(and(inArray(submissions.assignmentId, assignmentIds), eq(submissions.studentId, studentId)))
      .orderBy(desc(submissions.attemptNo));

    const files = rows.length
      ? await this.db
          .select()
          .from(submissionFiles)
          .where(inArray(submissionFiles.submissionId, rows.map((r) => r.id)))
      : [];

    const map = new Map<number, SubmissionDto>();
    for (const r of rows) {
      // 草稿優先顯示；否則取最新一次 attempt
      const existing = map.get(r.assignmentId);
      if (!existing || r.status === 'draft') {
        map.set(r.assignmentId, toSubmissionDto(r, files.filter((f) => f.submissionId === r.id)));
      }
    }
    return map;
  }

  private async extensionsOf(assignmentIds: number[], studentId: number) {
    const rows = await this.db
      .select()
      .from(extensions)
      .where(and(inArray(extensions.assignmentId, assignmentIds), eq(extensions.studentId, studentId)));
    return new Map(rows.map((r) => [r.assignmentId, r.newDueAt]));
  }

  async requireAssignment(id: number) {
    const [row] = await this.db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
    if (!row) throw new NotFoundException('找不到這份作業');
    return row;
  }
}

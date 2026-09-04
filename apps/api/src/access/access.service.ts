import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { CourseRole } from '@ws/shared';
import { DB } from '../db/db.module';
import type { Db } from '../db/client';
import { assignments, enrollments, submissions } from '../db/schema';
import type { AuthUser } from '../common/current-user.decorator';

/**
 * 全系統的權限判斷都走這裡，且一律以 enrollments 為準。
 * 只檢查 users.role === 'teacher' 是這類系統最常見的漏洞：
 * 那會讓 A 老師看得到 B 老師班上的作業。
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 取得使用者在該課程的角色；admin 視同該課教師 */
  async courseRoleOf(user: AuthUser, courseId: number): Promise<CourseRole | null> {
    if (user.role === 'admin') return 'teacher';
    const [row] = await this.db
      .select({ role: enrollments.role })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, user.id)))
      .limit(1);
    return row?.role ?? null;
  }

  async assertCourseMember(user: AuthUser, courseId: number): Promise<CourseRole> {
    const role = await this.courseRoleOf(user, courseId);
    if (!role) throw new ForbiddenException('你沒有這門課程的權限');
    return role;
  }

  /** 教師或助教才能做的事（出題、看全班、評分） */
  async assertCourseStaff(user: AuthUser, courseId: number): Promise<CourseRole> {
    const role = await this.assertCourseMember(user, courseId);
    if (role === 'student') throw new ForbiddenException('只有授課教師或助教可以執行此操作');
    return role;
  }

  /** 載入作業並確認呼叫者看得到它（未發布的作業學生看不到） */
  async loadAssignmentForUser(user: AuthUser, assignmentId: number) {
    const [assignment] = await this.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    if (!assignment) throw new NotFoundException('找不到這份作業');

    const role = await this.assertCourseMember(user, assignment.courseId);
    if (role === 'student' && !assignment.publishedAt) {
      throw new NotFoundException('找不到這份作業');
    }
    return { assignment, role };
  }

  /** 載入繳交紀錄並確認呼叫者有權查看：本人，或該課教師/助教 */
  async loadSubmissionForUser(user: AuthUser, submissionId: number) {
    const [submission] = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!submission) throw new NotFoundException('找不到這筆繳交紀錄');

    const [assignment] = await this.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, submission.assignmentId))
      .limit(1);
    if (!assignment) throw new NotFoundException('找不到這份作業');

    const role = await this.assertCourseMember(user, assignment.courseId);
    const isOwner = submission.studentId === user.id;
    if (role === 'student' && !isOwner) {
      throw new NotFoundException('找不到這筆繳交紀錄'); // 不洩漏他人資料是否存在
    }
    return { submission, assignment, role, isOwner };
  }
}

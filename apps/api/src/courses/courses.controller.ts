import { Controller, Get, Inject, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { CourseDto } from '@ws/shared';
import { DB } from '../db/db.module';
import type { Db } from '../db/client';
import { courses, enrollments, users } from '../db/schema';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessService } from '../access/access.service';

@Controller('api/courses')
export class CoursesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
  ) {}

  /** 我的課程（依 enrollments，不是依全域角色） */
  @Get()
  async myCourses(@CurrentUser() user: AuthUser): Promise<CourseDto[]> {
    if (user.role === 'admin') {
      const rows = await this.db.select().from(courses).orderBy(courses.term, courses.code);
      return rows.map((c) => ({ id: c.id, code: c.code, title: c.title, term: c.term, myRole: 'teacher' }));
    }

    const rows = await this.db
      .select({
        id: courses.id,
        code: courses.code,
        title: courses.title,
        term: courses.term,
        myRole: enrollments.role,
      })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(eq(enrollments.userId, user.id))
      .orderBy(courses.term, courses.code);

    return rows;
  }

  @Get(':id')
  async one(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CourseDto> {
    const myRole = await this.access.assertCourseMember(user, id);
    const [row] = await this.db.select().from(courses).where(eq(courses.id, id)).limit(1);
    if (!row) throw new NotFoundException('找不到這門課程');
    return { id: row.id, code: row.code, title: row.title, term: row.term, myRole };
  }

  /** 課程成員（教師端用；學生看不到全班名單） */
  @Get(':id/enrollments')
  async members(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.assertCourseStaff(user, id);
    return this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        studentNo: users.studentNo,
        role: enrollments.role,
      })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(and(eq(enrollments.courseId, id)))
      .orderBy(users.studentNo);
  }
}

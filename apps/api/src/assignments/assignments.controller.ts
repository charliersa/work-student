import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import {
  createAssignmentSchema,
  updateAssignmentSchema,
  type CreateAssignmentInput,
  type UpdateAssignmentInput,
} from '@ws/shared';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AssignmentsService } from './assignments.service';

@Controller('api')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  /* ---------- 共用 ---------- */

  @Get('courses/:courseId/assignments')
  list(@CurrentUser() user: AuthUser, @Param('courseId', ParseIntPipe) courseId: number) {
    return this.service.listForCourse(user, courseId);
  }

  @Get('assignments/:id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.getOne(user, id);
  }

  /* ---------- 教師端 ---------- */

  @Post('courses/:courseId/assignments')
  create(
    @CurrentUser() user: AuthUser,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body(new ZodPipe(createAssignmentSchema)) body: CreateAssignmentInput,
  ) {
    return this.service.create(user, courseId, body);
  }

  @Patch('assignments/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(updateAssignmentSchema)) body: UpdateAssignmentInput,
  ) {
    return this.service.update(user, id, body);
  }

  @Post('assignments/:id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.publish(user, id);
  }

  @Get('assignments/:id/submissions')
  submissions(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.listSubmissions(user, id);
  }
}

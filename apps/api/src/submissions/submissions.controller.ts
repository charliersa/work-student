import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  confirmFileSchema,
  presignSchema,
  updateSubmissionSchema,
  type ConfirmFileInput,
  type PresignInput,
} from '@ws/shared';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { SubmissionsService } from './submissions.service';

@Controller('api')
export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}

  /* ---------- 學生：草稿 ---------- */

  @Post('assignments/:id/submissions')
  createDraft(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.getOrCreateDraft(user, id);
  }

  @Patch('submissions/:id')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(updateSubmissionSchema)) body: { textContent?: string | null },
  ) {
    return this.service.updateDraft(user, id, body.textContent ?? null);
  }

  /* ---------- 學生：檔案 ---------- */

  @Post('uploads/presign')
  presign(@CurrentUser() user: AuthUser, @Body(new ZodPipe(presignSchema)) body: PresignInput) {
    return this.service.presign(user, body);
  }

  @Post('submissions/:id/files')
  confirmFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(confirmFileSchema)) body: ConfirmFileInput,
  ) {
    return this.service.confirmFile(user, id, body);
  }

  @Delete('submissions/:id/files/:fileId')
  removeFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ) {
    return this.service.removeFile(user, id, fileId);
  }

  /* ---------- 學生：送出 ---------- */

  @Post('submissions/:id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.submit(user, id);
  }

  /* ---------- 查詢 ---------- */

  @Get('submissions/mine')
  mine(@CurrentUser() user: AuthUser, @Query('assignmentId', ParseIntPipe) assignmentId: number) {
    return this.service.mine(user, assignmentId);
  }

  @Get('submissions/:id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.one(user, id);
  }

  /** 教師與本人皆可，權限在 service 內以 enrollments 判定 */
  @Get('files/:id/download-url')
  downloadUrl(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.downloadUrl(user, id);
  }
}

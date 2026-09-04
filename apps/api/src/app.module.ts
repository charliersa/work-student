import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { AccessModule } from './access/access.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt.guard';
import { CoursesController } from './courses/courses.controller';
import { AssignmentsController } from './assignments/assignments.controller';
import { AssignmentsService } from './assignments/assignments.service';
import { SubmissionsController } from './submissions/submissions.controller';
import { SubmissionsService } from './submissions/submissions.service';
import { HealthController } from './health.controller';

@Module({
  imports: [DbModule, AccessModule, StorageModule, AuthModule],
  controllers: [
    HealthController,
    CoursesController,
    AssignmentsController,
    SubmissionsController,
  ],
  providers: [
    AssignmentsService,
    SubmissionsService,
    // 預設全站需要登入；例外用 @Public() 明確標記
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

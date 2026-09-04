import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, max } from 'drizzle-orm';
import { computeLate, type ConfirmFileInput, type PresignInput, type SubmissionDto } from '@ws/shared';
import { DB } from '../db/db.module';
import type { Db } from '../db/client';
import { auditLogs, extensions, submissionFiles, submissions, users } from '../db/schema';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../common/current-user.decorator';
import { toSubmissionDto } from '../common/mappers';
import { buildStorageKey, StorageDriver, type UploadTicket } from '../storage/storage.service';
import { verifyToken, type UploadClaims } from '../auth/tokens';
import { guardAfterUpload, guardBeforeUpload } from './file-guard';

@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StorageDriver) private readonly storage: StorageDriver,
    private readonly access: AccessService,
  ) {}

  /* ------------------------------------------------------------------ *
   * 草稿
   * ------------------------------------------------------------------ */

  /** 取得或建立本次的草稿（同一份作業每位學生只會有一份草稿，由部分唯一索引保證） */
  async getOrCreateDraft(user: AuthUser, assignmentId: number): Promise<SubmissionDto> {
    const { assignment, role } = await this.access.loadAssignmentForUser(user, assignmentId);
    if (role !== 'student') throw new ForbiddenException('教師端不需要繳交作業');

    const [existingDraft] = await this.db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.assignmentId, assignmentId),
          eq(submissions.studentId, user.id),
          eq(submissions.status, 'draft'),
        ),
      )
      .limit(1);
    if (existingDraft) return this.withFiles(existingDraft);

    const [{ maxAttempt }] = await this.db
      .select({ maxAttempt: max(submissions.attemptNo) })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, user.id)));

    const used = Number(maxAttempt ?? 0);
    if (used >= assignment.maxAttempts) {
      throw new ConflictException(`此作業最多只能繳交 ${assignment.maxAttempts} 次`);
    }

    try {
      const [row] = await this.db
        .insert(submissions)
        .values({ assignmentId, studentId: user.id, attemptNo: used + 1, status: 'draft' })
        .returning();
      return this.withFiles(row);
    } catch (err: any) {
      // 使用者連點兩下：唯一索引擋下，改回讀既有草稿
      if (String(err?.code) === '23505') {
        const [row] = await this.db
          .select()
          .from(submissions)
          .where(
            and(
              eq(submissions.assignmentId, assignmentId),
              eq(submissions.studentId, user.id),
              eq(submissions.status, 'draft'),
            ),
          )
          .limit(1);
        if (row) return this.withFiles(row);
      }
      throw err;
    }
  }

  async updateDraft(user: AuthUser, submissionId: number, textContent: string | null): Promise<SubmissionDto> {
    const { submission, isOwner } = await this.access.loadSubmissionForUser(user, submissionId);
    if (!isOwner) throw new ForbiddenException('只能修改自己的繳交內容');
    if (submission.status !== 'draft') throw new ConflictException('已送出的作業不能修改');

    const [row] = await this.db
      .update(submissions)
      .set({ textContent })
      .where(eq(submissions.id, submissionId))
      .returning();
    return this.withFiles(row);
  }

  /* ------------------------------------------------------------------ *
   * 檔案
   * ------------------------------------------------------------------ */

  /** 步驟一：換取直傳網址（後端在此就先擋掉不合法的檔案） */
  async presign(user: AuthUser, input: PresignInput): Promise<UploadTicket> {
    const { submission, assignment, isOwner } = await this.access.loadSubmissionForUser(
      user,
      input.submissionId,
    );
    if (!isOwner) throw new ForbiddenException('只能上傳到自己的繳交紀錄');
    if (submission.status !== 'draft') throw new ConflictException('已送出的作業不能再上傳檔案');

    const [{ n }] = await this.db
      .select({ n: count() })
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, submission.id));
    if (Number(n) >= assignment.maxFiles) {
      throw new BadRequestException(`最多只能上傳 ${assignment.maxFiles} 個檔案`);
    }

    const { ext, mimeType } = guardBeforeUpload(
      input.filename,
      input.size,
      assignment.allowedExt,
      Number(assignment.maxFileBytes),
    );

    const storageKey = buildStorageKey({
      courseId: assignment.courseId,
      assignmentId: assignment.id,
      studentId: user.id,
      attemptNo: submission.attemptNo,
      ext,
    });

    return this.storage.createUploadTicket({
      storageKey,
      submissionId: submission.id,
      userId: user.id,
      maxSize: Number(assignment.maxFileBytes),
      originalName: input.filename,
      mimeType,
    });
  }

  /** 步驟二：確認上傳完成 — 這裡才是真正的驗證關卡 */
  async confirmFile(user: AuthUser, submissionId: number, input: ConfirmFileInput): Promise<SubmissionDto> {
    const { submission, assignment, isOwner } = await this.access.loadSubmissionForUser(user, submissionId);
    if (!isOwner) throw new ForbiddenException('只能上傳到自己的繳交紀錄');
    if (submission.status !== 'draft') throw new ConflictException('已送出的作業不能再上傳檔案');

    // uploadToken 由伺服器簽發，綁定 key ↔ submission ↔ 使用者，
    // 沒有它就無法把任意 storage key 掛到自己的繳交紀錄上。
    let claims: UploadClaims;
    try {
      claims = await verifyToken<UploadClaims>(input.uploadToken, 'upload');
    } catch {
      throw new BadRequestException('上傳憑證已過期，請重新上傳');
    }
    if (claims.key !== input.storageKey || claims.submissionId !== submissionId || claims.uid !== user.id) {
      throw new ForbiddenException('上傳憑證與請求不符');
    }

    const info = await this.storage.inspect(input.storageKey);
    if (!info) throw new BadRequestException('找不到已上傳的檔案，請重新上傳');

    // 不信任前端宣告的大小與型別，一律以實際物件為準
    if (info.size > Number(assignment.maxFileBytes)) {
      await this.storage.remove(input.storageKey);
      throw new BadRequestException('檔案超過允許大小');
    }

    const ext = claims.originalName.split('.').pop()!.toLowerCase();
    let mimeType: string;
    try {
      mimeType = await guardAfterUpload(ext, info.headBytes);
    } catch (err) {
      await this.storage.remove(input.storageKey); // 驗不過就不留在儲存空間
      throw err;
    }

    await this.db.insert(submissionFiles).values({
      submissionId,
      storageKey: input.storageKey,
      originalName: claims.originalName,
      mimeType,
      sizeBytes: info.size,
      sha256: info.sha256,
      // M1 尚未接防毒 worker，通過格式檢查即視為 clean；
      // M3 會改成 'pending' 並由 ClamAV worker 更新（見 README 藍圖）。
      scan: 'clean',
    });

    await this.audit(user, 'file.upload', 'submission', submissionId, {
      sha256: info.sha256,
      size: info.size,
    });

    const [row] = await this.db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
    return this.withFiles(row);
  }

  async removeFile(user: AuthUser, submissionId: number, fileId: number): Promise<SubmissionDto> {
    const { submission, isOwner } = await this.access.loadSubmissionForUser(user, submissionId);
    if (!isOwner) throw new ForbiddenException('只能刪除自己的檔案');
    if (submission.status !== 'draft') throw new ConflictException('已送出的作業不能刪除檔案');

    const [file] = await this.db
      .select()
      .from(submissionFiles)
      .where(and(eq(submissionFiles.id, fileId), eq(submissionFiles.submissionId, submissionId)))
      .limit(1);
    if (!file) throw new NotFoundException('找不到這個檔案');

    await this.db.delete(submissionFiles).where(eq(submissionFiles.id, fileId));
    await this.storage.remove(file.storageKey);
    return this.withFiles(submission);
  }

  /** 產生短效下載連結；每一次都重新檢查權限 */
  async downloadUrl(user: AuthUser, fileId: number): Promise<{ url: string; expiresIn: number }> {
    const [file] = await this.db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.id, fileId))
      .limit(1);
    if (!file) throw new NotFoundException('找不到這個檔案');

    // 這一行就是防 IDOR 的關鍵：不是本人也不是該課教師就拿不到連結
    await this.access.loadSubmissionForUser(user, file.submissionId);

    if (file.scan === 'infected') throw new ForbiddenException('這個檔案被判定為惡意檔案，已封鎖');
    if (file.scan === 'pending') throw new ConflictException('檔案掃描中，請稍後再試');

    await this.audit(user, 'file.download', 'submission_file', file.id, {});
    const url = await this.storage.createDownloadUrl({
      storageKey: file.storageKey,
      filename: file.originalName,
      mimeType: file.mimeType,
    });
    return { url, expiresIn: 300 };
  }

  /* ------------------------------------------------------------------ *
   * 送出
   * ------------------------------------------------------------------ */

  async submit(user: AuthUser, submissionId: number): Promise<SubmissionDto> {
    const { submission, assignment, isOwner } = await this.access.loadSubmissionForUser(user, submissionId);
    if (!isOwner) throw new ForbiddenException('只能送出自己的作業');
    if (submission.status !== 'draft') throw new ConflictException('這份作業已經送出了');

    const files = await this.db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, submissionId));
    if (files.length === 0 && !submission.textContent?.trim()) {
      throw new BadRequestException('請至少上傳一個檔案或填寫作答內容');
    }

    // 個別延期優先；有延期就以新的截止時間為準，不再另外給補交緩衝
    const [ext] = await this.db
      .select()
      .from(extensions)
      .where(and(eq(extensions.assignmentId, assignment.id), eq(extensions.studentId, user.id)))
      .limit(1);

    const now = new Date();
    const dueAt = ext?.newDueAt ?? assignment.dueAt;
    const lateUntil = ext ? null : assignment.lateUntil;
    const { isLate, rejected } = computeLate(now, dueAt, lateUntil);

    if (rejected) {
      throw new ForbiddenException(
        lateUntil ? '已超過補交截止時間，無法繳交' : '已超過截止時間，此作業不接受遲交',
      );
    }

    const [row] = await this.db
      .update(submissions)
      .set({ status: 'submitted', submittedAt: now, isLate })
      .where(and(eq(submissions.id, submissionId), eq(submissions.status, 'draft')))
      .returning();
    if (!row) throw new ConflictException('這份作業已經送出了');

    await this.audit(user, 'submission.submit', 'submission', submissionId, {
      isLate,
      attemptNo: row.attemptNo,
      fileCount: files.length,
      // 把判定當下的時間寫進稽核紀錄，日後有爭議時這就是唯一依據
      serverTime: now.toISOString(),
      dueAt: dueAt.toISOString(),
    });

    return this.withFiles(row);
  }

  /* ------------------------------------------------------------------ *
   * 查詢
   * ------------------------------------------------------------------ */

  async mine(user: AuthUser, assignmentId: number): Promise<SubmissionDto[]> {
    await this.access.loadAssignmentForUser(user, assignmentId);
    const rows = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, user.id)))
      .orderBy(desc(submissions.attemptNo));
    return Promise.all(rows.map((r) => this.withFiles(r)));
  }

  async one(user: AuthUser, submissionId: number): Promise<SubmissionDto> {
    const { submission } = await this.access.loadSubmissionForUser(user, submissionId);
    const [student] = await this.db
      .select({ name: users.name, studentNo: users.studentNo })
      .from(users)
      .where(eq(users.id, submission.studentId))
      .limit(1);
    return this.withFiles(submission, student);
  }

  /* ---------------- 內部工具 ---------------- */

  private async withFiles(
    submission: typeof submissions.$inferSelect,
    student?: { name: string; studentNo: string | null },
  ): Promise<SubmissionDto> {
    const files = await this.db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, submission.id))
      .orderBy(submissionFiles.uploadedAt);
    return toSubmissionDto(submission, files, student);
  }

  private async audit(
    user: AuthUser,
    action: string,
    entityType: string,
    entityId: number,
    meta: Record<string, unknown>,
  ) {
    await this.db.insert(auditLogs).values({
      actorId: user.id,
      action,
      entityType,
      entityId,
      meta,
    });
  }
}

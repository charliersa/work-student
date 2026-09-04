import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { env } from '../config/env';
import { signToken, type DownloadClaims, type UploadClaims } from '../auth/tokens';

export interface UploadTicket {
  /** 前端直接 PUT 檔案位元組到這個網址（不經過 API 伺服器記憶體） */
  uploadUrl: string;
  method: 'PUT';
  storageKey: string;
  /** 綁定 key ↔ submission 的簽章，確認上傳時必須帶回來 */
  uploadToken: string;
  expiresIn: number;
}

export interface ObjectInspection {
  size: number;
  sha256: string;
  /** 前 4100 bytes，用來做 magic bytes 檢查 */
  headBytes: Buffer;
}

/** 只允許我們自己產生的 key 格式，杜絕 path traversal */
const KEY_RE = /^courses\/\d+\/assignments\/\d+\/\d+\/\d+\/[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/;

export function buildStorageKey(params: {
  courseId: number;
  assignmentId: number;
  studentId: number;
  attemptNo: number;
  ext: string;
}): string {
  const ext = params.ext ? `.${params.ext.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  // 原始檔名永遠不進入路徑，只存在 DB 的 original_name 欄位
  return `courses/${params.courseId}/assignments/${params.assignmentId}/${params.studentId}/${params.attemptNo}/${randomUUID()}${ext}`;
}

export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key)) throw new InternalServerErrorException('storage key 格式不合法');
}

export abstract class StorageDriver {
  abstract createUploadTicket(input: {
    storageKey: string;
    submissionId: number;
    userId: number;
    maxSize: number;
    originalName: string;
    mimeType: string;
  }): Promise<UploadTicket>;

  abstract createDownloadUrl(input: {
    storageKey: string;
    filename: string;
    mimeType: string;
  }): Promise<string>;

  abstract inspect(storageKey: string): Promise<ObjectInspection | null>;
  abstract remove(storageKey: string): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * 本機磁碟驅動（開發用）
 * 以簽章 token 模擬 S3 presigned URL，流程與正式環境完全一致，
 * 之後把 STORAGE_DRIVER 換成 s3 即可，上層程式碼一行都不用改。
 * ------------------------------------------------------------------ */
/**
 * 本機儲存驅動簽發網址時用的前綴。
 * 沒有明確設定 API_PUBLIC_URL 就回傳空字串，也就是簽發「相對路徑」——
 * 前端由 API 同源托管，相對路徑在 localhost、192.168.x.x、自訂網域下都成立，
 * 不必為了換一個網址就去改設定。
 */
function localUrlBase(): string {
  return env.apiPublicUrlExplicit ? env.apiPublicUrl : '';
}

@Injectable()
export class LocalDiskStorage extends StorageDriver {
  private readonly root = path.resolve(process.cwd(), env.localStorageDir);

  private abs(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async createUploadTicket(input: {
    storageKey: string;
    submissionId: number;
    userId: number;
    maxSize: number;
    originalName: string;
  }): Promise<UploadTicket> {
    const claims: UploadClaims = {
      typ: 'upload',
      key: input.storageKey,
      submissionId: input.submissionId,
      uid: input.userId,
      maxSize: input.maxSize,
      originalName: input.originalName,
    };
    const token = await signToken(claims, env.uploadUrlTtl);
    return {
      uploadUrl: `${localUrlBase()}/api/storage/upload?token=${encodeURIComponent(token)}`,
      method: 'PUT',
      storageKey: input.storageKey,
      uploadToken: token,
      expiresIn: env.uploadUrlTtl,
    };
  }

  async createDownloadUrl(input: {
    storageKey: string;
    filename: string;
    mimeType: string;
  }): Promise<string> {
    const claims: DownloadClaims = {
      typ: 'download',
      key: input.storageKey,
      filename: input.filename,
      mimeType: input.mimeType,
    };
    const token = await signToken(claims, env.downloadUrlTtl);
    return `${localUrlBase()}/api/storage/download?token=${encodeURIComponent(token)}`;
  }

  /** 由 storage.controller 的 PUT 端點呼叫 */
  async writeStream(key: string, stream: Readable, maxSize: number): Promise<number> {
    const target = this.abs(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let written = 0;
    const out = fs.createWriteStream(target);
    try {
      for await (const chunk of stream) {
        written += chunk.length;
        if (written > maxSize) {
          out.destroy();
          await fsp.rm(target, { force: true });
          throw new Error('檔案超過允許大小');
        }
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error) => (e ? reject(e) : resolve())));
      return written;
    } catch (err) {
      out.destroy();
      await fsp.rm(target, { force: true });
      throw err;
    }
  }

  readStream(key: string): Readable {
    return fs.createReadStream(this.abs(key));
  }

  async inspect(key: string): Promise<ObjectInspection | null> {
    const target = this.abs(key);
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(target);
    } catch {
      return null;
    }
    const { sha256, headBytes } = await hashStream(fs.createReadStream(target));
    return { size: stat.size, sha256, headBytes };
  }

  async remove(key: string): Promise<void> {
    await fsp.rm(this.abs(key), { force: true });
  }
}

/* ------------------------------------------------------------------ *
 * S3 / R2 / MinIO 驅動（正式環境）
 * ------------------------------------------------------------------ */
@Injectable()
export class S3Storage extends StorageDriver {
  private client: any;

  private async getClient() {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({
        region: env.s3.region,
        endpoint: env.s3.endpoint || undefined,
        forcePathStyle: !!env.s3.endpoint, // MinIO 需要
        credentials: {
          accessKeyId: env.s3.accessKeyId,
          secretAccessKey: env.s3.secretAccessKey,
        },
      });
    }
    return this.client;
  }

  async createUploadTicket(input: {
    storageKey: string;
    submissionId: number;
    userId: number;
    maxSize: number;
    originalName: string;
    mimeType: string;
  }): Promise<UploadTicket> {
    assertSafeKey(input.storageKey);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    // 刻意不簽 ContentType：前端一律以 application/octet-stream 上傳，
    // 真正的 MIME 由伺服器讀 magic bytes 判定，並在下載時才指定。
    const cmd = new PutObjectCommand({ Bucket: env.s3.bucket, Key: input.storageKey });
    const uploadUrl = await getSignedUrl(await this.getClient(), cmd, { expiresIn: env.uploadUrlTtl });
    const uploadToken = await signToken(
      {
        typ: 'upload',
        key: input.storageKey,
        submissionId: input.submissionId,
        uid: input.userId,
        maxSize: input.maxSize,
        originalName: input.originalName,
      } satisfies UploadClaims,
      env.uploadUrlTtl,
    );
    return { uploadUrl, method: 'PUT', storageKey: input.storageKey, uploadToken, expiresIn: env.uploadUrlTtl };
  }

  async createDownloadUrl(input: {
    storageKey: string;
    filename: string;
    mimeType: string;
  }): Promise<string> {
    assertSafeKey(input.storageKey);
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const cmd = new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: input.storageKey,
      // 一律強制下載，避免瀏覽器把學生上傳的內容當成 HTML 執行
      ResponseContentDisposition: contentDisposition(input.filename),
      ResponseContentType: input.mimeType || 'application/octet-stream',
    });
    return getSignedUrl(await this.getClient(), cmd, { expiresIn: env.downloadUrlTtl });
  }

  async inspect(key: string): Promise<ObjectInspection | null> {
    assertSafeKey(key);
    const { GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    let size: number;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }));
      size = Number(head.ContentLength ?? 0);
    } catch {
      return null;
    }
    const obj = await client.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    const { sha256, headBytes } = await hashStream(obj.Body as Readable);
    return { size, sha256, headBytes };
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
  }
}

/* ------------------------------------------------------------------ *
 * 共用工具
 * ------------------------------------------------------------------ */
async function hashStream(stream: Readable): Promise<{ sha256: string; headBytes: Buffer }> {
  const hash = createHash('sha256');
  const head: Buffer[] = [];
  let headLen = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buf);
    if (headLen < 4100) {
      head.push(buf.subarray(0, 4100 - headLen));
      headLen += Math.min(buf.length, 4100 - headLen);
    }
  }
  return { sha256: hash.digest('hex'), headBytes: Buffer.concat(head) };
}

/** RFC 5987 檔名編碼，中文檔名才不會亂碼 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { verifyToken, type DownloadClaims, type UploadClaims } from '../auth/tokens';
import { env } from '../config/env';
import { contentDisposition, LocalDiskStorage, StorageDriver } from './storage.service';

/**
 * 只在 STORAGE_DRIVER=local 時實際運作，用來模擬 S3 的 presigned PUT / GET。
 * 兩個端點都是 @Public，但必須帶有伺服器簽發的短效 token 才進得來。
 */
@Controller('api/storage')
export class StorageController {
  constructor(@Inject(StorageDriver) private readonly storage: StorageDriver) {}

  private localOrThrow(): LocalDiskStorage {
    if (!(this.storage instanceof LocalDiskStorage)) {
      throw new NotFoundException('目前使用外部物件儲存，請改用簽發的 presigned URL');
    }
    return this.storage;
  }

  @Public()
  @Put('upload')
  async upload(@Query('token') token: string, @Req() req: Request, @Res() res: Response) {
    const local = this.localOrThrow();
    if (!token) throw new BadRequestException('缺少 token');

    let claims: UploadClaims;
    try {
      claims = await verifyToken<UploadClaims>(token, 'upload');
    } catch {
      throw new BadRequestException('上傳連結已過期，請重新選擇檔案');
    }

    const size = await local.writeStream(claims.key, req, claims.maxSize);
    res.status(200).json({ ok: true, size });
  }

  @Public()
  @Get('download')
  async download(@Query('token') token: string, @Res() res: Response) {
    const local = this.localOrThrow();
    if (!token) throw new BadRequestException('缺少 token');

    let claims: DownloadClaims;
    try {
      claims = await verifyToken<DownloadClaims>(token, 'download');
    } catch {
      throw new BadRequestException('下載連結已過期，請重新整理頁面');
    }

    // 一律強制下載 + 禁止 MIME 嗅探：學生上傳的 HTML 永遠不會在瀏覽器中被執行
    res.setHeader('Content-Type', claims.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(claims.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');

    local.readStream(claims.key).on('error', () => res.status(404).end()).pipe(res);
  }

  @Public()
  @Get('driver')
  driver() {
    return { driver: env.storageDriver };
  }
}

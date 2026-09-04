import { BadRequestException } from '@nestjs/common';
import { extOf } from '@ws/shared';

/**
 * 「白名單副檔名」+「magic bytes 必須相符」的雙重檢查。
 * 只看副檔名等於沒檢查：把 shell.php 改名成 report.pdf 是最基本的攻擊。
 */

/** 宣告的副檔名 → 可接受的實際偵測結果 */
const COMPATIBLE: Record<string, string[]> = {
  pdf: ['pdf'],
  zip: ['zip', 'docx', 'pptx', 'xlsx'], // OOXML 本質上就是 zip
  docx: ['docx', 'zip'],
  pptx: ['pptx', 'zip'],
  xlsx: ['xlsx', 'zip'],
  png: ['png'],
  jpg: ['jpg'],
  jpeg: ['jpg'],
  gif: ['gif'],
  mp4: ['mp4'],
};

/** 沒有 magic bytes 的純文字格式，只能靠副檔名 + 內容不可執行來把關 */
const TEXT_LIKE = new Set(['txt', 'md', 'csv', 'c', 'cpp', 'py', 'java', 'js', 'ts', 'html', 'css', 'json']);

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
};

export interface GuardResult {
  ext: string;
  mimeType: string;
}

/** 上傳前檢查（只看得到檔名與大小） */
export function guardBeforeUpload(
  filename: string,
  size: number,
  allowedExt: readonly string[],
  maxFileBytes: number,
): GuardResult {
  const ext = extOf(filename);
  if (!ext) throw new BadRequestException('檔案必須有副檔名');
  if (!allowedExt.map((e) => e.toLowerCase()).includes(ext)) {
    throw new BadRequestException(`不接受 .${ext} 檔案，允許的格式：${allowedExt.join('、')}`);
  }
  if (size > maxFileBytes) {
    throw new BadRequestException(`檔案超過上限 ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB`);
  }
  if (size <= 0) throw new BadRequestException('檔案是空的');
  return { ext, mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
}

/** 上傳後檢查：實際位元組是否與宣告的格式相符 */
export async function guardAfterUpload(ext: string, headBytes: Buffer): Promise<string> {
  // file-type v16 是 CommonJS，可直接 require
  const FileType = await import('file-type');
  const detected = await FileType.fromBuffer(headBytes);

  if (!detected) {
    if (TEXT_LIKE.has(ext)) return MIME_BY_EXT[ext] ?? 'text/plain';
    throw new BadRequestException('無法辨識檔案內容，可能檔案已損毀或副檔名被竄改');
  }

  const allowed = COMPATIBLE[ext] ?? [ext];
  if (!allowed.includes(detected.ext)) {
    throw new BadRequestException(
      `檔案內容與副檔名不符（宣告 .${ext}，實際為 .${detected.ext}），已拒絕上傳`,
    );
  }
  return MIME_BY_EXT[ext] ?? detected.mime;
}

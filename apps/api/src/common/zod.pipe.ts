import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * 用 @ws/shared 的 zod schema 驗證請求內容。
 * 前端用同一份 schema 先擋一次，後端這裡是不可略過的第二道。
 */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: '輸入內容有誤',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}

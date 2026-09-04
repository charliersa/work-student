import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'ws:isPublic';

/** 標記不需登入的端點（登入、健康檢查、帶簽章 token 的檔案傳輸） */
export const Public = () => SetMetadata(IS_PUBLIC, true);

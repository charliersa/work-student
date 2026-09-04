const TZ = 'Asia/Taipei';

/** 後端一律回 UTC ISO 字串，顯示時才轉台北時間 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function relativeToNow(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const day = 86_400_000;
  const hour = 3_600_000;

  if (abs >= day) {
    const d = Math.floor(abs / day);
    return diffMs > 0 ? `還有 ${d} 天` : `已過期 ${d} 天`;
  }
  if (abs >= hour) {
    const h = Math.floor(abs / hour);
    return diffMs > 0 ? `還有 ${h} 小時` : `已過期 ${h} 小時`;
  }
  const m = Math.max(1, Math.floor(abs / 60_000));
  return diffMs > 0 ? `還有 ${m} 分鐘` : `已過期 ${m} 分鐘`;
}

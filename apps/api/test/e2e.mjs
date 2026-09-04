/**
 * 端對端煙霧測試：對「已經在跑」的 API 打真實 HTTP 請求，跑完整條主流程
 *   老師出題 → 發布 → 學生上傳 → 送出 → 老師檢視 → 下載
 * 並涵蓋權限、檔案驗證、遲交判定的負面測試。
 *
 * 用法：
 *   npm run dev            # 另一個終端機先把 API 跑起來
 *   npm run test:e2e       # 預設打 http://localhost:3000
 *   BASE=http://localhost:3100 npm run test:e2e
 *
 * 注意：測試會真的建立作業與繳交紀錄。想從乾淨狀態跑就先 `npm run db:reset`
 * （重設後要重啟 API，否則伺服器仍握著舊的資料庫檔案）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 跟 API 一樣從 repo 根目錄的 .env 讀 PORT，這樣改了 port 測試不會打到舊的位址 */
function portFromEnvFile() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
  try {
    const m = fs.readFileSync(envPath, 'utf8').match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (m) return m[1];
  } catch {
    /* 沒有 .env 就用預設 */
  }
  return null;
}

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || portFromEnvFile() || 3000}`;
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}  ${extra}`); }
}

class Session {
  constructor(label) { this.label = label; this.cookies = {}; }
  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const jar = this.cookieHeader();
    if (jar) headers.cookie = jar;
    let payload = body;
    if (body !== undefined && !(body instanceof Uint8Array)) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
      method, headers, body: payload, redirect: 'manual',
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('json')) data = await res.json().catch(() => null);
    else data = await res.arrayBuffer().then((b) => Buffer.from(b)).catch(() => null);
    return { status: res.status, data, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b, o); }
  patch(p, b, o) { return this.req('PATCH', p, b, o); }
  del(p, o) { return this.req('DELETE', p, undefined, o); }
  async login(account, password) {
    const r = await this.post('/api/auth/login', { account, password });
    if (r.status !== 200 && r.status !== 201) throw new Error(`${this.label} 登入失敗 ${r.status} ${JSON.stringify(r.data)}`);
    this.me = r.data;
    return r.data;
  }
}

// 真實 PDF 位元組（magic bytes = %PDF-）
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

// 真實 PNG 位元組；稍後會故意取名 .pdf 來測 magic bytes 檢查
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000a49444154789c6300010000050001', 'hex');

/** 本機儲存驅動簽發的是相對路徑，補上 BASE 才能用 Node 的 fetch 打 */
function absolute(url) {
  return url.startsWith('http') ? url : BASE + url;
}

async function uploadTo(ticket, bytes) {
  return fetch(absolute(ticket.uploadUrl), { method: 'PUT', body: bytes });
}

const log = [];
try {
  /* ---------- 0. health ---------- */
  const anon = new Session('anon');
  const h = await anon.get('/api/health');
  ok('健康檢查 /api/health', h.status === 200 && h.data?.ok === true, JSON.stringify(h.data));

  /* ---------- 1. 認證 ---------- */
  const bad = await anon.post('/api/auth/login', { account: 'teacher@example.edu.tw', password: 'wrong-password' });
  ok('錯誤密碼被拒 (401)', bad.status === 401, `got ${bad.status}`);
  const noauth = await anon.get('/api/courses');
  ok('未登入存取受保護端點被拒 (401)', noauth.status === 401, `got ${noauth.status}`);

  const teacher = new Session('teacher');
  await teacher.login('teacher@example.edu.tw', 'Passw0rd!');
  ok('教師登入 (email)', teacher.me.role === 'teacher', JSON.stringify(teacher.me));

  const stu = new Session('student1');
  await stu.login('1130101', 'Passw0rd!');
  ok('學生登入 (學號登入)', stu.me.role === 'student' && stu.me.studentNo === '1130101', JSON.stringify(stu.me));

  const stu2 = new Session('student2');
  await stu2.login('s1130102@example.edu.tw', 'Passw0rd!');
  ok('第二位學生登入 (email)', stu2.me.id !== stu.me.id);

  const meR = await stu.get('/api/me');
  ok('GET /api/me 回傳自己', meR.status === 200 && meR.data.id === stu.me.id);

  /* ---------- 2. 課程 ---------- */
  const tCourses = await teacher.get('/api/courses');
  ok('教師看得到自己教的課', tCourses.status === 200 && tCourses.data.length > 0, JSON.stringify(tCourses.data));
  const course = tCourses.data[0];
  log.push(`課程：#${course.id} ${course.code} ${course.title} (myRole=${course.myRole})`);

  const enr = await teacher.get(`/api/courses/${course.id}/enrollments`);
  ok('教師可讀課程名冊', enr.status === 200 && Array.isArray(enr.data));
  const studentCount = enr.data.filter((e) => e.role === 'student').length;
  log.push(`名冊人數：${enr.data.length}（學生 ${studentCount}）`);

  const stuEnr = await stu.get(`/api/courses/${course.id}/enrollments`);
  ok('學生不可讀課程名冊 (403)', stuEnr.status === 403, `got ${stuEnr.status}`);

  /* ---------- 3. 出題 ---------- */
  const dueAt = new Date(Date.now() + 7 * 864e5).toISOString();
  const lateUntil = new Date(Date.now() + 9 * 864e5).toISOString();
  const created = await teacher.post(`/api/courses/${course.id}/assignments`, {
    title: 'E2E 測試作業：資料庫正規化報告',
    descriptionMd: '請上傳 PDF。',
    dueAt, lateUntil, maxScore: 100, maxAttempts: 3, maxFiles: 3,
    maxFileBytes: 5 * 1024 * 1024, allowedExt: ['pdf', 'png', 'zip'],
  });
  ok('教師建立作業', created.status === 201 || created.status === 200, `${created.status} ${JSON.stringify(created.data)}`);
  const aid = created.data.id;
  ok('新作業預設為未發布', created.data.publishedAt === null, JSON.stringify(created.data.publishedAt));
  log.push(`作業：#${aid} ${created.data.title}`);

  const stuCreate = await stu.post(`/api/courses/${course.id}/assignments`, {
    title: '學生不該能出題', dueAt,
  });
  ok('學生不可建立作業 (403)', stuCreate.status === 403, `got ${stuCreate.status}`);

  const badDates = await teacher.post(`/api/courses/${course.id}/assignments`, {
    title: '補交早於截止', dueAt, lateUntil: new Date(Date.now() + 1000).toISOString(),
  });
  ok('補交截止早於截止時間被擋 (400)', badDates.status === 400, `got ${badDates.status}`);

  /* ---------- 4. 發布前後的可見性 ---------- */
  const beforePub = await stu.get(`/api/courses/${course.id}/assignments`);
  ok('未發布作業學生看不到', !beforePub.data.some((a) => a.id === aid), JSON.stringify(beforePub.data.map((a) => a.id)));
  const beforeOne = await stu.get(`/api/assignments/${aid}`);
  ok('學生直接讀未發布作業被擋', beforeOne.status === 403 || beforeOne.status === 404, `got ${beforeOne.status}`);

  const pub = await teacher.post(`/api/assignments/${aid}/publish`);
  ok('教師發布作業', pub.status === 200 || pub.status === 201, `${pub.status}`);
  ok('publishedAt 已寫入', !!pub.data?.publishedAt, JSON.stringify(pub.data?.publishedAt));

  const afterPub = await stu.get(`/api/courses/${course.id}/assignments`);
  ok('發布後學生看得到', afterPub.data.some((a) => a.id === aid));

  /* ---------- 5. 草稿 ---------- */
  const d1 = await stu.post(`/api/assignments/${aid}/submissions`);
  ok('學生建立草稿', (d1.status === 200 || d1.status === 201) && d1.data.status === 'draft', JSON.stringify(d1.data));
  const sid = d1.data.id;
  const d2 = await stu.post(`/api/assignments/${aid}/submissions`);
  ok('重複建立草稿回同一筆（唯一索引保證）', d2.data.id === sid, `${sid} vs ${d2.data?.id}`);

  const upd = await stu.patch(`/api/submissions/${sid}`, { textContent: '這是我的作答文字。' });
  ok('更新作答文字', upd.status === 200 && upd.data.textContent.includes('作答文字'));

  const otherPatch = await stu2.patch(`/api/submissions/${sid}`, { textContent: '我要改別人的' });
  ok('學生不可改他人繳交 (403/404)', otherPatch.status === 403 || otherPatch.status === 404, `got ${otherPatch.status}`);

  /* ---------- 6. 上傳：正常路徑 ---------- */
  const p1 = await stu.post('/api/uploads/presign', {
    submissionId: sid, filename: '正規化報告.pdf', size: PDF.length, mimeType: 'application/pdf',
  });
  ok('presign 取得直傳網址', p1.status === 200 || p1.status === 201, JSON.stringify(p1.data));
  const ticket = p1.data;
  ok('storage key 不含原始檔名', !ticket.storageKey.includes('正規化'), ticket.storageKey);
  log.push(`storageKey：${ticket.storageKey}`);

  const put = await uploadTo(ticket, PDF);
  ok('直傳 PUT 成功', put.status === 200, `got ${put.status}`);

  const conf = await stu.post(`/api/submissions/${sid}/files`, {
    storageKey: ticket.storageKey, uploadToken: ticket.uploadToken,
  });
  ok('確認上傳寫入檔案紀錄', conf.status === 200 || conf.status === 201, JSON.stringify(conf.data));
  ok('檔案原始檔名保留（中文）', conf.data.files?.[0]?.originalName === '正規化報告.pdf', JSON.stringify(conf.data.files));
  ok('後端自行判定 mimeType', conf.data.files?.[0]?.mimeType === 'application/pdf', JSON.stringify(conf.data.files?.[0]));
  const fileId = conf.data.files[0].id;

  /* ---------- 7. 上傳：負面測試 ---------- */
  const badExt = await stu.post('/api/uploads/presign', {
    submissionId: sid, filename: 'shell.php', size: 100,
  });
  ok('副檔名白名單擋掉 .php (400)', badExt.status === 400, `got ${badExt.status}`);

  const tooBig = await stu.post('/api/uploads/presign', {
    submissionId: sid, filename: 'huge.pdf', size: 10 * 1024 * 1024,
  });
  ok('超過作業檔案大小上限被擋 (400)', tooBig.status === 400, `got ${tooBig.status}`);

  // 偽裝：PNG 位元組取名 .pdf → presign 過得了，confirm 時 magic bytes 必須擋下
  const p2 = await stu.post('/api/uploads/presign', {
    submissionId: sid, filename: 'fake.pdf', size: PNG.length, mimeType: 'application/pdf',
  });
  ok('偽裝檔案可取得 presign（尚未看內容）', p2.status === 200 || p2.status === 201);
  await uploadTo(p2.data, PNG);
  const conf2 = await stu.post(`/api/submissions/${sid}/files`, {
    storageKey: p2.data.storageKey, uploadToken: p2.data.uploadToken,
  });
  ok('magic bytes 不符被擋 (400)', conf2.status === 400, `got ${conf2.status} ${JSON.stringify(conf2.data)}`);

  // 憑證竄改：用合法 token 搭配任意 storage key
  const forged = await stu.post(`/api/submissions/${sid}/files`, {
    storageKey: 'courses/1/assignments/1/1/1/evil.pdf', uploadToken: ticket.uploadToken,
  });
  ok('storageKey 與憑證不符被擋 (403)', forged.status === 403, `got ${forged.status}`);

  /* ---------- 8. 移除檔案 ---------- */
  const p3 = await stu.post('/api/uploads/presign', {
    submissionId: sid, filename: '附件.png', size: PNG.length,
  });
  await uploadTo(p3.data, PNG);
  const conf3 = await stu.post(`/api/submissions/${sid}/files`, {
    storageKey: p3.data.storageKey, uploadToken: p3.data.uploadToken,
  });
  ok('第二個檔案上傳成功', conf3.data.files?.length === 2, JSON.stringify(conf3.data?.files?.length));
  const rm = await stu.del(`/api/submissions/${sid}/files/${conf3.data.files[1].id}`);
  ok('送出前可移除檔案', rm.status === 200 && rm.data.files.length === 1, JSON.stringify(rm.data?.files?.length));

  /* ---------- 9. 送出 ---------- */
  const sub = await stu.post(`/api/submissions/${sid}/submit`);
  ok('正式送出', (sub.status === 200 || sub.status === 201) && sub.data.status === 'submitted', JSON.stringify(sub.data));
  ok('準時送出 isLate=false', sub.data.isLate === false, String(sub.data.isLate));
  ok('submittedAt 已寫入', !!sub.data.submittedAt);

  const afterSubmitUpload = await stu.post('/api/uploads/presign', {
    submissionId: sid, filename: '偷加的.pdf', size: PDF.length,
  });
  ok('送出後不可再上傳 (409)', afterSubmitUpload.status === 409, `got ${afterSubmitUpload.status}`);

  const mine = await stu.get(`/api/submissions/mine?assignmentId=${aid}`);
  ok('查詢我的繳交紀錄', mine.status === 200 && mine.data.length >= 1, JSON.stringify(mine.data?.length));

  /* ---------- 10. 教師檢視 ---------- */
  const roster = await teacher.get(`/api/assignments/${aid}/submissions`);
  ok('教師取得全班繳交狀況', roster.status === 200, JSON.stringify(roster.data).slice(0, 300));
  const rows = Array.isArray(roster.data) ? roster.data : (roster.data?.rows || roster.data?.students || []);
  const submitted = rows.filter((r) => r.status === 'submitted' || r.submission?.status === 'submitted');
  ok('名單含全班（含未繳交者）', rows.length === studentCount, `rows=${rows.length} students=${studentCount}`);
  ok('其中一位已繳交', submitted.length === 1, `submitted=${submitted.length}`);
  log.push(`繳交狀況：${submitted.length}/${rows.length} 已繳交`);

  const stuRoster = await stu.get(`/api/assignments/${aid}/submissions`);
  ok('學生不可看全班繳交狀況 (403)', stuRoster.status === 403, `got ${stuRoster.status}`);

  const peek = await stu2.get(`/api/submissions/${sid}`);
  ok('學生不可讀他人繳交 (403/404)', peek.status === 403 || peek.status === 404, `got ${peek.status}`);

  /* ---------- 11. 下載 ---------- */
  const dl = await teacher.get(`/api/files/${fileId}/download-url`);
  ok('教師取得下載連結', dl.status === 200 && !!dl.data.url, JSON.stringify(dl.data));
  const fileRes = await fetch(absolute(dl.data.url));
  const cd = fileRes.headers.get('content-disposition') || '';
  const body = Buffer.from(await fileRes.arrayBuffer());
  ok('下載檔案位元組正確', body.equals(PDF), `${body.length} vs ${PDF.length}`);
  ok('強制 attachment 下載', cd.startsWith('attachment'), cd);
  ok('中文檔名用 RFC 5987 編碼', cd.includes("filename*=UTF-8''"), cd);
  ok('回應帶 nosniff', fileRes.headers.get('x-content-type-options') === 'nosniff');

  const dl2 = await stu2.get(`/api/files/${fileId}/download-url`);
  ok('他人不可取得下載連結 (403/404)', dl2.status === 403 || dl2.status === 404, `got ${dl2.status}`);

  /* ---------- 12. 遲交判定 ---------- */
  const pastDue = new Date(Date.now() - 2 * 3600e3).toISOString();
  const lateOk = new Date(Date.now() + 3600e3).toISOString();
  const lateA = await teacher.post(`/api/courses/${course.id}/assignments`, {
    title: 'E2E 遲交測試（已過期但可補交）', dueAt: pastDue, lateUntil: lateOk, allowedExt: ['pdf'],
  });
  await teacher.post(`/api/assignments/${lateA.data.id}/publish`);
  const lateDraft = await stu.post(`/api/assignments/${lateA.data.id}/submissions`);
  const emptySubmit = await stu.post(`/api/submissions/${lateDraft.data.id}/submit`);
  ok('空白草稿不可送出 (400)', emptySubmit.status === 400, `got ${emptySubmit.status}`);
  await stu.patch(`/api/submissions/${lateDraft.data.id}`, { textContent: '遲交作答內容' });
  const lateSub = await stu.post(`/api/submissions/${lateDraft.data.id}/submit`);
  ok('補交期間內可送出', lateSub.status === 200 || lateSub.status === 201, `${lateSub.status} ${JSON.stringify(lateSub.data)}`);
  ok('遲交旗標 isLate=true 已凍結', lateSub.data?.isLate === true, JSON.stringify(lateSub.data?.isLate));

  const closedA = await teacher.post(`/api/courses/${course.id}/assignments`, {
    title: 'E2E 遲交測試（完全過期）', dueAt: pastDue, allowedExt: ['pdf'],
  });
  await teacher.post(`/api/assignments/${closedA.data.id}/publish`);
  const closedDraft = await stu.post(`/api/assignments/${closedA.data.id}/submissions`);
  await stu.patch(`/api/submissions/${closedDraft.data.id}`, { textContent: '想偷交' });
  const closedSub = await stu.post(`/api/submissions/${closedDraft.data.id}/submit`);
  ok('超過補交期限不可送出 (403)', closedSub.status === 403, `got ${closedSub.status}`);
  ok('拒絕原因確實是逾期而非缺內容',
    JSON.stringify(closedSub.data || '').includes('截止時間'),
    JSON.stringify(closedSub.data));

} catch (e) {
  fail++;
  results.push(`  ERROR 測試中斷：${e.stack || e.message}`);
}

console.log('\n===== 端對端測試結果 =====\n');
console.log(results.join('\n'));
console.log('\n----- 觀察 -----');
console.log(log.map((l) => '  ' + l).join('\n'));
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail ? 1 : 0);

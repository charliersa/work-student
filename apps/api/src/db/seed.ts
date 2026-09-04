/**
 * 開發用種子資料。可重複執行（已存在就跳過）。
 * 全部帳號密碼皆為 Passw0rd!
 */
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { assignments, courses, enrollments, users } from './schema';
import { runMigrations } from './migrate';

const DEMO_PASSWORD = 'Passw0rd!';

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function main() {
  await runMigrations();
  const { db, close } = await getDb();

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log('資料庫已有資料，略過 seed。要重來請執行 npm run db:reset');
    await close();
    return;
  }

  const passwordHash = await hash(DEMO_PASSWORD);

  const [admin] = await db
    .insert(users)
    .values({ email: 'admin@example.edu.tw', name: '系統管理員', role: 'admin', passwordHash })
    .returning();

  const [teacher] = await db
    .insert(users)
    .values({ email: 'teacher@example.edu.tw', name: '王老師', role: 'teacher', passwordHash })
    .returning();

  const studentRows = await db
    .insert(users)
    .values([
      { email: 's1130101@example.edu.tw', name: '陳小明', studentNo: '1130101', role: 'student' as const, passwordHash },
      { email: 's1130102@example.edu.tw', name: '林小華', studentNo: '1130102', role: 'student' as const, passwordHash },
      { email: 's1130103@example.edu.tw', name: '黃小美', studentNo: '1130103', role: 'student' as const, passwordHash },
    ])
    .returning();

  const [course] = await db
    .insert(courses)
    .values({ code: 'CS101', title: '資訊科技概論', term: '114-1', ownerId: teacher.id })
    .returning();

  await db.insert(enrollments).values([
    { courseId: course.id, userId: teacher.id, role: 'teacher' as const },
    ...studentRows.map((s) => ({ courseId: course.id, userId: s.id, role: 'student' as const })),
  ]);

  await db.insert(assignments).values([
    {
      courseId: course.id,
      title: '作業一：HTML 個人簡介網頁',
      descriptionMd: '請製作一頁個人簡介網頁，並將 .html 與圖片一起壓縮成 zip 上傳。',
      dueAt: daysFromNow(7),
      lateUntil: daysFromNow(10),
      maxScore: '100',
      maxAttempts: 3,
      maxFiles: 3,
      maxFileBytes: 20 * 1024 * 1024,
      allowedExt: ['zip', 'pdf', 'png'],
      publishedAt: new Date(),
      createdBy: teacher.id,
    },
    {
      courseId: course.id,
      title: '作業二：JavaScript 小遊戲企劃書',
      descriptionMd: '繳交一份 PDF 企劃書，說明遊戲玩法與技術規劃。**逾期不收**。',
      dueAt: daysFromNow(21),
      lateUntil: null,
      maxScore: '100',
      maxAttempts: 1,
      maxFiles: 1,
      maxFileBytes: 10 * 1024 * 1024,
      allowedExt: ['pdf'],
      publishedAt: new Date(),
      createdBy: teacher.id,
    },
    {
      courseId: course.id,
      title: '作業三：期末專題（尚未發布）',
      descriptionMd: '老師還在編輯，學生端不應該看到這一筆。',
      dueAt: daysFromNow(60),
      maxScore: '100',
      allowedExt: ['zip'],
      publishedAt: null,
      createdBy: teacher.id,
    },
  ]);

  const teacherCheck = await db.select().from(users).where(eq(users.id, teacher.id));
  console.log('種子資料建立完成：');
  console.log(`  管理員  ${admin.email}`);
  console.log(`  教師    ${teacherCheck[0].email}`);
  studentRows.forEach((s) => console.log(`  學生    ${s.email}（學號 ${s.studentNo}）`));
  console.log(`  密碼一律為 ${DEMO_PASSWORD}`);
  await close();
}

main().catch((err) => {
  console.error('seed 失敗：', err);
  process.exit(1);
});

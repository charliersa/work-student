-- ============================================================
-- 學生作業繳交系統 — 初始 schema (M1)
-- 這份 SQL 是 schema 的唯一真實來源；src/db/schema.ts 只是型別鏡像。
-- PGlite 與正式 PostgreSQL 皆可執行。
-- ============================================================

CREATE TYPE user_role         AS ENUM ('student','teacher','admin');
CREATE TYPE course_role       AS ENUM ('student','teacher','ta');
CREATE TYPE submission_status AS ENUM ('draft','submitted','graded','returned');
CREATE TYPE scan_status       AS ENUM ('pending','clean','infected','failed');

-- ---------- 使用者 ----------
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT,                                  -- 未來接 SSO 的使用者可為 NULL
  sso_subject   TEXT UNIQUE,
  name          TEXT NOT NULL,
  student_no    TEXT UNIQUE,
  role          user_role NOT NULL DEFAULT 'student',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 用 lower(email) 唯一索引取代 citext，PGlite 也能跑
CREATE UNIQUE INDEX users_email_lower_uniq ON users (lower(email));

-- ---------- 課程 ----------
CREATE TABLE courses (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  title       TEXT NOT NULL,
  term        TEXT NOT NULL,
  owner_id    BIGINT NOT NULL REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, term)
);

-- ---------- 修課關係（所有權限判斷的依據） ----------
CREATE TABLE enrollments (
  id        BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role      course_role NOT NULL DEFAULT 'student',
  UNIQUE (course_id, user_id)
);
CREATE INDEX enrollments_user_idx ON enrollments (user_id);

-- ---------- 作業 ----------
CREATE TABLE assignments (
  id             BIGSERIAL PRIMARY KEY,
  course_id      BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description_md TEXT,
  due_at         TIMESTAMPTZ NOT NULL,                 -- 一律存 UTC，前端以 Asia/Taipei 顯示
  late_until     TIMESTAMPTZ,                          -- NULL = 不收遲交
  max_score      NUMERIC(5,2) NOT NULL DEFAULT 100,
  max_attempts   INT NOT NULL DEFAULT 1,
  max_files      INT NOT NULL DEFAULT 5,
  max_file_bytes BIGINT NOT NULL DEFAULT 20971520,
  allowed_ext    TEXT[] NOT NULL DEFAULT '{pdf,zip,docx}',
  published_at   TIMESTAMPTZ,                          -- NULL = 草稿，學生看不到
  created_by     BIGINT NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assignments_late_after_due CHECK (late_until IS NULL OR late_until >= due_at)
);
CREATE INDEX assignments_course_due_idx ON assignments (course_id, due_at);

-- ---------- 個別延期 ----------
CREATE TABLE extensions (
  id            BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_due_at    TIMESTAMPTZ NOT NULL,
  reason        TEXT,
  granted_by    BIGINT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

-- ---------- 繳交 ----------
-- 註：目前為個人作業。未來要支援分組時，於此表加 group_id BIGINT NULL，
--     並把 student_id 語意改為 submitter_id（見 README「未來擴充」）。
CREATE TABLE submissions (
  id            BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_no    INT NOT NULL DEFAULT 1,
  status        submission_status NOT NULL DEFAULT 'draft',
  text_content  TEXT,
  submitted_at  TIMESTAMPTZ,
  is_late       BOOLEAN NOT NULL DEFAULT FALSE,        -- 送出當下由伺服器判定並凍結
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id, attempt_no)       -- 防連點兩次送出的競態
);
CREATE INDEX submissions_assignment_status_idx ON submissions (assignment_id, status);
CREATE INDEX submissions_student_idx ON submissions (student_id, created_at DESC);
-- 每位學生同一份作業最多一份草稿
CREATE UNIQUE INDEX submissions_one_draft_per_student
  ON submissions (assignment_id, student_id) WHERE status = 'draft';

-- ---------- 檔案（metadata 在 DB，位元組在物件儲存） ----------
CREATE TABLE submission_files (
  id            BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL UNIQUE,                  -- 絕不含使用者輸入
  original_name TEXT NOT NULL,                         -- 僅供顯示與下載檔名
  mime_type     TEXT NOT NULL,                         -- 伺服器偵測，不信前端
  size_bytes    BIGINT NOT NULL,
  sha256        CHAR(64) NOT NULL,                     -- 去重 / 完整性 / 抄襲初篩
  scan          scan_status NOT NULL DEFAULT 'pending',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX submission_files_submission_idx ON submission_files (submission_id);
CREATE INDEX submission_files_sha256_idx ON submission_files (sha256);

-- ---------- 成績（1:1，分離「評完」與「公布」） ----------
CREATE TABLE grades (
  submission_id BIGINT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  score         NUMERIC(5,2),
  feedback_md   TEXT,
  graded_by     BIGINT NOT NULL REFERENCES users(id),
  graded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at   TIMESTAMPTZ                            -- NULL = 學生看不到
);

-- ---------- 師生留言 ----------
CREATE TABLE comments (
  id            BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  author_id     BIGINT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  is_private    BOOLEAN NOT NULL DEFAULT FALSE,        -- true = 只有教師群看得到
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_submission_idx ON comments (submission_id, created_at);

-- ---------- 稽核（爭議時的唯一依據，只進不出） ----------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   BIGINT,
  ip          TEXT,
  user_agent  TEXT,
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

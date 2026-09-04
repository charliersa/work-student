# 學生作業繳交系統 — M1 骨架

國立新營高工「學生學習平台」的作業繳交模組。這一版（M1）已可跑通完整主流程：
**老師出題 → 發布 → 學生上傳檔案 → 送出 → 老師看到全班繳交狀況**。

---

## 快速開始

本機**不需要安裝 Docker 或 PostgreSQL**，開發環境用嵌入式 Postgres（PGlite）與本機磁碟儲存。

```bash
npm install          # 安裝全部 workspace 依賴
cp .env.example .env # 已預先建立，通常不用改
npm run db:seed      # 建立資料表 + 種子資料
npm run dev          # 同時啟動 API(:3000) 與前端(:5173)
```

打開 http://localhost:5173

| 角色 | 帳號 | 密碼 |
|---|---|---|
| 學生 | `1130101`（或 `s1130101@example.edu.tw`） | `Passw0rd!` |
| 教師 | `teacher@example.edu.tw` | `Passw0rd!` |
| 管理員 | `admin@example.edu.tw` | `Passw0rd!` |

其他指令：

```bash
npm run db:migrate   # 只跑 migration
npm run db:reset     # 砍掉本機資料庫與已上傳檔案，重新 seed
npm run typecheck    # 全 workspace 型別檢查
npm run build        # 產生正式版
```

---

## 端對端測試

`apps/api/test/e2e.mjs` 對**正在執行中**的 API 打真實 HTTP 請求，跑完整條主流程
（出題 → 發布 → 上傳 → 送出 → 教師檢視 → 下載），並涵蓋權限與檔案驗證的負面測試，
共 57 項斷言。沒有額外相依套件，用 Node 內建的 `fetch`。

```bash
npm run dev                                   # 終端機 A：把 API 跑起來
npm run test:e2e                              # 終端機 B：port 會自己從 .env 讀
BASE=http://localhost:5173 npm run test:e2e   # 改打前端 proxy，連 vite 那段一起驗
```

涵蓋範圍包含這些容易寫錯的地方：

- 未登入、錯誤密碼、跨學生讀寫他人繳交、學生讀班級名冊 → 應被擋
- 未發布的作業學生看不到，也不能用 id 直接讀
- 同一份作業重複建立草稿只會拿到同一筆（驗證 partial unique index）
- 副檔名白名單、檔案大小上限、**magic bytes 與副檔名不符**（PNG 改名成 `.pdf`）→ 應被擋
- 上傳憑證與 storage key 不符 → 應被擋
- 送出後不可再上傳；空白草稿不可送出
- 準時 / 補交期間 / 完全逾期三種情況的 `isLate` 判定
- 下載為 `attachment` + `nosniff`，中文檔名以 RFC 5987 編碼，位元組與上傳的完全相同

測試會真的寫入資料。想從乾淨狀態跑就先 `npm run db:reset` **並重啟 API**
（重設會刪掉資料庫檔案，但已在執行的伺服器仍握著舊的連線）。

---

## 疑難排解

### API 起不來，說 port 被佔用

改 `.env` 的 `PORT` 就好，**只要改這一個地方**：前端 vite proxy 與簽發上傳/下載網址用的
`API_PUBLIC_URL` 都會自動跟著走。

在 VSCode 裡最常見的原因是 **Live Preview** —— 它會 serve 專案根目錄的 `index.html`
（就是那份設計稿），並且同時佔用 **3000（HTTP）與 3001（WebSocket）**。
注意**關掉預覽分頁並不會停掉它的伺服器**，要用命令面板執行「Live Preview: Stop Server」，
或到「連接埠 / Ports」面板把連接埠移除。

### 為什麼 API 要在啟動時自己檢查 port

因為光靠 `EADDRINUSE` 擋不住。Node 預設綁 `0.0.0.0` 與 `[::]`，而 Live Preview 只綁
`127.0.0.1`——在 Windows 上這兩者可以**同時 listen 同一個 port 而完全不報錯**：

```
0.0.0.0:3000      PID 187152   ← 我們的 API
127.0.0.1:3000    PID  24140   ← Live Preview
```

接著 `localhost` 解析成 IPv4 還是 IPv6 就決定請求打到誰，同一個指令跑兩次可能得到不同結果。
所以 `main.ts` 會在 listen 之前主動對 `127.0.0.1` 與 `::1` 試連，有人佔用就直接拒絕啟動並
說明原因，而不是讓你之後對著時好時壞的 404 debug 半天。

同理，vite proxy 的目標寫 `127.0.0.1` 而不是 `localhost`，避免解析到 `::1` 撞上別的服務。

---

## 專案結構

```
work_student/
├─ packages/shared/        前後端共用的 zod schema、型別、上傳規則
├─ apps/api/               NestJS + Drizzle
│  ├─ migrations/          ★ schema 的唯一真實來源（純 SQL）
│  ├─ test/e2e.mjs         端對端煙霧測試（57 項斷言，見下方「端對端測試」）
│  └─ src/
│     ├─ access/           權限判斷（一律以 enrollments 為準）
│     ├─ auth/             登入、JWT、cookie
│     ├─ storage/          StorageDriver 抽象：本機磁碟 / S3·R2·MinIO
│     ├─ submissions/      繳交流程與檔案驗證（系統核心）
│     └─ db/               drizzle schema、migration runner、seed
├─ apps/web/               React + Vite + TanStack Query
├─ docker-compose.yml      正式/團隊環境的 Postgres + MinIO
├─ index.html / support.js 原本的 UI 設計稿（保留作視覺參考，未被程式使用）
└─ .env                    環境設定
```

---

## 換到正式環境

只改 `.env`，程式碼一行都不用動：

```bash
# 資料庫：PGlite → 真正的 PostgreSQL
DB_DRIVER=pg
DATABASE_URL=postgres://user:pass@host:5432/work_student

# 儲存：本機磁碟 → Cloudflare R2（egress 免費，老師打包下載最省）
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_BUCKET=work-student
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# 一定要換
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
NODE_ENV=production
```

有 Docker 的機器可以 `docker compose up -d` 起 Postgres + MinIO 來模擬正式環境。

---

## 已實作的 API

所有端點都需要登入（cookie 或 `Authorization: Bearer`），除了標示 `public` 者。

### 認證
| Method | Path | 說明 |
|---|---|---|
| POST | `/api/auth/login` | public，帳號可用 email 或學號 |
| POST | `/api/auth/refresh` | public，用 refresh cookie 換新 token |
| POST | `/api/auth/logout` | public |
| GET | `/api/me` | 目前登入者 |
| GET | `/api/health` | public |

### 課程與作業
| Method | Path | 誰能用 |
|---|---|---|
| GET | `/api/courses` | 全部（只看得到自己修/教的課） |
| GET | `/api/courses/:id` | 課程成員 |
| GET | `/api/courses/:id/enrollments` | 該課教師/助教 |
| GET | `/api/courses/:id/assignments` | 課程成員（學生看不到未發布的） |
| GET | `/api/assignments/:id` | 課程成員 |
| POST | `/api/courses/:id/assignments` | 該課教師/助教 |
| PATCH | `/api/assignments/:id` | 該課教師/助教 |
| POST | `/api/assignments/:id/publish` | 該課教師/助教 |
| GET | `/api/assignments/:id/submissions` | 該課教師/助教（含未繳交名單） |

### 繳交與檔案
| Method | Path | 說明 |
|---|---|---|
| POST | `/api/assignments/:id/submissions` | 取得或建立草稿 |
| PATCH | `/api/submissions/:id` | 更新作答文字 |
| POST | `/api/uploads/presign` | 換取直傳網址 |
| POST | `/api/submissions/:id/files` | 確認上傳（真正的驗證關卡） |
| DELETE | `/api/submissions/:id/files/:fileId` | 送出前移除檔案 |
| POST | `/api/submissions/:id/submit` | **正式送出**（判定並凍結遲交狀態） |
| GET | `/api/submissions/mine?assignmentId=` | 我的歷次繳交 |
| GET | `/api/submissions/:id` | 單筆（本人或該課教師） |
| GET | `/api/files/:id/download-url` | 短效下載連結 |

---

## 幾個刻意的設計決定

**權限一律查 `enrollments`，不看全域 `users.role`。**
只檢查 `role = 'teacher'` 會讓 A 老師看得到 B 老師班上的作業，這是這類系統最常見的漏洞。
所有判斷集中在 `apps/api/src/access/access.service.ts`。

**遲交在送出當下判定並凍結成 `submissions.is_late` 欄位。**
不是每次查詢再跟 `due_at` 比對 — 否則老師事後改截止時間，已送出的紀錄會被追溯改判。
判定用的伺服器時間、截止時間也一併寫進 `audit_logs`，日後有爭議時那就是唯一依據。

**同一份作業每位學生只會有一份草稿，由部分唯一索引保證。**
`submissions_one_draft_per_student` 這個 partial unique index 是「學生連點兩次送出」的正解，
比在應用層加鎖可靠。程式碼另外處理 `23505` 唯一鍵衝突，讓競態下的第二次請求讀回既有草稿。

**檔案位元組永遠不經過 API 伺服器。**
`presign → 前端直傳 → 確認` 三段式流程。本機開發用簽章 token 模擬 presigned URL，
所以換到 R2/S3 時前後端流程完全一致。

**檔案驗證做兩層：副檔名白名單 + magic bytes 必須相符。**
只看副檔名等於沒檢查（把 `shell.php` 改名成 `report.pdf` 是最基本的攻擊）。
驗不過的檔案會立刻從儲存空間刪掉，不會留下來。

**原始檔名永遠不進入儲存路徑。**
storage key 格式固定為 `courses/{cid}/assignments/{aid}/{sid}/{attempt}/{uuid}.{ext}`，
並用正則驗證，杜絕 path traversal。原檔名只存在 DB 的 `original_name`，下載時透過
`Content-Disposition` 還原（含 RFC 5987 編碼，中文檔名不會亂碼）。

**下載一律 `attachment` + `nosniff`。**
學生上傳的 HTML 永遠不會在瀏覽器中被執行。正式環境建議再把檔案放到獨立網域
（例如 `files.xxx.edu.tw`），這樣即使有 XSS 也偷不到主站 cookie。

**時間全部存 UTC（`TIMESTAMPTZ`），只在前端轉 `Asia/Taipei` 顯示。**
時區是這類系統最常見的爭議來源。

---

## 未來擴充

### 分組作業（目前為個人作業）
確認要做時：

1. 新增 `groups`（id, assignment_id, name）與 `group_members`（group_id, user_id）
2. `submissions` 加 `group_id BIGINT NULL`，`student_id` 語意改為 `submitter_id`
3. 部分唯一索引改成兩條：個人作業用 `(assignment_id, student_id)`、分組用 `(assignment_id, group_id)`
4. `AccessService.loadSubmissionForUser` 的 `isOwner` 判斷改為「本人 或 同組成員」
5. 評分寫入時套用到全組

前端與 API 介面不需要大改，`SubmissionDto` 加一個 `group` 欄位即可。

### 後續里程碑
- **M2** — 評分與公布（`grades.released_at` 已預留）、個別延期 UI、未繳交名單催繳
- **M3** — ClamAV 掃毒 worker（`submission_files.scan` 已預留 `pending` 狀態，
  屆時把 `submissions.service.ts` 裡寫死的 `scan: 'clean'` 改回 `'pending'`）、
  BullMQ 打包下載、CSV 匯入匯出
- **M4** — 通知信、抄襲初篩（`sha256` 索引已建好，可先抓完全相同的檔案）、學校 SSO

### 目前的簡化（正式上線前要補）
- `scan` 直接寫入 `clean`，尚未接防毒掃描
- 沒有 rate limit（登入與 presign 端點應該要加）
- refresh token 未做輪替與撤銷清單
- drizzle schema 與 SQL migration 是人工同步，改 schema 時兩邊都要改

import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';

export function Login() {
  const { login } = useAuth();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(account, password);
    } catch (err) {
      // 後端的 zod 驗證會回 issues，把它攤開來顯示才有用
      if (err instanceof ApiError && err.issues?.length) {
        setError(err.issues.map((i) => i.message).join('、'));
      } else {
        setError(err instanceof Error ? err.message : '登入失敗');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card" style={{ width: 380, maxWidth: '100%' }} onSubmit={onSubmit}>
        <div className="row" style={{ marginBottom: 18 }}>
          <span className="logo" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>
            營
          </span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>學生學習平台</div>
            <div className="muted">作業繳交系統</div>
          </div>
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="field">
          <label htmlFor="account">學號或 Email</label>
          <input
            id="account"
            value={account}
            autoComplete="username"
            onChange={(e) => setAccount(e.target.value)}
            placeholder="1130101"
          />
        </div>
        <div className="field">
          <label htmlFor="password">密碼</label>
          <input
            id="password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '登入中…' : '登入'}
        </button>

        <p className="muted" style={{ marginBottom: 0, marginTop: 16 }}>
          開發用種子帳號：學生 <code>1130101</code>、教師 <code>teacher@example.edu.tw</code>
          <br />
          密碼一律為 <code>Passw0rd!</code>
        </p>
      </form>
    </div>
  );
}

import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Login } from './pages/Login';
import { Courses } from './pages/Courses';
import { CourseDetail } from './pages/CourseDetail';
import { AssignmentDetail } from './pages/AssignmentDetail';

export function App() {
  const { me, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="center-page muted">載入中…</div>;
  if (!me) return location.pathname === '/login' ? <Login /> : <Navigate to="/login" replace />;

  return (
    <>
      <Shell />
      <main>
        <div className="wrap">
          <Routes>
            <Route path="/" element={<Courses />} />
            <Route path="/courses/:courseId" element={<CourseDetail />} />
            <Route path="/assignments/:assignmentId" element={<AssignmentDetail />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<div className="card">找不到這個頁面</div>} />
          </Routes>
        </div>
      </main>
    </>
  );
}

function Shell() {
  const { me, logout } = useAuth();
  const roleLabel = me?.role === 'student' ? '學生' : me?.role === 'teacher' ? '教師' : '管理員';

  return (
    <>
      <div className="topbar">
        <div className="wrap row between">
          <span>國立新營高級工業職業學校</span>
          <span>{new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
        </div>
      </div>
      <header className="site">
        <div className="wrap header-inner">
          <span className="logo">營</span>
          <span style={{ flex: 1, minWidth: 180 }}>
            <Link to="/" style={{ color: 'inherit', fontSize: 19, fontWeight: 900 }}>
              學生學習平台
            </Link>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Student Learning Portal</div>
          </span>
          <span style={{ fontSize: 14 }}>
            {me?.name}（{roleLabel}
            {me?.studentNo ? ` · ${me.studentNo}` : ''}）
          </span>
          <button className="small" onClick={() => void logout()} style={{ borderColor: '#f4f1ea' }}>
            登出
          </button>
        </div>
      </header>
    </>
  );
}

import { Link, Outlet, useLocation } from "react-router-dom";

export default function App() {
  const loc = useLocation();
  const isHome = loc.pathname === "/";
  return (
    <div className="app">
      <header className="topbar">
        {!isHome ? (
          <Link to={-1 as any} className="back-btn" aria-label="back">
            ‹
          </Link>
        ) : (
          <span style={{ width: 24 }} />
        )}
        <Link to="/" className="brand">
          주차될까
        </Link>
        <Link to="/visits" className="hist-btn" aria-label="visits">
          기록
        </Link>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="disclaimer">
        ※ 실시간 정보는 현장과 차이가 있을 수 있습니다.
      </footer>
    </div>
  );
}

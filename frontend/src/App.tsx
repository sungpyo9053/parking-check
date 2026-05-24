import { Link, Outlet, useLocation } from "react-router-dom";

// 페이지 슬라이드는 풀블리드 AnalysisPage 의 absolute 레이아웃과 충돌해
// 흰화면 사고 일으켜 일시 비활성화. 향후 풀블리드 페이지 제외 또는 다른
// transition 방식 (CSS only fade 등) 으로 재도입 예정.
export default function App() {
  const loc = useLocation();
  const isHome = loc.pathname === "/";
  return (
    <div className={`app ${isHome ? "app-home" : ""}`}>
      {!isHome && (
        <header className="topbar">
          <Link to={-1 as any} className="back-btn" aria-label="back">
            ‹
          </Link>
          <Link to="/" className="brand">
            주차될까
          </Link>
          <Link to="/visits" className="hist-btn" aria-label="visits">
            기록
          </Link>
        </header>
      )}
      <main className={isHome ? "content content-home" : "content"}>
        <Outlet />
      </main>
      <footer className="disclaimer">
        ※ 실시간 정보는 현장과 차이가 있을 수 있습니다.
        {isHome && (
          <div className="disclaimer-brand">
            🅿️ 주차될까 · <span className="disclaimer-by">A ReviewDr Lab Project</span>
          </div>
        )}
      </footer>
    </div>
  );
}

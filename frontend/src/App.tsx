import { Link, Outlet, useLocation, useNavigationType } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

// 페이지 슬라이드 — 토스 앱 같은 좌우 슬라이드.
// PUSH(forward): 새 페이지 오른쪽에서 들어오고 이전 페이지 살짝 왼쪽으로 빠짐.
// POP(back): 새 페이지 왼쪽에서 들어오고 현재 페이지 오른쪽으로 빠짐.
// REPLACE: 방향성 없음 — forward 처럼 처리.
const pageVariants = {
  initial: (dir: number) => ({
    x: dir > 0 ? "100%" : "-25%",
    opacity: dir > 0 ? 1 : 0.6,
  }),
  animate: { x: "0%", opacity: 1 },
  exit: (dir: number) => ({
    x: dir > 0 ? "-25%" : "100%",
    opacity: dir > 0 ? 0.6 : 1,
  }),
};
const pageTransition = {
  type: "tween" as const,
  duration: 0.2,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

export default function App() {
  const loc = useLocation();
  const navType = useNavigationType();
  const dir = navType === "POP" ? -1 : 1;
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
      <main className="content page-transition-host">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={loc.pathname}
            custom={dir}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="page-transition-wrap"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="disclaimer">
        ※ 실시간 정보는 현장과 차이가 있을 수 있습니다.
      </footer>
    </div>
  );
}

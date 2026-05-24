import { useState } from "react";

type Props = {
  onSearchClick: () => void;
};

/** 랜딩 페이지 상단 header — 로고 "주차될까" + 메뉴 + CTA.
 *  모바일 우선: 햄버거 드로어 / 데스크탑: 인라인 메뉴.
 */
export default function LandingHeader({ onSearchClick }: Props) {
  const [open, setOpen] = useState(false);

  const goTo = (anchor: string) => {
    setOpen(false);
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header className="lh-header">
      <div className="lh-header-inner">
        <button
          type="button"
          className="lh-logo"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <span className="lh-logo-emoji">🅿️</span>
          <span className="lh-logo-text">주차될까</span>
        </button>

        <nav className="lh-nav lh-nav-desktop">
          <button onClick={() => goTo("section-problem")}>서비스 소개</button>
          <button onClick={() => goTo("section-solution")}>사용 방법</button>
          <button onClick={() => goTo("section-example")}>예시</button>
          <button onClick={() => goTo("section-trust")}>문의</button>
        </nav>

        <button className="lh-header-cta" onClick={onSearchClick}>
          장소 검색
        </button>

        <button
          className="lh-header-hamburger"
          aria-label="메뉴"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <div className="lh-mobile-menu">
          <button onClick={() => goTo("section-problem")}>서비스 소개</button>
          <button onClick={() => goTo("section-solution")}>사용 방법</button>
          <button onClick={() => goTo("section-example")}>예시</button>
          <button onClick={() => goTo("section-trust")}>문의</button>
        </div>
      )}
    </header>
  );
}

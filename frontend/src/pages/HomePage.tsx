import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, FavoriteItemOut } from "../lib/api";
import { useRecentSearches } from "../hooks/useRecentSearches";
import DiscoverHot from "../components/DiscoverHot";
import ScrollHeroHeadline from "../components/ScrollHeroHeadline";
import { Favorite, listFavorites, removeFavorite } from "../lib/favorites";
import {
  StoredGroup,
  clearGroup,
  getGroup,
  setGroup,
  shareUrl,
} from "../lib/favoritesGroup";
import { sharePage } from "../lib/share";

export default function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { items, clear } = useRecentSearches();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [group, setGroupState] = useState<StoredGroup | null>(null);
  const [groupItems, setGroupItems] = useState<FavoriteItemOut[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupErr, setGroupErr] = useState<string | null>(null);

  // 초기 로드: localStorage 즐겨찾기 + 그룹 + URL ?fav 자동 가입
  useEffect(() => {
    setFavorites(listFavorites());
    const sp = new URLSearchParams(window.location.search);
    const favParam = sp.get("fav");
    const existing = getGroup();
    if (favParam && !existing) {
      // URL 로 들어온 새 코드 자동 가입
      joinGroup(favParam);
    } else if (existing) {
      setGroupState(existing);
      refreshGroup(existing.code);
    }
    // URL 정리
    if (favParam) {
      const u = new URL(window.location.href);
      u.searchParams.delete("fav");
      window.history.replaceState({}, "", u.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshGroup(code: string) {
    try {
      const d = await api.getFavGroup(code);
      setGroupItems(d.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGroupErr(`그룹 동기화 실패: ${msg}`);
    }
  }

  async function joinGroup(code: string) {
    setGroupBusy(true);
    setGroupErr(null);
    try {
      const d = await api.getFavGroup(code.trim().toUpperCase());
      const g: StoredGroup = {
        code: d.group.code,
        name: d.group.name,
        joined_at: Date.now(),
      };
      setGroup(g);
      setGroupState(g);
      setGroupItems(d.items);
      setCodeInput("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGroupErr(`코드를 찾을 수 없음: ${msg}`);
    } finally {
      setGroupBusy(false);
    }
  }

  async function createGroup() {
    setGroupBusy(true);
    setGroupErr(null);
    try {
      const g = await api.createFavGroup();
      const sg: StoredGroup = {
        code: g.code,
        name: g.name,
        joined_at: Date.now(),
      };
      setGroup(sg);
      setGroupState(sg);
      setGroupItems([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGroupErr(`생성 실패: ${msg}`);
    } finally {
      setGroupBusy(false);
    }
  }

  async function shareGroup() {
    if (!group) return;
    await sharePage({
      title: "주차될까 - 공유 즐겨찾기",
      text: `이 코드로 같은 즐겨찾기를 공유해요: ${group.code}`,
      url: shareUrl(group.code),
    });
  }

  function leaveGroup() {
    if (!confirm("그룹에서 나가시겠어요? 다른 사람의 즐겨찾기는 남아있어요."))
      return;
    clearGroup();
    setGroupState(null);
    setGroupItems([]);
  }

  async function removeGroupItem(item: FavoriteItemOut) {
    if (!group) return;
    if (!confirm(`'${item.name}' 즐겨찾기를 제거할까요? (둘 다에서 사라져요)`))
      return;
    try {
      await api.removeFavItem(group.code, item.id);
      setGroupItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      alert("제거 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function openGroupItem(item: FavoriteItemOut) {
    const url = item.place_id
      ? `/analyze?place_id=${item.place_id}&name=${encodeURIComponent(item.name)}`
      : `/analyze?lat=${item.lat}&lng=${item.lng}&name=${encodeURIComponent(item.name)}`;
    navigate(url);
  }

  function openFavorite(f: Favorite) {
    const url = f.place_id
      ? `/analyze?place_id=${f.place_id}&name=${encodeURIComponent(f.name)}`
      : `/analyze?lat=${f.lat}&lng=${f.lng}&name=${encodeURIComponent(f.name)}`;
    navigate(url);
  }

  function removeFav(f: Favorite, e: React.MouseEvent) {
    e.stopPropagation();
    removeFavorite(f.place_id, f.lat, f.lng);
    setFavorites(listFavorites());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate(`/places?q=${encodeURIComponent(query)}`);
  }

  return (
    <div>
      <ScrollHeroHeadline />

      <form className="search-box" onSubmit={submit}>
        <input
          inputMode="search"
          placeholder="예: 수유전통시장, 더홈 안양, 디올 성수"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button type="submit">검색</button>
      </form>

      <DiscoverHot />

      <div className="home-mode-cards">
        <Link to="/judge" className="home-mode-card home-mode-card-judge">
          <span className="home-mode-emoji">⚖️</span>
          <div className="home-mode-body">
            <div className="home-mode-title">약속 장소 심판</div>
            <div className="home-mode-sub">
              후보 2~5곳 비교 → 차량 방문 안전 1등 선정
            </div>
          </div>
        </Link>
        <Link to="/basecamp" className="home-mode-card home-mode-card-basecamp">
          <span className="home-mode-emoji">🅿️</span>
          <div className="home-mode-body">
            <div className="home-mode-title">베이스캠프 모드</div>
            <div className="home-mode-sub">
              차 한번 대고 도보로 놀기 좋은 동네 코스
            </div>
          </div>
        </Link>
      </div>

      <h2 className="h2">★ 공유 즐겨찾기</h2>
      {group ? (
        <>
          <div className="home-group-banner">
            <span className="home-group-banner-text">
              그룹 코드 <strong className="home-group-code">{group.code}</strong>
              {group.name ? ` · ${group.name}` : ""}
            </span>
            <span className="home-group-actions">
              <button className="btn home-group-btn" onClick={shareGroup}>
                📤 코드 공유
              </button>
              <button
                className="btn home-group-btn home-group-btn-danger"
                onClick={leaveGroup}
              >
                나가기
              </button>
            </span>
          </div>
          {groupItems.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              아직 즐겨찾기가 없어요. 분석 페이지에서 ★ 누르면 둘 다 보여요.
            </p>
          ) : (
            <ul className="list" style={{ marginBottom: 12 }}>
              {groupItems.map((it) => (
                <li
                  key={`g-${it.id}`}
                  className="list-item clickable"
                  onClick={() => openGroupItem(it)}
                  style={{ position: "relative" }}
                >
                  <span className="title">★ {it.name}</span>
                  {it.address && <span className="sub">{it.address}</span>}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeGroupItem(it);
                    }}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: 8,
                      background: "transparent",
                      border: "none",
                      color: "#9ca3af",
                      fontSize: 16,
                      cursor: "pointer",
                    }}
                    aria-label="즐겨찾기 제거"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <p className="muted" style={{ fontSize: 12 }}>
            둘이 같은 즐겨찾기를 공유하려면 그룹을 만들거나 코드를 입력하세요.
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button
              className="btn primary"
              disabled={groupBusy}
              onClick={createGroup}
              style={{ flex: 1 }}
            >
              {groupBusy ? "생성 중..." : "+ 그룹 만들기"}
            </button>
          </div>
          <form
            className="home-group-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeInput.trim()) joinGroup(codeInput);
            }}
          >
            <input
              className="home-group-join-input"
              placeholder="받은 코드 입력 (예: K7B4M9Q2)"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
            />
            <button
              className="btn"
              type="submit"
              disabled={groupBusy || !codeInput.trim()}
            >
              가입
            </button>
          </form>
          {groupErr && (
            <p className="error" style={{ fontSize: 12, marginTop: 6 }}>
              {groupErr}
            </p>
          )}
        </div>
      )}

      {favorites.length > 0 && (
        <>
          <h2 className="h2">★ 내 즐겨찾기 (이 기기만)</h2>
          <ul className="list">
            {favorites.map((f) => (
              <li
                key={`fav-${f.place_id ?? `${f.lat},${f.lng}`}`}
                className="list-item clickable"
                onClick={() => openFavorite(f)}
                style={{ position: "relative" }}
              >
                <span className="title">★ {f.name}</span>
                {f.address && <span className="sub">{f.address}</span>}
                <button
                  type="button"
                  onClick={(e) => removeFav(f, e)}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    background: "transparent",
                    border: "none",
                    color: "#9ca3af",
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                  aria-label="즐겨찾기 제거"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="h2">최근 검색</h2>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          아직 검색 기록이 없습니다.
        </p>
      ) : (
        <ul className="list">
          {items.map((it) => (
            <li
              key={`${it.place_id ?? it.name}-${it.ts}`}
              className="list-item clickable"
              onClick={() => {
                const url = it.place_id
                  ? `/analyze?place_id=${it.place_id}&name=${encodeURIComponent(it.name)}`
                  : `/analyze?lat=${it.lat}&lng=${it.lng}&name=${encodeURIComponent(it.name)}`;
                navigate(url);
              }}
            >
              <span className="title">{it.name}</span>
              <span className="sub">{it.query}</span>
            </li>
          ))}
          <li>
            <button className="btn" onClick={clear} style={{ width: "100%" }}>
              최근 검색 지우기
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

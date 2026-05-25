import { Link } from "react-router-dom";

/** 개인정보처리방침 — 한국 「개인정보 보호법」 의무 사항.
 *  자세한 항목은 서비스 운영 상황에 맞춰 정기 업데이트 필요. */
export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <Link to="/" className="legal-back">‹ 홈으로</Link>
      <h1 className="legal-h1">개인정보처리방침</h1>
      <p className="legal-meta">시행일: 2026-05-25</p>

      <section className="legal-section">
        <h2>1. 수집하는 개인정보 항목</h2>
        <p>
          주차될까(이하 "서비스")는 회원가입 절차 없이 익명으로 이용 가능합니다. 다만
          다음 정보가 자동으로 수집·이용될 수 있습니다.
        </p>
        <ul>
          <li>접속 로그 (IP 주소, User-Agent, 접속 시각, Referer)</li>
          <li>분석 요청 정보 (검색 장소명, 좌표, 분석 옵션)</li>
          <li>익명 단말 토큰 (자체 주차 셀프 라벨 / 즐겨찾기 동기화 목적, 브라우저 localStorage 에만 저장)</li>
          <li>방문 후기 (사용자가 입력한 yes/no/note — 익명)</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>2. 개인정보의 수집 및 이용 목적</h2>
        <ul>
          <li>주차 가능성 분석 결과 제공</li>
          <li>서비스 품질 개선, 부정 이용 방지</li>
          <li>분석 결과 정확도 향상 (사용자 셀프 라벨 통계)</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>3. 개인정보의 보유 및 이용 기간</h2>
        <p>
          접속 로그는 최대 6개월 보관 후 자동 파기합니다. 익명 단말 토큰은 사용자가 브라우저
          데이터를 삭제하면 즉시 사라집니다. 셀프 라벨/즐겨찾기 정보는 익명 통계 형태로
          보관됩니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>4. 개인정보의 제3자 제공</h2>
        <p>법령에 의한 요구가 있는 경우를 제외하고 제3자에게 제공하지 않습니다.</p>
      </section>

      <section className="legal-section">
        <h2>5. 외부 서비스 이용</h2>
        <p>
          서비스 동작을 위해 다음 외부 API 를 이용합니다. 사용자의 검색어/좌표가 해당
          서비스에 전송될 수 있습니다.
        </p>
        <ul>
          <li>카카오맵 (Kakao) — 장소 검색, 주차장 정보</li>
          <li>Tavily / Naver — 웹 검색 (자체 주차 evidence 수집)</li>
          <li>Groq — AI 분류·요약 (분석 결과 가공)</li>
          <li>공공데이터포털 — 전국 주차장 표준 데이터 (예정)</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>6. 이용자의 권리</h2>
        <p>
          이용자는 언제든지 브라우저 데이터 삭제, 즐겨찾기 그룹 탈퇴를 통해 본인의 정보를
          삭제할 수 있습니다. 추가 요청은 아래 연락처로 문의해 주세요.
        </p>
      </section>

      <section className="legal-section">
        <h2>7. 개인정보 보호 책임자</h2>
        <p>
          이메일: <a href="mailto:hello@reviewdr.kr">hello@reviewdr.kr</a>
          <br />
          운영: HIAILab
        </p>
      </section>

      <section className="legal-section">
        <h2>8. 고지의 의무</h2>
        <p>
          본 방침이 변경되는 경우 변경 사항은 시행일 7일 전부터 본 페이지를 통해 공지합니다.
        </p>
      </section>
    </div>
  );
}

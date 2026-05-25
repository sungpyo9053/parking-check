import { Link } from "react-router-dom";

export default function TermsPage() {
  return (
    <div className="legal-page">
      <Link to="/" className="legal-back">‹ 홈으로</Link>
      <h1 className="legal-h1">이용약관</h1>
      <p className="legal-meta">시행일: 2026-05-25</p>

      <section className="legal-section">
        <h2>제1조 (목적)</h2>
        <p>
          본 약관은 주차될까(이하 "서비스")의 이용 조건 및 절차, 회사와 이용자의 권리·의무 및
          책임사항 등을 규정함을 목적으로 합니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>제2조 (서비스의 성격)</h2>
        <p>
          서비스는 사용자가 차량 방문을 결정하기 전 <strong>참고용 주차 가능성 정보</strong>를
          제공합니다. 실시간 주차 가능 대수, 정확한 요금, 운영 여부를 보장하지 않습니다.
        </p>
        <p>
          사용자는 본 서비스 결과를 절대적인 정보로 신뢰하지 않고, 방문 전 매장/지도 앱/현장에서
          한 번 더 확인할 의무가 있습니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>제3조 (이용자의 의무)</h2>
        <ul>
          <li>타인의 정보 무단 수집, 자동화 도구로 대량 호출 등 부정 이용 금지</li>
          <li>방문 후기·셀프 라벨 입력 시 사실에 기반한 정보 입력</li>
          <li>본 서비스 결과로 인한 손해는 서비스의 책임이 아님을 인지</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>제4조 (책임의 한계)</h2>
        <p>
          서비스는 분석 결과의 정확성·완전성·시의성을 보장하지 않으며, 결과 이용으로 발생한
          간접/직접적 손해 (예: 주차장 만차로 인한 약속 지연, 요금 차이, 매장 휴무 등) 에 대해
          책임지지 않습니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>제5조 (외부 데이터 출처)</h2>
        <p>
          서비스는 카카오맵 / 공공데이터포털 / Tavily / Naver / Groq 등 외부 데이터 소스를
          사용합니다. 해당 출처의 데이터 정확도/가용성에 종속됩니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>제6조 (서비스의 변경·중단)</h2>
        <p>
          운영자는 사전 공지 없이 서비스의 일부 또는 전체 기능을 변경·중단할 수 있습니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>제7조 (문의)</h2>
        <p>
          이메일: <a href="mailto:hello@reviewdr.kr">hello@reviewdr.kr</a>
        </p>
      </section>
    </div>
  );
}

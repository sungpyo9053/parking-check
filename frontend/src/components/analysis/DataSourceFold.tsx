export default function DataSourceFold() {
  return (
    <details className="data-source">
      <summary>데이터 기준</summary>
      <ul className="data-source-list">
        <li>공식 주차장 데이터 (시·도 공공 주차장)</li>
        <li>카카오맵 등록 주차장 검색</li>
        <li>네이버 블로그/카페 후기 (자체 주차 판단·메뉴 추출)</li>
        <li>실시간 잔여면수는 일부 공영주차장만 제공됩니다</li>
        <li>운영/요금은 현장과 다를 수 있으며 방문 전 확인을 권장합니다</li>
      </ul>
    </details>
  );
}

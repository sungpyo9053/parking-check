"""공공데이터포털 전국주차장 표준데이터를 CSV 로 저장.

data.go.kr 표준데이터 상세 페이지의 다운로드 버튼과 같은 내부 JSON 엔드포인트를
사용한다. 별도 serviceKey 없이 공개 다운로드가 열려 있을 때 동작한다.

사용:
    python scripts/download_parking_standard_csv.py scripts/data/parking.csv
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

PUBLIC_DATA_PK = "15012896"
BASE = "https://www.data.go.kr"


def get_json(path: str, params: dict) -> dict | list[dict]:
    url = f"{BASE}{path}?{urlencode(params, doseq=True)}"
    with urlopen(url, timeout=60) as r:
        return json.load(r)


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python scripts/download_parking_standard_csv.py <output.csv>", file=sys.stderr)
        sys.exit(1)

    out_path = Path(sys.argv[1])
    out_path.parent.mkdir(parents=True, exist_ok=True)

    header = get_json("/download/columList.json", {"pk": PUBLIC_DATA_PK, "ext": "CSV"})
    columns = header["columList"]
    header_kr = [c["columNm"] for c in columns]
    header_en = [c["columCode"] for c in columns]
    total = int(header["totalCount"])
    per_page = 10000
    table_name = header["tableVO"]["svcTableNm"]
    col_nm_list = header["tableVO"]["colNmList"]
    pages = (total + per_page - 1) // per_page

    print(f"download total={total} pages={pages} table={table_name}")
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(header_kr)
        written = 0
        for page in range(1, pages + 1):
            rows = get_json(
                "/download/standard.json",
                {
                    "publicDataPk": PUBLIC_DATA_PK,
                    "colNmList": col_nm_list,
                    "totalCount": total,
                    "svcTableNm": table_name,
                    "perPage": per_page,
                    "page": page,
                },
            )
            if not isinstance(rows, list):
                raise RuntimeError(f"unexpected response on page {page}: {rows!r}")
            for row in rows:
                writer.writerow([row.get(code) or "" for code in header_en])
            written += len(rows)
            print(f"  page {page}/{pages}: rows={len(rows)} written={written}")

    print(f"saved {written} rows to {out_path}")


if __name__ == "__main__":
    main()

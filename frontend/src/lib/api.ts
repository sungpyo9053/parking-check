const BASE = import.meta.env.VITE_BACKEND_BASE_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export type PlaceItem = {
  external_source: string;
  external_id: string | null;
  place_id: number | null;
  name: string;
  address: string | null;
  road_address: string | null;
  category: string | null;
  lat: number;
  lng: number;
};

export type RealtimeBlock = {
  available_count: number | null;
  total_capacity: number | null;
  observed_at: string | null;
  source: string | null;
  stale_seconds: number | null;
};

export type Congestion =
  | "easy"
  | "moderate"
  | "busy"
  | "risky"
  | "full"
  | "unknown";

export type Candidate = {
  id: number;
  name: string;
  type: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  walk_minutes: number | null;
  walking_route_distance_m: number | null;
  walking_route_source: "osrm" | "haversine" | null;
  capacity: number | null;
  fee_summary: string | null;
  is_open_now: boolean | null;
  realtime: RealtimeBlock | null;
  congestion: Congestion;
  score: number;
  reasons: string[];
  history: {
    my_visits: number;
    my_success_rate: number | null;
    last_visit: { result: string | null; visited_at: string | null } | null;
  } | null;
};

export type AnalyzeResponse = {
  destination: {
    place_id: number | null;
    name: string | null;
    address: string | null;
    lat: number;
    lng: number;
  };
  self_parking: SelfParking;
  summary: {
    nearby_count: number;
    nearest_distance_m: number | null;
    any_full_risk: boolean;
    data_quality: "rich" | "partial" | "sparse";
  };
  analysis_summary: string | null;
  candidates: Candidate[];
  external_candidates: ExternalCandidate[];
  top_recommendation: TopRecommendation | null;
  menu: {
    items: Array<{ name: string; mentions: number; evidence: string | null }>;
    source: string;
  } | null;
  fallback: FallbackInfo | null;
  self_parking_feedback_stats: SelfParkingFeedbackStats | null;
  history_for_destination: Array<{
    visit_id: number;
    selected_parking_name: string | null;
    searched_at: string;
    actual_result: string | null;
    memo: string | null;
  }>;
  disclaimers: string[];
};

export type SelfParkingStatus =
  | "available"
  | "likely"
  | "uncertain"
  | "unavailable"
  | "unknown";

export type SelfParkingEvidence = {
  source: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  matched_keywords: string[];
  confidence: "low" | "medium" | "high";
};

export type SelfParking = {
  status: SelfParkingStatus;
  confidence: number;
  label: string | null;
  reason: string | null;
  summary_natural: string | null;
  matched_lot_id: number | null;
  evidence: SelfParkingEvidence[];
  warning: string | null;
};

export type CandidateSource = "public_db" | "kakao_fallback" | "web_search";

export type UsabilityTier = "usable" | "caution" | "private_restricted";

export type ExternalCandidate = {
  source: CandidateSource;
  source_label: string;
  name: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  distance_m: number | null;
  walking_minutes: number | null;
  walking_route_distance_m: number | null;
  walking_route_source: "osrm" | "haversine" | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  road_address: string | null;
  category: string | null;
  capacity: number | null;
  available_count: number | null;
  fee_summary: string;
  realtime_status: string;
  confidence: "low" | "medium" | "high";
  warning: string;
  usability: UsabilityTier;
  usability_label: string;
  usability_reasons: string[];
  /** LLM 검증 — open_to_public(일반 개방) / restricted(외부 불가) / uncertain */
  llm_verdict?: "open_to_public" | "restricted" | "uncertain" | null;
  llm_reason?: string | null;
  llm_confidence?: "high" | "medium" | "low" | null;
  /** AI 도 추천 (open_to_public + 신뢰도 high/medium) → 카드에 ⭐AI 배지 */
  llm_recommended?: boolean;
};

export type SelfParkingFeedbackStats = {
  place_id: number | null;
  yes_count: number;
  no_count: number;
  unknown_count: number;
  total: number;
};

export type TopRecommendation = {
  candidate: ExternalCandidate;
  score: number;
  reasons: string[];
  headline: string;
  rationale: string | null;
};

export type FallbackInfo = {
  db_count: number;
  kakao_pk6_count: number;
  kakao_keyword_count: number;
  web_search_count: number;
  web_search_enabled: boolean;
  web_search_executed: boolean;
  sources_tried: string[];
  evidence_items: ExternalCandidate[];
  excluded_items: ExternalCandidate[];
  usable_count: number;
  caution_count: number;
  excluded_count: number;
  summary: string | null;
  warnings: string[];
};

export type Visit = {
  id: number;
  destination_name: string | null;
  destination_place_id: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  selected_parking_lot_id: number | null;
  selected_parking_name: string | null;
  searched_at: string;
  expected_arrival_at: string | null;
  predicted_status: string | null;
  predicted_risk_score: number | null;
  api_available_count: number | null;
  api_total_capacity: number | null;
  actual_result: string | null;
  actual_wait_minutes: number | null;
  actual_fee: number | null;
  entrance_difficulty: number | null;
  walking_difficulty: number | null;
  perceived_congestion: number | null;
  memo: string | null;
  created_at: string;
  updated_at: string | null;
};

export type NearbyPoi = {
  name: string;
  address: string | null;
  road_address: string | null;
  category: string | null;
  lat: number;
  lng: number;
  distance_m: number | null;
  url: string | null;
  phone: string | null;
};

export type KakaoPlaceDetail = {
  place_id: string;
  open_status: string | null;
  hours: string | null;
  capacity: string | null;
  base_fee_text: string | null;
  extra_fee_text: string | null;
  daily_max_text: string | null;
  payment_methods: string | null;
  phone: string | null;
  fetched_at_iso: string | null;
};

export const api = {
  searchPlaces: (query: string, size = 10) =>
    request<{ items: PlaceItem[] }>(
      `/api/places/search?query=${encodeURIComponent(query)}&size=${size}`,
    ),

  kakaoDetail: (kakaoPlaceId: string) =>
    request<KakaoPlaceDetail | null>(
      `/api/parking/kakao-detail?kakao_place_id=${encodeURIComponent(kakaoPlaceId)}`,
    ),

  nearbyPois: (params: { lat: number; lng: number; category: "ev" | "subway" | "bus"; radius_m?: number }) => {
    const q = new URLSearchParams({
      lat: String(params.lat),
      lng: String(params.lng),
      category: params.category,
    });
    if (params.radius_m) q.set("radius_m", String(params.radius_m));
    return request<{ items: NearbyPoi[] }>(
      `/api/parking/nearby-pois?${q.toString()}`,
    );
  },

  analyze: (params: {
    place_id?: number;
    lat?: number;
    lng?: number;
    radius?: number;
    /** 매장명 (place_id 미상 + 카카오 검색에서 좌표만 가져온 경우 web 검색 키워드로 사용). */
    name?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.place_id != null) q.set("place_id", String(params.place_id));
    if (params.lat != null) q.set("lat", String(params.lat));
    if (params.lng != null) q.set("lng", String(params.lng));
    if (params.radius) q.set("radius", String(params.radius));
    if (params.name) q.set("name", params.name);
    return request<AnalyzeResponse>(`/api/parking/analyze?${q.toString()}`);
  },

  createVisit: (body: Partial<Visit>) =>
    request<Visit>("/api/visits", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateVisitResult: (id: number, body: Partial<Visit>) =>
    request<Visit>(`/api/visits/${id}/result`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listVisits: () => request<{ count: number; items: Visit[] }>("/api/visits"),

  visitsByPlace: (place_id: number) =>
    request<{ count: number; items: Visit[] }>(
      `/api/visits/by-place?place_id=${place_id}`,
    ),

  visitsByParkingLot: (parking_lot_id: number) =>
    request<{ count: number; items: Visit[] }>(
      `/api/visits/by-parking-lot?parking_lot_id=${parking_lot_id}`,
    ),

  submitSelfParkingFeedback: (
    place_id: number,
    body: {
      answer: "yes" | "no" | "unknown";
      note?: string;
      user_token?: string;
    },
  ) =>
    request<{
      id: number;
      place_id: number | null;
      answer: string;
      created_at: string;
    }>(`/api/places/${place_id}/self-parking-feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  selfParkingFeedbackSummary: (place_id: number) =>
    request<
      SelfParkingFeedbackStats & {
        last_answer: string | null;
        last_at: string | null;
      }
    >(`/api/places/${place_id}/self-parking-feedback/summary`),

  createFavGroup: (name?: string) =>
    request<FavoriteGroupOut>(`/api/favorites/groups`, {
      method: "POST",
      body: JSON.stringify({ name: name || null }),
    }),

  getFavGroup: (code: string) =>
    request<FavoriteGroupDetail>(
      `/api/favorites/groups/${encodeURIComponent(code)}`,
    ),

  addFavItem: (code: string, item: FavoriteItemCreate) =>
    request<FavoriteItemOut>(
      `/api/favorites/groups/${encodeURIComponent(code)}/items`,
      { method: "POST", body: JSON.stringify(item) },
    ),

  removeFavItem: (code: string, itemId: number) =>
    fetch(
      `${import.meta.env.VITE_BACKEND_BASE_URL || ""}/api/favorites/groups/${encodeURIComponent(
        code,
      )}/items/${itemId}`,
      { method: "DELETE" },
    ).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
    }),

  discoverHot: (params: {
    lat: number;
    lng: number;
    category: "cafe" | "food" | "sights";
    limit?: number;
    radius?: number;
  }) => {
    const q = new URLSearchParams({
      lat: String(params.lat),
      lng: String(params.lng),
      category: params.category,
      limit: String(params.limit ?? 3),
      radius: String(params.radius ?? 1500),
    });
    return request<DiscoverHotResponse>(`/api/discover/hot?${q.toString()}`);
  },
};

export type HotCongestion = {
  level: "low" | "medium" | "high";
  label: string;
  basis: string;
};

export type HotPlaceItem = {
  name: string;
  category: string | null;
  category_group_code: string | null;
  phone: string | null;
  address: string | null;
  road_address: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  walking_minutes: number | null;
  place_url: string | null;
  hot_score: number;
  youtube_video_count: number;
  youtube_total_views: number;
  naver_mentions: number;
  tavily_mentions: number;
  region_label: string | null;
  congestion: HotCongestion | null;
};

export type DiscoverHotResponse = {
  category: "cafe" | "food" | "sights";
  label: string;
  region: string | null;
  items: HotPlaceItem[];
};

export type FavoriteGroupOut = {
  id: number;
  code: string;
  name: string | null;
  created_at: string;
};

export type FavoriteItemOut = {
  id: number;
  place_id: number | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  added_by: string | null;
  created_at: string;
};

export type FavoriteGroupDetail = {
  group: FavoriteGroupOut;
  items: FavoriteItemOut[];
};

export type FavoriteItemCreate = {
  place_id?: number | null;
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  added_by?: string | null;
};

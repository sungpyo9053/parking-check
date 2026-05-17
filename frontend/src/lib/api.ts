const BASE = import.meta.env.VITE_BACKEND_BASE_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* ignore */ }
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

export type Congestion = "easy" | "moderate" | "busy" | "risky" | "full" | "unknown";

export type Candidate = {
  id: number;
  name: string;
  type: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  walk_minutes: number | null;
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
  self_parking: {
    status: "available" | "uncertain" | "unavailable" | "unknown";
    confidence: number;
    reason: string | null;
    matched_lot_id: number | null;
  };
  summary: {
    nearby_count: number;
    nearest_distance_m: number | null;
    any_full_risk: boolean;
    data_quality: "rich" | "partial" | "sparse";
  };
  candidates: Candidate[];
  history_for_destination: Array<{
    visit_id: number;
    selected_parking_name: string | null;
    searched_at: string;
    actual_result: string | null;
    memo: string | null;
  }>;
  disclaimers: string[];
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

export const api = {
  searchPlaces: (query: string, size = 10) =>
    request<{ items: PlaceItem[] }>(
      `/api/places/search?query=${encodeURIComponent(query)}&size=${size}`
    ),

  analyze: (params: { place_id?: number; lat?: number; lng?: number; radius?: number }) => {
    const q = new URLSearchParams();
    if (params.place_id != null) q.set("place_id", String(params.place_id));
    if (params.lat != null) q.set("lat", String(params.lat));
    if (params.lng != null) q.set("lng", String(params.lng));
    if (params.radius) q.set("radius", String(params.radius));
    return request<AnalyzeResponse>(`/api/parking/analyze?${q.toString()}`);
  },

  createVisit: (body: Partial<Visit>) =>
    request<Visit>("/api/visits", { method: "POST", body: JSON.stringify(body) }),

  updateVisitResult: (id: number, body: Partial<Visit>) =>
    request<Visit>(`/api/visits/${id}/result`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  listVisits: () => request<{ count: number; items: Visit[] }>("/api/visits"),

  visitsByPlace: (place_id: number) =>
    request<{ count: number; items: Visit[] }>(
      `/api/visits/by-place?place_id=${place_id}`
    ),

  visitsByParkingLot: (parking_lot_id: number) =>
    request<{ count: number; items: Visit[] }>(
      `/api/visits/by-parking-lot?parking_lot_id=${parking_lot_id}`
    )
};

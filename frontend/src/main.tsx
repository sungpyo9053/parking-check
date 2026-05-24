import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./styles.css";

// PWA 자동 갱신 — 새 빌드 배포 시 사용자가 페이지 열어둔 채로도 자동 새로고침.
// vite-pwa 의 autoUpdate + skipWaiting + clientsClaim 으로 SW 가 즉시 활성화되고,
// controller 가 바뀌는 순간 한 번만 location.reload() 트리거.
// 첫 SW 등록(이전에 controller 없던 사용자)은 reload 불필요해서 가드.
if ("serviceWorker" in navigator) {
  const alreadyHadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    if (!alreadyHadController) return;
    refreshing = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

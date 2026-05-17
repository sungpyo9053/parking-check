import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import HomePage from "./pages/HomePage";
import PlaceSelectPage from "./pages/PlaceSelectPage";
import AnalysisPage from "./pages/AnalysisPage";
import VisitLogPage from "./pages/VisitLogPage";
import VisitListPage from "./pages/VisitListPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "places", element: <PlaceSelectPage /> },
      { path: "analyze", element: <AnalysisPage /> },
      { path: "visits/new", element: <VisitLogPage /> },
      { path: "visits", element: <VisitListPage /> },
    ],
  },
]);

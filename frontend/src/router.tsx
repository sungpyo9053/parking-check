import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import HomePage from "./pages/HomePage";
import PlaceSelectPage from "./pages/PlaceSelectPage";
import AnalysisPage from "./pages/AnalysisPage";
import VisitLogPage from "./pages/VisitLogPage";
import VisitListPage from "./pages/VisitListPage";
import JudgePage from "./pages/JudgePage";
import BasecampPage from "./pages/BasecampPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";

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
      { path: "judge", element: <JudgePage /> },
      { path: "basecamp", element: <BasecampPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "terms", element: <TermsPage /> },
    ],
  },
]);

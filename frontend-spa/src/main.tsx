import { createRoot } from "react-dom/client";
import App from "./App";
import { BRAND } from "./config/brand";
import { applyBrandTheme } from "./config/theme";
import { initAnalytics } from "./lib/posthog";
import "./index.css";

// index.html ships a neutral title so the same HTML serves every brand; the
// real one comes from this build's env.
document.title = BRAND.documentTitle;

// Same reason, for the brand colour. Before render, so nothing paints in the
// previous brand's blue. A no-op without VITE_BRAND_PRIMARY (i.e. Che Pizza).
applyBrandTheme();

// Before render, so the first pageview is captured. A no-op without VITE_POSTHOG_KEY.
initAnalytics();

createRoot(document.getElementById("root")!).render(<App />);

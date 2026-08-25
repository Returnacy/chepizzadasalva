import { createRoot } from "react-dom/client";
import App from "./App";
import { BRAND } from "./config/brand";
import "./index.css";

// index.html ships a neutral title so the same HTML serves every brand; the
// real one comes from this build's env.
document.title = BRAND.documentTitle;

createRoot(document.getElementById("root")!).render(<App />);

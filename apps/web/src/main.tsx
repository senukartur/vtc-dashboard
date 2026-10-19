import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import "./shared/i18n.js";
import "./shared/styles.css";
import { takeLink } from "./features/account/link.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
const handoff = takeLink();
createRoot(root).render(
  <StrictMode>
    <App handoff={handoff} />
  </StrictMode>,
);

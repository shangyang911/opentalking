import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./shared/styles/index.css";
import { StudioPrototype } from "./prototype/StudioPrototype";
import { AuthBoundary } from "./features/auth/AuthBoundary";

const showStudioPrototype = new URLSearchParams(window.location.search).get("prototype") === "studio";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthBoundary>{(account, onLogout, billingEnabled) => showStudioPrototype ? <StudioPrototype /> : <App account={account} onLogout={onLogout} billingEnabled={billingEnabled} />}</AuthBoundary>
  </React.StrictMode>
);

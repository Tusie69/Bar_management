import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { App } from "./app/app"
import { EnvBanner } from "./components/env-banner"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* TU-41: đứng ngoài router để mọi cổng (/admin, /letan, /phucvu, /chebien…) đều có. */}
    <EnvBanner />
    <App />
  </StrictMode>,
)

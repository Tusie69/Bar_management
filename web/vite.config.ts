import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  if (command === "build") {
    if (env.VITE_API_MODE !== "http") throw new Error("Production build yêu cầu VITE_API_MODE=http.")
    if (!env.VITE_API_BASE_URL?.trim()) throw new Error("Production build yêu cầu VITE_API_BASE_URL.")
    const url = env.VITE_API_BASE_URL.trim()
    if (!url.startsWith("/") && !["http:", "https:"].includes(new URL(url).protocol)) {
      throw new Error("VITE_API_BASE_URL phải dùng HTTP(S) hoặc đường dẫn cùng origin.")
    }
    const venueId = Number(env.VITE_VENUE_ID ?? 1)
    if (!Number.isSafeInteger(venueId) || venueId <= 0) throw new Error("VITE_VENUE_ID phải là số nguyên dương.")
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "./src") },
    },
    build: {
      rolldownOptions: {
        output: {
          // Stable vendor chunks: app deploys do not bust the framework cache.
          codeSplitting: {
            groups: [
              { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 40 },
              {
                name: "radix",
                test: /node_modules[\\/](radix-ui|@radix-ui|@floating-ui|cmdk|sonner|react-remove-scroll|react-day-picker)/,
                priority: 30,
              },
              {
                name: "data",
                test: /node_modules[\\/](@tanstack|zustand|zod|react-hook-form|@hookform|date-fns)[\\/]/,
                priority: 20,
              },
              { name: "vendor", test: /node_modules[\\/]/, priority: 10 },
              // Mock backend + seed: replaced by the HTTP client when VITE_API_MODE=http.
              { name: "mock-api", test: /src[\\/]services[\\/]mock[\\/]/, priority: 5 },
            ],
          },
        },
      },
    },
  }
})

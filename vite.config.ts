import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
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
})

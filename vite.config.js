import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.OFFERLY_API_PORT || "3001"}`,
        changeOrigin: false,
      },
    },
  },
});

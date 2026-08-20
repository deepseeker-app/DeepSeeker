import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "/DeepSeeker/",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: false,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: `${rootDir}/index.html`,
        skins: `${rootDir}/skins/index.html`,
      },
    },
  },
  plugins: [react()],
});

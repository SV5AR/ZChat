import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mkcert from "vite-plugin-mkcert";

// mkcert generates a locally-trusted certificate (no browser warning).
// Required for iPhone Safari — Safari blocks window.crypto.subtle on plain HTTP.
// On first run it installs a local CA. You may be asked for your password.

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mkcert(),
  ],
  server: {
    host: true,   // expose to local network so iPhone can connect
    https: true,
    port:5173,
    strictPort: true
  },
});

import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://mubone.org",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});

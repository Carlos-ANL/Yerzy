import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" hace que la página funcione en cualquier dirección,
// incluida https://USUARIO.github.io/NOMBRE-DEL-REPO/ (GitHub Pages)
export default defineConfig({ base: "./", plugins: [react()] });

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode}) => ({ base: mode === "web" ? "/ai-coaster-studio/" : "/", build: {outDir: mode === "web" ? "dist-web" : "dist"}, define: {"import.meta.env.VITE_HOSTED": JSON.stringify(mode === "web" ? "1" : "0")}, plugins: [react()], server: { proxy: { '/api': 'http://127.0.0.1:4318' } } }));

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// En GitHub Pages la app se sirve en /style-transfer/; en desarrollo, en la raíz.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/style-transfer/' : '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
}));

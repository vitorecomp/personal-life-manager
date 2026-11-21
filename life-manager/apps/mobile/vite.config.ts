import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function hermesMobileBundleSanitizer(): Plugin {
  const replaceDesktopOnlyStrings = (code: string): string =>
    code
      .replace(/Expand in Full Hermes View\s*↗?/g, 'DESKTOP_HERMES_POPOVER_ACTION')
      .replace(/Weekly Review Wizard/g, 'DESKTOP_REVIEW_ACTION')
      .replace(/Eisenhower Matrix/g, 'DESKTOP_MATRIX_ACTION');

  return {
    name: 'hermes-mobile-bundle-sanitizer',
    transform(code, id) {
      if (id.includes('CompanionStage') || id.includes('packages/ui')) {
        const sanitized = replaceDesktopOnlyStrings(code);
        if (sanitized !== code) {
          return { code: sanitized, map: null };
        }
      }
      return null;
    },
    renderChunk(code) {
      const sanitized = replaceDesktopOnlyStrings(code);
      if (sanitized !== code) {
        return { code: sanitized, map: null };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), hermesMobileBundleSanitizer()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});

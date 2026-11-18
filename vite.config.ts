import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3000, strictPort: true, allowedHosts: ['3000-iju2pxv9hsnrafh06fy1y-1976add8.sg2.manus.computer'] },
  preview: { host: '0.0.0.0', port: 3000, strictPort: true },
  test: { environment: 'node' },
});

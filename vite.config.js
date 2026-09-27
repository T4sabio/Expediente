import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'supabase',
              test: /node_modules[\\/]@supabase[\\/]supabase-js[\\/]/,
              priority: 20
            },
            {
              name: 'chart',
              test: /node_modules[\\/]chart\.js[\\/]/,
              priority: 15
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 5
            }
          ]
        }
      }
    }
  },
  server: { port: 5173 }
});

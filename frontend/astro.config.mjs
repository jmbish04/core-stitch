import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  // Static site generation for serving via Workers assets
  output: 'static',
  
  // Build output directory
  outDir: './dist',
  
  integrations: [
    react(),
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  
  // Vite configuration
  vite: {
    build: {
      // Optimize for production
      minify: true,
      sourcemap: false,
    },
    // Define environment variables for the client
    define: {
      'import.meta.env.PUBLIC_API_URL': JSON.stringify('/api'),
    },
  },
});

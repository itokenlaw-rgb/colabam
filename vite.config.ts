import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // Reactの場合。Vueならここがvue()
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Colabam',
        short_name: 'Colabam',
        description: 'コラージュアルバム作成ツール',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png', // 後でpublicフォルダに配置
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
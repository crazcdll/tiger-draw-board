import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 启用本地 HTTPS（自签证书）。
// 原因：iPad Safari 需要安全上下文才会启用 navigator.share —— LAN HTTP 不算安全上下文，
// 保存 PNG 就只能走下载路径而不是分享面板。配置 HTTPS 后即可保存到相册。
// 首次访问时 iPad 会警告"连接不是私密的"，点"详细信息 → 访问此网站"即可。
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})

# 🐯 小虎画板

> 给小朋友用的卡通风画板，React + TypeScript + Canvas 2D。一把梭无限画布、多种画笔、笔压、PNG 导出、iPad 触控 —— 适配 iPad、电脑双端。

**🌐 在线体验**：<https://tiger-draw-6gqbt08yfc4bd473-1251074403.tcloudbaseapp.com>

---

## ✨ 功能

### 画笔
- ✏️ **圆头笔** · 🖍️ **马克笔**（方头半透明叠加）
- ✨ **霓虹笔**（发光效果，颜色联动当前选择色）
- 🌈 **彩虹笔**（色相随笔画长度自动渐变）
- 🌟 **图章笔**（沿路径等距离落 emoji，8 种可选 + 程序化比熊）
- 💨 **喷漆笔**（确定性随机点阵）
- 🧽 **橡皮擦**（真擦除，`globalCompositeOperation = destination-out`）

### 画布
- 🌐 **无限画布** —— 0.25x ~ 4x 缩放、自由平移
- 🎨 **8 色调色板** + **6 色柔和背景** + **4 档粗细**
- ↩️ ↪️ **撤销 / 重做**，Cmd/Ctrl+Z/Shift+Z/Y/S 快捷键
- 💾 **PNG 导出** —— 自动按 bounding box 裁剪、2x 清晰度、带背景色
- 💽 **LocalStorage 自动保存**，关页再开作品还在
- 🗑️ **卡通风清空确认弹窗**（点外或 Esc 取消）
- 🐯 **可折叠工具栏**，画画时可以藏起来看全屏

### 设备支持
- 🖱️ **鼠标**（PC）：滚轮缩放、空格拖动、左键画
- 👆 **触摸**（iPad 等）：单指画、双指平移缩放
- ✍️ **Apple Pencil**：笔压渲染（压力越大线越粗），自然起收笔 taper
- 📱 **iPad 保存到相册**：通过 Web Share API，点 💾 弹出系统分享面板选"存储图像"

---

## 🛠️ 技术栈

- **React 18** + **TypeScript 5** + **Vite 5**
- 纯 **Canvas 2D API**（无 WebGL / SVG 依赖）
- **LocalStorage** 单 JSON blob 持久化
- **@vitejs/plugin-basic-ssl** 本地 HTTPS 开发（iPad Web Share API 需要安全上下文）
- **@cloudbase/cli** 部署到腾讯云 CloudBase 静态网站托管

---

## 🏗️ 架构要点

### 三层画布渲染

```
main canvas        最终展示
  ├── cache canvas    所有已完成 stroke 的栅格化缓存
  └── current canvas  正在画的那一笔的增量累加层（图章/霓虹/彩虹/喷漆）
```

- **cache canvas**：pointerUp 后把新 stroke 增量贴上，undo/redo/clear 时作废重建
- **current canvas**：贵的笔（图章 N 个 emoji / 霓虹多层发光）只画"自上次以来新增的部分"，pointerup 后整条贴入缓存
- 绘制一帧的成本与"已有多少笔画"和"当前笔画多长"都无关，只与本帧新增点数成正比

### 手势期间用 CSS transform 而非重建缓存

- 双指平移缩放 / 桌面滚轮时，`cameraRef` 实时变但 `bakedCameraRef` 不动
- 缓存里的像素冻住，主 canvas 套一层 `translate(bx, by) scale(a)` 的 CSS transform，GPU 合成加速
- 手势结束后 `bakeView()`：把新 camera 烘进缓存 + 清 CSS transform
- 手势期间 0 次缓存重建，iPad 上几百个图章也能丝滑捏合

### 无限画布坐标系

- 所有 `Stroke.points` 存世界坐标
- 渲染前 `ctx.setTransform(dpr × scale, 0, 0, dpr × scale, -cam.x × dpr × scale, -cam.y × dpr × scale)`
- 缩放半径跟世界坐标绑定，放大后笔画"原地变粗"而不是"变糊"

### 笔压渲染

- 只对 `PointerEvent.pointerType === 'pen'` 启用（Apple Pencil / 电磁笔）
- 鼠标/手指保持恒宽（避免 `pressure = 0.5` 导致的永久细线）
- 分段绘制：每段 `lineWidth = size × (0.25 + 0.75 × pressure)`，`lineCap: round` 让段间平滑

---

## 📂 项目结构

```
src/
├── core/
│   ├── types.ts          Stroke / Point / ToolType / BrushType
│   ├── camera.ts         Camera 类型 + world/screen 坐标换算
│   ├── draw.ts           drawStroke + drawStrokeIncremental + 各种画笔实现
│   ├── export.ts         PNG 导出 + Web Share / Download 分派
│   └── storage.ts        LocalStorage JSON blob 读写
├── components/
│   ├── Board.tsx         画布主组件（pointer 事件、渲染、历史栈、缓存）
│   ├── Toolbar.tsx       底部工具栏
│   ├── ConfirmDialog.tsx 通用确认弹窗
│   ├── StampPreview.tsx  图章按钮预览（emoji vs 程序化）
│   └── Header.tsx        左上角 logo
├── styles/
│   └── global.css        全局样式 + iOS 触控修复
├── App.tsx               组装 Board + Toolbar + Header + 弹窗
└── main.tsx
```

---

## 🚀 本地开发

```bash
# 装依赖
pnpm install

# 开发模式（启用 HTTPS，iPad 上能用 Web Share API 存相册）
pnpm dev --host

# 生产构建 + 本地预览
pnpm build && pnpm preview --host

# 一键部署到腾讯云 CloudBase
pnpm run deploy
```

开发时 Vite 会起 HTTPS 服务（自签证书），iPad 首次访问需在 Safari 点"详细信息 → 访问此网站"信任一次。

---

## ⌨️ 快捷键（桌面）

| 快捷键 | 功能 |
|---|---|
| `Cmd/Ctrl + Z` | 撤销 |
| `Cmd/Ctrl + Shift + Z` / `Cmd/Ctrl + Y` | 重做 |
| `Cmd/Ctrl + S` | 保存 PNG |
| `空格 + 拖动` / `鼠标中键拖动` | 平移画布 |
| `滚轮` / `触控板捏合` | 缩放（以光标为中心） |

---

## 📄 License

MIT

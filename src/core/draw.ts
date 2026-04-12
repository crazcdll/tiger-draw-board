// 单条 Stroke 的绘制逻辑。
// 抽成独立模块，让 Board 的屏幕渲染与 export 的离屏渲染共用同一套样式代码。
//
// 此文件导出两套 API：
//   - drawStroke(ctx, stroke)                            全量绘制（用于缓存重建 / 导出）
//   - drawStrokeIncremental(ctx, stroke, state)          增量绘制（用于正在画的当前层）
//
// 增量 API 只支持 stamp/rainbow/neon/spray —— 它们贵，全量每帧画会卡。
// pen/marker/eraser 不用增量（单个 beginPath+stroke 够快），Board 直接走全量。

import type { Point, Stroke } from './types'

/**
 * 笔压 → 线宽倍率映射
 *   p = 0    → 0.5 × size（最轻笔触）
 *   p = 0.5  → 1.0 × size（标称，等同于手指/鼠标无笔压时的默认粗细）
 *   p = 1.0  → 1.5 × size（重按加粗）
 * 之前用过 0.25 + 0.75×p，但 p=0.5 时只给 0.625×size，导致 Pencil 画出来比
 * 同粗细档的手指细一半，不符合"选哪档就是哪档"的直觉。
 */
const pressureRatio = (p: number): number => 0.5 + p

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length === 0) return

  if (stroke.tool === 'eraser') {
    drawEraser(ctx, stroke)
    return
  }

  switch (stroke.brush) {
    case 'neon':
      drawNeon(ctx, stroke)
      break
    case 'rainbow':
      drawRainbow(ctx, stroke)
      break
    case 'stamp':
      drawStamp(ctx, stroke)
      break
    case 'spray':
      drawSpray(ctx, stroke)
      break
    case 'marker':
    case 'round':
    default:
      drawPenOrMarker(ctx, stroke)
      break
  }
}

// ===== 工具函数 =====

/** 把 stroke 的所有点连成一条 Path2D 轨迹（仅 beginPath + moveTo/lineTo，不 stroke） */
function tracePath(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 1) {
    // 单点画一个极小线段，让 lineCap 渲染出一个圆点
    ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01)
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  }
}

/** 整数哈希 → [0, 1)，用于 spray 的确定性伪随机（保证 undo/redo/平移不闪烁） */
function hash01(n: number): number {
  let x = n | 0
  x = ((x >>> 16) ^ x) * 0x45d9f3b
  x = ((x >>> 16) ^ x) * 0x45d9f3b
  x = (x >>> 16) ^ x
  return (x >>> 0) / 0xffffffff
}

// ===== 橡皮擦 =====

function drawEraser(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000'
  ctx.lineWidth = stroke.size
  tracePath(ctx, stroke.points)
  ctx.stroke()
  ctx.restore()
}

// ===== 圆头笔 / 马克笔（支持笔压） =====

function drawPenOrMarker(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = stroke.color
  if (stroke.brush === 'marker') ctx.globalAlpha = 0.55

  if (!stroke.hasPressure) {
    // 手指 / 鼠标：恒宽
    ctx.lineWidth = stroke.size
    tracePath(ctx, stroke.points)
    ctx.stroke()
  } else if (stroke.points.length < 2) {
    // Pencil 单点：也按笔压算宽度，否则第一帧会渲染成全宽（看起来像"大光标闪一下"）
    const p = stroke.points[0].pressure ?? 0.5
    ctx.lineWidth = stroke.size * pressureRatio(p)
    tracePath(ctx, stroke.points)
    ctx.stroke()
  } else {
    // Pencil 多点：每段用两端点 pressure 均值
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i]
      const b = stroke.points[i + 1]
      const pa = a.pressure ?? 0.5
      const pb = b.pressure ?? 0.5
      const p = (pa + pb) / 2
      ctx.lineWidth = stroke.size * pressureRatio(p)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

// ===== 霓虹笔：四层半透明描边叠加，无 shadowBlur =====
//
// 原先用 shadowBlur 画辉光，每条线都要做高斯模糊，iPad GPU 扛不住。
// 改用"同一路径画多遍，由宽到窄、由淡到亮"模拟 glow：
//   外层很宽很淡 → 边缘柔和的辉光
//   中层中宽中等透明度 → 饱和的光晕
//   内层接近原色 → 主体线条
//   最里一层白色 → 高亮核心
// 视觉上看起来和 shadowBlur 很像，但每层只是一次普通 stroke，快一个数量级。

/** 霓虹笔各层的宽度倍率和 alpha，全量和增量共用一份配置 */
const NEON_LAYERS: Array<{
  widthMult: number
  alpha: number
  white?: boolean
  minWidth: number
}> = [
  { widthMult: 2.8, alpha: 0.18, minWidth: 6 }, // 外晕
  { widthMult: 1.6, alpha: 0.45, minWidth: 3 }, // 中层光
  { widthMult: 0.95, alpha: 0.95, minWidth: 2 }, // 主体
  { widthMult: 0.32, alpha: 1.0, minWidth: 1, white: true }, // 白色内核
]

function drawNeon(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const layer of NEON_LAYERS) {
    ctx.strokeStyle = layer.white ? '#ffffff' : stroke.color
    ctx.globalAlpha = layer.alpha
    ctx.lineWidth = Math.max(layer.minWidth, stroke.size * layer.widthMult)
    tracePath(ctx, stroke.points)
    ctx.stroke()
  }
  ctx.restore()
}

// ===== 彩虹笔：每段一个 hue =====

function drawRainbow(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = stroke.size

  if (stroke.points.length < 2) {
    ctx.strokeStyle = 'hsl(0, 85%, 55%)'
    tracePath(ctx, stroke.points)
    ctx.stroke()
    ctx.restore()
    return
  }

  for (let i = 0; i < stroke.points.length - 1; i++) {
    const hue = (i * 6) % 360
    ctx.strokeStyle = `hsl(${hue}, 90%, 58%)`
    ctx.beginPath()
    ctx.moveTo(stroke.points[i].x, stroke.points[i].y)
    ctx.lineTo(stroke.points[i + 1].x, stroke.points[i + 1].y)
    ctx.stroke()
  }
  ctx.restore()
}

// ===== 图章笔：沿路径等距离落下 emoji =====

function drawStamp(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const key = stroke.stampEmoji || '⭐'
  const fontSize = Math.max(18, stroke.size * 3)
  const spacing = fontSize * 0.85

  ctx.save()
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 首点必定落一个
  stampAt(ctx, key, stroke.points[0].x, stroke.points[0].y, fontSize)

  if (stroke.points.length >= 2) {
    // 沿折线行走，每累计 spacing 就落一个图章
    let acc = 0
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i]
      const b = stroke.points[i + 1]
      const segLen = Math.hypot(b.x - a.x, b.y - a.y)
      if (segLen === 0) continue
      const dx = (b.x - a.x) / segLen
      const dy = (b.y - a.y) / segLen

      let consumed = 0
      while (acc + (segLen - consumed) >= spacing) {
        const step = spacing - acc
        const tx = a.x + dx * (consumed + step)
        const ty = a.y + dy * (consumed + step)
        stampAt(ctx, key, tx, ty, fontSize)
        consumed += step
        acc = 0
      }
      acc += segLen - consumed
    }
  }

  ctx.restore()
}

// ===== 喷漆笔：每个路径点周围撒一圈确定性随机点 =====

function drawSpray(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.fillStyle = stroke.color
  ctx.globalAlpha = 0.75

  const radius = Math.max(6, stroke.size * 1.8)
  const dotsPerPoint = 12

  for (let i = 0; i < stroke.points.length; i++) {
    const p = stroke.points[i]
    paintSprayDotsAt(ctx, p, i, dotsPerPoint, radius)
  }

  ctx.restore()
}

/** 喷漆笔的点撒布实现（给全量和增量共用，保证确定性种子一致） */
function paintSprayDotsAt(
  ctx: CanvasRenderingContext2D,
  p: Point,
  i: number,
  dotsPerPoint: number,
  radius: number,
): void {
  for (let j = 0; j < dotsPerPoint; j++) {
    const base = i * 73856093 + j * 19349663
    const ha = hash01(base + 1)
    const hr = hash01(base + 2)
    const hs = hash01(base + 3)
    const angle = ha * Math.PI * 2
    // sqrt(r) 让点在圆内均匀分布而不是集中在中心
    const r = Math.sqrt(hr) * radius
    const dotSize = 0.8 + hs * 1.6
    ctx.beginPath()
    ctx.arc(
      p.x + Math.cos(angle) * r,
      p.y + Math.sin(angle) * r,
      dotSize,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}

// ===================================================================
// 增量绘制：用于"正在画"的当前层
// ===================================================================

/**
 * 增量状态：每条"正在画"的 stroke 维护一份。
 * pointerdown 时用 createIncrementalState() 初始化，pointermove 后持续累加。
 */
export type IncrementalState = {
  /** 下一个要处理的点 index（已经画到 points[nextPointIndex - 1] 为止） */
  nextPointIndex: number
  /** 图章笔专用：上次落图章以来走过的距离 */
  stampAcc: number
}

export function createIncrementalState(): IncrementalState {
  return { nextPointIndex: 0, stampAcc: 0 }
}

/**
 * 只绘制 stroke 中"自上次以来新增"的部分。
 *
 * 前提：canvas 上已经有之前的画（即调用方不能在每次调用前 clearRect）。
 * 每次调用会把 state.nextPointIndex 推进到 stroke.points.length。
 *
 * 注意：只支持 stamp/rainbow/neon/spray。pen/marker/eraser 要用 drawStroke。
 */
export function drawStrokeIncremental(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  state: IncrementalState,
): void {
  if (stroke.points.length === 0) return

  switch (stroke.brush) {
    case 'rainbow':
      paintRainbowIncremental(ctx, stroke, state)
      break
    case 'neon':
      paintNeonIncremental(ctx, stroke, state)
      break
    case 'stamp':
      paintStampIncremental(ctx, stroke, state)
      break
    case 'spray':
      paintSprayIncremental(ctx, stroke, state)
      break
    default:
      // 不该走到这里 —— 调用方应只对上述 4 种 brush 用增量
      // 保险起见，回退全量重绘一次
      drawStroke(ctx, stroke)
      state.nextPointIndex = stroke.points.length
      break
  }
}

function paintRainbowIncremental(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  state: IncrementalState,
): void {
  const pts = stroke.points
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = stroke.size

  // 首次调用 + 只有一个点 → 落个小圆点
  if (state.nextPointIndex === 0 && pts.length >= 1) {
    ctx.strokeStyle = 'hsl(0, 90%, 58%)'
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01)
    ctx.stroke()
    state.nextPointIndex = 1
  }

  // 新 segment: 从 nextPointIndex - 1 开始到 length - 1
  const startSeg = Math.max(0, state.nextPointIndex - 1)
  const endSeg = pts.length - 1
  for (let i = startSeg; i < endSeg; i++) {
    const hue = (i * 6) % 360
    ctx.strokeStyle = `hsl(${hue}, 90%, 58%)`
    ctx.beginPath()
    ctx.moveTo(pts[i].x, pts[i].y)
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y)
    ctx.stroke()
  }
  state.nextPointIndex = pts.length
  ctx.restore()
}

function paintNeonIncremental(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  state: IncrementalState,
): void {
  const pts = stroke.points
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 首点落一个四层小圆点
  if (state.nextPointIndex === 0 && pts.length >= 1) {
    for (const layer of NEON_LAYERS) {
      ctx.strokeStyle = layer.white ? '#ffffff' : stroke.color
      ctx.globalAlpha = layer.alpha
      ctx.lineWidth = Math.max(layer.minWidth, stroke.size * layer.widthMult)
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01)
      ctx.stroke()
    }
    state.nextPointIndex = 1
  }

  // 新 segments：把新增段组成一条小 polyline，然后对它跑四层描边
  const startSeg = Math.max(0, state.nextPointIndex - 1)
  const endSeg = pts.length - 1
  if (startSeg < endSeg) {
    const tracePoly = () => {
      ctx.beginPath()
      ctx.moveTo(pts[startSeg].x, pts[startSeg].y)
      for (let i = startSeg + 1; i <= endSeg; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.stroke()
    }
    for (const layer of NEON_LAYERS) {
      ctx.strokeStyle = layer.white ? '#ffffff' : stroke.color
      ctx.globalAlpha = layer.alpha
      ctx.lineWidth = Math.max(layer.minWidth, stroke.size * layer.widthMult)
      tracePoly()
    }
  }

  state.nextPointIndex = pts.length
  ctx.restore()
}

// ===== 程序化图章（非 emoji，直接在 canvas 上画） =====
//
// 用重叠圆形 + "双遍" 技巧画干净轮廓：
//   Pass 1: 每个圆略放大后以棕色填充（outline 底色）
//   Pass 2: 每个圆按原大小用白色填充覆盖
// 这样圆之间的重叠区被后一遍白色盖掉，只在最外轮廓留下棕边，避免"圆里套圆"的脏线。

type ProceduralStamp = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) => void

/**
 * 坐姿比熊：头 + 身体 + 四条小腿 + 耳朵，剪影用双遍法保证外轮廓干净。
 * 所有尺寸以 size（图章 fontSize 等价量）为基准，在 cx,cy 为中心绘制。
 *
 * variant:
 *   'bib'  带黄色围脖（参考图里左边那只）
 *   'plain' 带粉色腮红，无围脖（参考图里右边那只）
 */
type BichonVariant = 'bib' | 'plain'

type SilPiece =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { kind: 'rrect'; x: number; y: number; w: number; h: number; rr: number }

function drawBichonAt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  variant: BichonVariant,
): void {
  ctx.save()
  const r = size / 2
  const lw = Math.max(1, size * 0.045)

  // 所有部件坐标是"相对 r 的单位比例"，方便调参。
  // 总体布局：头在上，身体在下，四条前腿从身体底部伸出。
  const pieces: SilPiece[] = [
    // 身体主体（椭圆，上窄下宽的感觉靠微调 ry）
    { kind: 'ellipse', x: 0, y: 0.28, rx: 0.52, ry: 0.4 },

    // 四条腿（前面两条更清楚，后面两条稍微露一点脚尖）
    // 前左腿
    { kind: 'rrect', x: -0.34, y: 0.52, w: 0.18, h: 0.36, rr: 0.09 },
    // 前右腿
    { kind: 'rrect', x: 0.16, y: 0.52, w: 0.18, h: 0.36, rr: 0.09 },
    // 后左脚（藏在身后稍微露一点）
    { kind: 'rrect', x: -0.12, y: 0.72, w: 0.1, h: 0.16, rr: 0.05 },
    // 后右脚
    { kind: 'rrect', x: 0.02, y: 0.72, w: 0.1, h: 0.16, rr: 0.05 },

    // 头（比身体稍小但因为蓬松看起来一样大）
    { kind: 'circle', x: 0, y: -0.26, r: 0.4 },

    // 两只耳朵（下垂的耳朵 = 头两侧的小椭圆）
    { kind: 'ellipse', x: -0.38, y: -0.08, rx: 0.14, ry: 0.2 },
    { kind: 'ellipse', x: 0.38, y: -0.08, rx: 0.14, ry: 0.2 },

    // 头顶两团蓬毛
    { kind: 'circle', x: -0.12, y: -0.56, r: 0.13 },
    { kind: 'circle', x: 0.12, y: -0.56, r: 0.13 },
  ]

  // --- 零件绘制工具 ---
  const drawPiece = (p: SilPiece, inflate: number) => {
    ctx.beginPath()
    if (p.kind === 'circle') {
      ctx.arc(cx + p.x * r, cy + p.y * r, p.r * r + inflate, 0, Math.PI * 2)
    } else if (p.kind === 'ellipse') {
      ctx.ellipse(
        cx + p.x * r,
        cy + p.y * r,
        p.rx * r + inflate,
        p.ry * r + inflate,
        0,
        0,
        Math.PI * 2,
      )
    } else {
      // 圆角矩形，inflate 同步作用到位置和宽高
      const px = cx + p.x * r - inflate
      const py = cy + p.y * r - inflate
      const w = p.w * r + inflate * 2
      const h = p.h * r + inflate * 2
      const rr = p.rr * r + inflate
      ctx.roundRect(px, py, w, h, rr)
    }
    ctx.fill()
  }

  // Pass 1: 棕色轮廓底（每个零件略放大）
  ctx.fillStyle = '#5a3a22'
  for (const p of pieces) drawPiece(p, lw)

  // Pass 2: 白色填充盖掉内部（只在最外轮廓留下棕边）
  ctx.fillStyle = '#ffffff'
  for (const p of pieces) drawPiece(p, 0)

  // --- 脸部五官 ---
  const hx = cx
  const hy = cy - 0.26 * r
  const hr = 0.4 * r

  // 大眼睛 + 高光（让比熊显得可爱）
  const eyeR = Math.max(1.8, r * 0.1)
  const eyeY = hy + hr * 0.12
  for (const ex of [hx - hr * 0.36, hx + hr * 0.36]) {
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2)
    ctx.fill()
    // 眼睛里的白色高光
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(
      ex - eyeR * 0.3,
      eyeY - eyeR * 0.35,
      Math.max(0.8, eyeR * 0.42),
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }

  // 鼻子（小黑三角，用圆代替也可，选圆更简单）
  ctx.fillStyle = '#1a1a1a'
  const noseY = hy + hr * 0.42
  ctx.beginPath()
  ctx.ellipse(hx, noseY, r * 0.07, r * 0.055, 0, 0, Math.PI * 2)
  ctx.fill()

  // 嘴（鼻子下的小 U 形）
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = Math.max(1, r * 0.035)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(hx - r * 0.07, noseY + r * 0.08)
  ctx.quadraticCurveTo(
    hx,
    noseY + r * 0.17,
    hx + r * 0.07,
    noseY + r * 0.08,
  )
  ctx.stroke()

  if (variant === 'bib') {
    // 黄色围脖，用波浪边圆来模拟花瓣状
    const bibCx = cx
    const bibCy = cy + r * 0.08
    const baseR = r * 0.34
    ctx.fillStyle = '#ffd84d'
    ctx.strokeStyle = '#5a3a22'
    ctx.lineWidth = lw * 0.9
    ctx.beginPath()
    const petals = 10
    for (let i = 0; i <= petals; i++) {
      const a = (i / petals) * Math.PI * 2 - Math.PI / 2
      const rr1 = baseR * 1.15
      const midA = ((i - 0.5) / petals) * Math.PI * 2 - Math.PI / 2
      const rr2 = baseR * 0.85
      const tipX = bibCx + Math.cos(a) * rr1
      const tipY = bibCy + Math.sin(a) * rr1 * 0.65
      const midX = bibCx + Math.cos(midA) * rr2
      const midY = bibCy + Math.sin(midA) * rr2 * 0.6
      if (i === 0) ctx.moveTo(tipX, tipY)
      else ctx.quadraticCurveTo(midX, midY, tipX, tipY)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else {
    // 粉色腮红
    ctx.fillStyle = 'rgba(255, 170, 180, 0.75)'
    for (const cxx of [hx - hr * 0.56, hx + hr * 0.56]) {
      ctx.beginPath()
      ctx.ellipse(cxx, eyeY + hr * 0.2, hr * 0.17, hr * 0.1, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

/**
 * 若 key 是程序化图章，画到 (cx, cy) 并返回 true；否则返回 false（调用方走 emoji 路径）。
 * size 约等于"emoji 字号"，保证和 fillText(emoji) 的视觉大小接近。
 */
export function drawProceduralStamp(
  ctx: CanvasRenderingContext2D,
  key: string,
  cx: number,
  cy: number,
  size: number,
): boolean {
  const proc = PROCEDURAL_STAMPS[key]
  if (!proc) return false
  proc(ctx, cx, cy, size)
  return true
}

const PROCEDURAL_STAMPS: Record<string, ProceduralStamp> = {
  bichon1: (ctx, cx, cy, size) => drawBichonAt(ctx, cx, cy, size, 'bib'),
  bichon2: (ctx, cx, cy, size) => drawBichonAt(ctx, cx, cy, size, 'plain'),
}

export function isProceduralStamp(key: string): boolean {
  return key in PROCEDURAL_STAMPS
}

// ===== 图章渲染辅助：统一 emoji 与程序化图章的落笔 =====

/**
 * 在 (cx, cy) 画一个图章。调用方应已 save()、设置好 font/textAlign/textBaseline。
 */
function stampAt(
  ctx: CanvasRenderingContext2D,
  key: string,
  cx: number,
  cy: number,
  size: number,
): void {
  if (drawProceduralStamp(ctx, key, cx, cy, size)) return
  ctx.fillText(key, cx, cy)
}

function paintStampIncremental(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  state: IncrementalState,
): void {
  const pts = stroke.points
  const key = stroke.stampEmoji || '⭐'
  const fontSize = Math.max(18, stroke.size * 3)
  const spacing = fontSize * 0.85

  ctx.save()
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 首点必定落一个图章
  if (state.nextPointIndex === 0 && pts.length >= 1) {
    stampAt(ctx, key, pts[0].x, pts[0].y, fontSize)
    state.nextPointIndex = 1
  }

  // 处理新点：从 nextPointIndex 开始，继承 stampAcc
  for (let i = state.nextPointIndex; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen === 0) continue
    const dx = (b.x - a.x) / segLen
    const dy = (b.y - a.y) / segLen
    let consumed = 0
    while (state.stampAcc + (segLen - consumed) >= spacing) {
      const step = spacing - state.stampAcc
      const tx = a.x + dx * (consumed + step)
      const ty = a.y + dy * (consumed + step)
      stampAt(ctx, key, tx, ty, fontSize)
      consumed += step
      state.stampAcc = 0
    }
    state.stampAcc += segLen - consumed
  }
  state.nextPointIndex = pts.length
  ctx.restore()
}

function paintSprayIncremental(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  state: IncrementalState,
): void {
  const pts = stroke.points
  ctx.save()
  ctx.fillStyle = stroke.color
  ctx.globalAlpha = 0.75
  const radius = Math.max(6, stroke.size * 1.8)
  const dotsPerPoint = 12

  for (let i = state.nextPointIndex; i < pts.length; i++) {
    paintSprayDotsAt(ctx, pts[i], i, dotsPerPoint, radius)
  }
  state.nextPointIndex = pts.length
  ctx.restore()
}

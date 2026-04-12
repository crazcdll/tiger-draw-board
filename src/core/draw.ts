// 单条 Stroke 的绘制逻辑。
// 抽成独立模块，让 Board 的屏幕渲染与 export 的离屏渲染共用同一套样式代码。

import type { Point, Stroke } from './types'

/** 笔压为 0 时的最小宽度占比（相对 stroke.size） */
const MIN_PRESSURE_RATIO = 0.25

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

  if (!stroke.hasPressure || stroke.points.length < 2) {
    ctx.lineWidth = stroke.size
    tracePath(ctx, stroke.points)
    ctx.stroke()
  } else {
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i]
      const b = stroke.points[i + 1]
      const pa = a.pressure ?? 0.5
      const pb = b.pressure ?? 0.5
      const p = (pa + pb) / 2
      const ratio = MIN_PRESSURE_RATIO + (1 - MIN_PRESSURE_RATIO) * p
      ctx.lineWidth = stroke.size * ratio
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

// ===== 霓虹笔：三层发光叠加 =====
//
// 和当前选择颜色联动：外层宽而模糊，中层稍细，核心白色小细线
// 用 shadowBlur 制造辉光，shadowColor = 笔色

function drawNeon(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = stroke.color

  // Pass 1: 宽而软的外晕
  ctx.shadowBlur = 24
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = Math.max(3, stroke.size)
  tracePath(ctx, stroke.points)
  ctx.stroke()

  // Pass 2: 明亮中层
  ctx.shadowBlur = 12
  ctx.lineWidth = Math.max(2, stroke.size * 0.55)
  tracePath(ctx, stroke.points)
  ctx.stroke()

  // Pass 3: 白色内核
  ctx.shadowBlur = 3
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(1, stroke.size * 0.22)
  tracePath(ctx, stroke.points)
  ctx.stroke()

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
  const emoji = stroke.stampEmoji || '⭐'
  const fontSize = Math.max(18, stroke.size * 3)
  const spacing = fontSize * 0.85

  ctx.save()
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 首点必定落一个
  ctx.fillText(emoji, stroke.points[0].x, stroke.points[0].y)

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
        ctx.fillText(emoji, tx, ty)
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
    for (let j = 0; j < dotsPerPoint; j++) {
      // 三个不同的种子避免 angle/r/size 相关
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

  ctx.restore()
}

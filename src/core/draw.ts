// 单条 Stroke 的绘制逻辑。
// 抽成独立模块，让 Board 的屏幕渲染与 export 的离屏渲染共用同一套样式代码。

import type { Stroke } from './types'

/** 笔压为 0 时的最小宽度占比（相对 stroke.size） */
const MIN_PRESSURE_RATIO = 0.25

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length === 0) return
  ctx.save()

  // ===== 设置样式（橡皮/马克笔/圆头笔） =====
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    if (stroke.brush === 'marker') {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.55
    } else {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }
    ctx.strokeStyle = stroke.color
  }

  // ===== 恒宽路径（无笔压 / 单点） =====
  if (!stroke.hasPressure || stroke.points.length < 2) {
    ctx.lineWidth = stroke.size
    ctx.beginPath()
    const [first, ...rest] = stroke.points
    ctx.moveTo(first.x, first.y)
    if (rest.length === 0) {
      ctx.lineTo(first.x + 0.01, first.y + 0.01)
    } else {
      for (const p of rest) ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    ctx.restore()
    return
  }

  // ===== 笔压路径：每两点之间一段，lineWidth 由两端点压力均值决定 =====
  //
  // 单 beginPath 无法给不同段不同宽度，所以每段独立 stroke。
  // lineCap='round' 让相邻段在连接处重叠成光滑的圆头，视觉上连续。
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

  ctx.restore()
}

// 单条 Stroke 的绘制逻辑。
// 抽成独立模块，让 Board 的屏幕渲染与 export 的离屏渲染共用同一套样式代码。

import type { Stroke } from './types'

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length === 0) return
  ctx.save()

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    if (stroke.brush === 'marker') {
      ctx.lineCap = 'square'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.55
    } else {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }
    ctx.strokeStyle = stroke.color
  }

  ctx.lineWidth = stroke.size

  ctx.beginPath()
  const [first, ...rest] = stroke.points
  ctx.moveTo(first.x, first.y)
  if (rest.length === 0) {
    // 单点画一个圆点
    ctx.lineTo(first.x + 0.01, first.y + 0.01)
  } else {
    for (const p of rest) ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
  ctx.restore()
}

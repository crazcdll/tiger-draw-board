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
  ctx.shadowColor = stroke.color

  // 首点小圆点（三层叠加）
  if (state.nextPointIndex === 0 && pts.length >= 1) {
    const drawDot = () => {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01)
      ctx.stroke()
    }
    ctx.shadowBlur = 24
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = Math.max(3, stroke.size)
    drawDot()
    ctx.shadowBlur = 12
    ctx.lineWidth = Math.max(2, stroke.size * 0.55)
    drawDot()
    ctx.shadowBlur = 3
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, stroke.size * 0.22)
    drawDot()
    state.nextPointIndex = 1
  }

  // 新 segments: 用一条小 polyline 一次性画完，再分 3 pass
  const startSeg = Math.max(0, state.nextPointIndex - 1)
  const endSeg = pts.length - 1
  if (startSeg < endSeg) {
    const drawPoly = () => {
      ctx.beginPath()
      ctx.moveTo(pts[startSeg].x, pts[startSeg].y)
      for (let i = startSeg + 1; i <= endSeg; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.stroke()
    }
    ctx.shadowBlur = 24
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = Math.max(3, stroke.size)
    drawPoly()

    ctx.shadowBlur = 12
    ctx.lineWidth = Math.max(2, stroke.size * 0.55)
    drawPoly()

    ctx.shadowBlur = 3
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, stroke.size * 0.22)
    drawPoly()
  }

  state.nextPointIndex = pts.length
  ctx.restore()
}

function paintStampIncremental(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  state: IncrementalState,
): void {
  const pts = stroke.points
  const emoji = stroke.stampEmoji || '⭐'
  const fontSize = Math.max(18, stroke.size * 3)
  const spacing = fontSize * 0.85

  ctx.save()
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 首点必定落一个图章
  if (state.nextPointIndex === 0 && pts.length >= 1) {
    ctx.fillText(emoji, pts[0].x, pts[0].y)
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
      ctx.fillText(emoji, tx, ty)
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

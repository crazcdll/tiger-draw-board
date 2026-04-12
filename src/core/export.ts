// 导出：把矢量 strokes 在离屏 canvas 上重放一遍，输出 PNG Blob

import { drawStroke } from './draw'
import type { Stroke } from './types'

export type BBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * 计算所有 stroke 的世界坐标包围盒。
 * 考虑了每条线的宽度（避免边缘半条线被切掉）。
 * 若 strokes 为空或所有 stroke 都没有点，返回 null。
 */
export function computeBoundingBox(strokes: Stroke[]): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasAny = false

  for (const s of strokes) {
    const r = s.size / 2
    for (const p of s.points) {
      hasAny = true
      if (p.x - r < minX) minX = p.x - r
      if (p.y - r < minY) minY = p.y - r
      if (p.x + r > maxX) maxX = p.x + r
      if (p.y + r > maxY) maxY = p.y + r
    }
  }

  if (!hasAny) return null
  return { minX, minY, maxX, maxY }
}

export type ExportOptions = {
  strokes: Stroke[]
  bgColor: string
  /** 包围盒四周额外留白（世界坐标单位） */
  padding?: number
  /** 导出清晰度倍数，2 = 视网膜级 */
  exportScale?: number
}

/**
 * 把 strokes 重绘到离屏 canvas 并输出 PNG Blob。
 * 画布为空时返回 null。
 */
export async function exportStrokesToPngBlob(
  opts: ExportOptions,
): Promise<Blob | null> {
  const padding = opts.padding ?? 40
  const exportScale = opts.exportScale ?? 2

  const bbox = computeBoundingBox(opts.strokes)
  if (!bbox) return null

  const worldW = bbox.maxX - bbox.minX + padding * 2
  const worldH = bbox.maxY - bbox.minY + padding * 2
  const pxW = Math.max(1, Math.ceil(worldW * exportScale))
  const pxH = Math.max(1, Math.ceil(worldH * exportScale))

  // ===== 两层合成，避免橡皮擦 destination-out 擦穿背景色 =====
  //
  // 实时画布上背景是独立 DOM div、canvas 本身透明，所以 destination-out
  // 擦掉的是 canvas 像素，下方背景自然透出。
  // 离屏导出必须把背景 bake 进最终 PNG，但如果先填背景再画 stroke，
  // eraser 会把背景一起擦成透明。所以分两步：
  //   1) 把 strokes 画在透明的 stroke 层上（eraser 只影响本层像素）
  //   2) 在最终画布上先填背景，再用 source-over 把 stroke 层合上去

  // --- Stroke 层（透明背景）---
  const strokeCanvas = document.createElement('canvas')
  strokeCanvas.width = pxW
  strokeCanvas.height = pxH
  const sctx = strokeCanvas.getContext('2d')!
  sctx.setTransform(
    exportScale,
    0,
    0,
    exportScale,
    -(bbox.minX - padding) * exportScale,
    -(bbox.minY - padding) * exportScale,
  )
  for (const s of opts.strokes) drawStroke(sctx, s)

  // --- 最终画布：背景色 + stroke 层 ---
  const canvas = document.createElement('canvas')
  canvas.width = pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = opts.bgColor
  ctx.fillRect(0, 0, pxW, pxH)
  ctx.drawImage(strokeCanvas, 0, 0)

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** 触发浏览器下载一个 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 生成 2026-04-12-153045 这样的时间戳，用于文件名 */
export function formatTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

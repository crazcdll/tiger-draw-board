import { useEffect, useRef, useState } from 'react'
import type { Point, Stroke } from '../core/types'
import './Board.css'

/**
 * Step 2：最小可画版本
 * - 全屏 canvas
 * - 用 PointerEvent 统一处理鼠标 / 触摸 / Apple Pencil
 * - 笔迹以矢量形式存到 strokes[]，每次变动后整张重绘
 * - 目前只有一支黑色笔，工具栏下一步再加
 */
export default function Board() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef<Stroke | null>(null)
  const [, forceRender] = useState(0)

  // ---- 画布尺寸跟随窗口 + 处理 HiDPI ----
  useEffect(() => {
    const canvas = canvasRef.current!
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      render()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // ---- 渲染：一次性重绘所有 stroke ----
  const render = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // 用 CSS 像素坐标清屏（transform 已经是 dpr 缩放）
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    const all = [...strokesRef.current]
    if (drawingRef.current) all.push(drawingRef.current)
    for (const s of all) drawStroke(ctx, s)
  }

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length === 0) return
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.size

    ctx.beginPath()
    const [first, ...rest] = stroke.points
    ctx.moveTo(first.x, first.y)
    // 单点也画一个小圆点
    if (rest.length === 0) {
      ctx.lineTo(first.x + 0.01, first.y + 0.01)
    } else {
      for (const p of rest) ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    ctx.restore()
  }

  // ---- Pointer 事件 ----
  const getPoint = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || undefined,
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawingRef.current = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: 'pen',
      color: '#222',
      size: 4,
      points: [getPoint(e)],
    }
    render()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    drawingRef.current.points.push(getPoint(e))
    render()
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    canvasRef.current!.releasePointerCapture(e.pointerId)
    strokesRef.current.push(drawingRef.current)
    drawingRef.current = null
    forceRender((n) => n + 1) // 后面工具栏会读 strokes 数量，先留个刷新钩子
    render()
  }

  return (
    <canvas
      ref={canvasRef}
      className="board-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  )
}

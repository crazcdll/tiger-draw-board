import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { BrushType, Point, Stroke, ToolType } from '../core/types'
import './Board.css'

export type BoardHandle = {
  undo: () => void
  clear: () => void
}

type Props = {
  tool: ToolType
  brush: BrushType
  color: string
  size: number
}

/**
 * 画布主组件。
 * - 通过 forwardRef 向外暴露 undo / clear（命令式 API，配合工具栏按钮调用）
 * - 工具配置（tool/brush/color/size）作为 props 从 App 传入，存到 propsRef
 *   里以便 pointer 事件处理函数始终读到最新值（避免闭包陈旧问题）
 */
const Board = forwardRef<BoardHandle, Props>(function Board(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef<Stroke | null>(null)
  const [, forceRender] = useState(0)

  // 把最新 props 同步到 ref，handlePointerDown 里读 propsRef.current
  const propsRef = useRef(props)
  propsRef.current = props

  useImperativeHandle(
    ref,
    () => ({
      undo: () => {
        if (strokesRef.current.length === 0) return
        strokesRef.current = strokesRef.current.slice(0, -1)
        render()
        forceRender((n) => n + 1)
      },
      clear: () => {
        strokesRef.current = []
        render()
        forceRender((n) => n + 1)
      },
    }),
    [],
  )

  // ---- 画布尺寸跟随窗口 + HiDPI ----
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

  // ---- 渲染：重绘所有 stroke ----
  const render = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    const all = [...strokesRef.current]
    if (drawingRef.current) all.push(drawingRef.current)
    for (const s of all) drawStroke(ctx, s)
  }

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length === 0) return
    ctx.save()

    if (stroke.tool === 'eraser') {
      // 真擦除：destination-out 会把当前笔画覆盖区的像素变透明
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#000' // 颜色无所谓，只看 alpha
    } else {
      ctx.globalCompositeOperation = 'source-over'
      if (stroke.brush === 'marker') {
        // 马克笔：方头 + 半透明，叠加会变深
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
      // 单点也画一个圆点
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
    const cfg = propsRef.current
    drawingRef.current = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: cfg.tool,
      brush: cfg.brush,
      color: cfg.color,
      size: cfg.size,
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
    strokesRef.current = [...strokesRef.current, drawingRef.current]
    drawingRef.current = null
    forceRender((n) => n + 1)
    render()
  }

  return (
    <canvas
      ref={canvasRef}
      className={`board-canvas ${props.tool === 'eraser' ? 'is-eraser' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  )
})

export default Board

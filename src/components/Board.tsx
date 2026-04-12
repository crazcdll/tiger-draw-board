import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { BrushType, Point, Stroke, ToolType } from '../core/types'
import {
  type Camera,
  DEFAULT_CAMERA,
  clampScale,
  screenToWorld,
  zoomAt,
} from '../core/camera'
import './Board.css'

export type BoardHandle = {
  undo: () => void
  clear: () => void
  resetView: () => void
}

type Props = {
  tool: ToolType
  brush: BrushType
  color: string
  size: number
  bgColor: string
  /** 每次相机变化时回调（用于父组件显示缩放比例） */
  onScaleChange?: (scale: number) => void
}

/**
 * 无限画布 + 绘画主组件。
 *
 * 坐标系统：
 *   - Stroke.points 存 world 坐标
 *   - render() 前通过 ctx.setTransform 把 world → screen
 *   - 所有 pointer 事件进来的 clientX/Y 先转成 canvas 相对坐标，再转 world
 *
 * 交互：
 *   - 单指 / 鼠标左键：画
 *   - 双指：平移 + 捏合缩放（若画到一半第二指落下，当前笔画会被丢弃）
 *   - 空格 + 拖动 / 鼠标中键拖动：平移
 *   - 滚轮 / 触控板捏合：围绕光标缩放
 */
const Board = forwardRef<BoardHandle, Props>(function Board(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef<Stroke | null>(null)
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA })
  const [, forceRender] = useState(0)

  // 最新 props，避免 pointer 闭包拿到旧工具配置
  const propsRef = useRef(props)
  propsRef.current = props

  // ===== 手势状态 =====
  /** 当前屏幕上所有活动指针（canvas 相对坐标） */
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  /** 双指手势锚点 */
  const gestureRef = useRef<null | {
    initialDistance: number
    initialCenter: { x: number; y: number }
    initialCamera: Camera
  }>(null)
  /** 空格/中键拖动平移 */
  const panRef = useRef<null | { lastX: number; lastY: number }>(null)
  const spaceDownRef = useRef(false)
  /** 上一次上报给父组件的 scale，用于去重 */
  const lastReportedScaleRef = useRef(cameraRef.current.scale)

  // ===== 暴露给父组件的命令式 API =====
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
      resetView: () => {
        cameraRef.current = { ...DEFAULT_CAMERA }
        render()
        reportScaleIfChanged()
        forceRender((n) => n + 1)
      },
    }),
    [],
  )

  // ===== 画布尺寸跟随窗口 + HiDPI =====
  useEffect(() => {
    const canvas = canvasRef.current!
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      render()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // ===== 空格键监听（平移模式） =====
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceDownRef.current = true
        document.body.style.cursor = 'grab'
      }
    }
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  // ===== 滚轮缩放（必须用原生 addEventListener 才能 preventDefault） =====
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x, y } = getCanvasXY(e.clientX, e.clientY)
      // 触控板捏合会带 ctrlKey，用更小的步长避免太敏感
      const step = e.ctrlKey ? 0.01 : 0.002
      const factor = Math.exp(-e.deltaY * step)
      cameraRef.current = zoomAt(cameraRef.current, x, y, factor)
      render()
      reportScaleIfChanged()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // ===== 渲染 =====
  const render = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const cam = cameraRef.current

    // 先重置变换，清整张物理画布
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 应用 dpr × 相机变换：canvas 画 world 坐标 → 屏幕像素
    const k = dpr * cam.scale
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)

    const all = [...strokesRef.current]
    if (drawingRef.current) all.push(drawingRef.current)
    for (const s of all) drawStroke(ctx, s)
  }

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
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
      ctx.lineTo(first.x + 0.01, first.y + 0.01)
    } else {
      for (const p of rest) ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    ctx.restore()
  }

  // ===== 坐标辅助 =====
  const getCanvasXY = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const toWorldPoint = (clientX: number, clientY: number, pressure?: number): Point => {
    const s = getCanvasXY(clientX, clientY)
    const w = screenToWorld(cameraRef.current, s.x, s.y)
    return { x: w.x, y: w.y, pressure }
  }

  const reportScaleIfChanged = () => {
    const s = cameraRef.current.scale
    if (s !== lastReportedScaleRef.current) {
      lastReportedScaleRef.current = s
      propsRef.current.onScaleChange?.(s)
    }
  }

  // ===== Pointer 事件 =====
  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    canvas.setPointerCapture(e.pointerId)
    const xy = getCanvasXY(e.clientX, e.clientY)
    pointersRef.current.set(e.pointerId, xy)

    // 中键 or 空格 → 平移模式
    if (e.button === 1 || spaceDownRef.current) {
      panRef.current = { lastX: e.clientX, lastY: e.clientY }
      return
    }

    // 第二根手指落下 → 丢弃当前笔画，进入双指手势
    if (pointersRef.current.size >= 2) {
      drawingRef.current = null
      const pts = [...pointersRef.current.values()]
      const p1 = pts[0]
      const p2 = pts[1]
      gestureRef.current = {
        initialDistance: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
        initialCenter: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        initialCamera: { ...cameraRef.current },
      }
      render()
      return
    }

    // 单指画线
    const cfg = propsRef.current
    drawingRef.current = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: cfg.tool,
      brush: cfg.brush,
      color: cfg.color,
      size: cfg.size,
      points: [toWorldPoint(e.clientX, e.clientY, e.pressure || undefined)],
    }
    render()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    // 更新活动指针位置
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, getCanvasXY(e.clientX, e.clientY))
    }

    // 1) 键盘/中键平移
    if (panRef.current) {
      const dx = e.clientX - panRef.current.lastX
      const dy = e.clientY - panRef.current.lastY
      panRef.current.lastX = e.clientX
      panRef.current.lastY = e.clientY
      const cam = cameraRef.current
      cameraRef.current = {
        ...cam,
        x: cam.x - dx / cam.scale,
        y: cam.y - dy / cam.scale,
      }
      render()
      return
    }

    // 2) 双指手势（平移 + 缩放）
    if (gestureRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()]
      const p1 = pts[0]
      const p2 = pts[1]
      const newDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      const newCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const g = gestureRef.current

      const newScale = clampScale(
        g.initialCamera.scale * (newDist / g.initialDistance),
      )
      // 让 initialCenter 下方的世界点始终贴着 newCenter
      const initialWorld = screenToWorld(
        g.initialCamera,
        g.initialCenter.x,
        g.initialCenter.y,
      )
      cameraRef.current = {
        scale: newScale,
        x: initialWorld.x - newCenter.x / newScale,
        y: initialWorld.y - newCenter.y / newScale,
      }
      render()
      reportScaleIfChanged()
      return
    }

    // 3) 单指画线继续
    if (drawingRef.current && pointersRef.current.size === 1) {
      drawingRef.current.points.push(
        toWorldPoint(e.clientX, e.clientY, e.pressure || undefined),
      )
      render()
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }
    pointersRef.current.delete(e.pointerId)

    // 平移结束
    if (panRef.current) {
      panRef.current = null
      return
    }

    // 双指手势：只有所有手指都抬起才退出；期间不恢复画线
    if (gestureRef.current) {
      if (pointersRef.current.size === 0) {
        gestureRef.current = null
      }
      return
    }

    // 单指画线结束
    if (drawingRef.current) {
      strokesRef.current = [...strokesRef.current, drawingRef.current]
      drawingRef.current = null
      forceRender((n) => n + 1)
      render()
    }
  }

  return (
    <>
      {/* 背景层：独立 DOM，不受 canvas 上橡皮擦的 destination-out 影响 */}
      <div className="board-bg" style={{ background: props.bgColor }} />
      <canvas
        ref={canvasRef}
        className={`board-canvas ${props.tool === 'eraser' ? 'is-eraser' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </>
  )
})

export default Board

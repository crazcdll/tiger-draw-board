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
import { drawStroke } from '../core/draw'
import {
  downloadBlob,
  exportStrokesToPngBlob,
  formatTimestamp,
} from '../core/export'
import { loadStrokes, saveStrokes } from '../core/storage'
import './Board.css'

export type BoardHandle = {
  undo: () => void
  redo: () => void
  clear: () => void
  resetView: () => void
  exportPng: () => Promise<void>
}

type Props = {
  tool: ToolType
  brush: BrushType
  color: string
  size: number
  bgColor: string
  /** 每次相机变化时回调（用于父组件显示缩放比例） */
  onScaleChange?: (scale: number) => void
  /** 历史栈变化时回调（undo/redo 按钮的可用态） */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void
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
  /** 撤销后被弹出的 stroke；新画一笔或清空时会清空这个栈 */
  const redoStackRef = useRef<Stroke[]>([])
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

  // ===== 命令式操作（供 useImperativeHandle 和键盘快捷键共用） =====
  //
  // 这些函数在每次渲染都会被重建，但它们**只通过 ref 访问状态**，
  // 所以用哪次渲染时捕获的闭包都能正常工作。
  // useImperativeHandle 和 keydown useEffect 都只在 mount 时捕获一次，无伤大雅。

  const notifyHistory = () => {
    propsRef.current.onHistoryChange?.(
      strokesRef.current.length > 0,
      redoStackRef.current.length > 0,
    )
  }

  // ===== 自动保存到 localStorage（400ms 防抖） =====
  const saveTimerRef = useRef<number | null>(null)
  const scheduleSave = () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveStrokes(strokesRef.current)
      saveTimerRef.current = null
    }, 400)
  }
  const flushSave = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveStrokes(strokesRef.current)
  }

  const undoFn = () => {
    if (strokesRef.current.length === 0) return
    const last = strokesRef.current[strokesRef.current.length - 1]
    strokesRef.current = strokesRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, last]
    render()
    notifyHistory()
    scheduleSave()
    forceRender((n) => n + 1)
  }

  const redoFn = () => {
    if (redoStackRef.current.length === 0) return
    const last = redoStackRef.current[redoStackRef.current.length - 1]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    strokesRef.current = [...strokesRef.current, last]
    render()
    notifyHistory()
    scheduleSave()
    forceRender((n) => n + 1)
  }

  const clearFn = () => {
    strokesRef.current = []
    redoStackRef.current = []
    render()
    notifyHistory()
    flushSave() // 清空立即落盘，防止 400ms 内关页导致老数据残留
    forceRender((n) => n + 1)
  }

  const resetViewFn = () => {
    cameraRef.current = { ...DEFAULT_CAMERA }
    render()
    reportScaleIfChanged()
    forceRender((n) => n + 1)
  }

  const exportFn = async () => {
    const blob = await exportStrokesToPngBlob({
      strokes: strokesRef.current,
      bgColor: propsRef.current.bgColor,
    })
    if (!blob) {
      window.alert('画布还是空的，先画点什么再保存吧～')
      return
    }
    downloadBlob(blob, `tiger-draw-${formatTimestamp()}.png`)
  }

  useImperativeHandle(
    ref,
    () => ({
      undo: undoFn,
      redo: redoFn,
      clear: clearFn,
      resetView: resetViewFn,
      exportPng: exportFn,
    }),
    // 仅在 mount 时捕获；这些函数内部只用 ref，不依赖 state/props 快照
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ===== 初次挂载：从 localStorage 恢复之前的作品 =====
  useEffect(() => {
    const restored = loadStrokes()
    if (restored.length > 0) {
      strokesRef.current = restored
      render()
      notifyHistory()
      forceRender((n) => n + 1)
    }
    // 关页前确保未落盘的 stroke 写进去
    const onBeforeUnload = () => flushSave()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flushSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ===== 键盘：空格平移 + Ctrl/Cmd 快捷键 =====
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      // 空格按住 = 平移模式
      if (e.code === 'Space' && !e.repeat) {
        spaceDownRef.current = true
        document.body.style.cursor = 'grab'
        return
      }

      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoFn()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redoFn()
      } else if (key === 's') {
        e.preventDefault()
        void exportFn()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 历史分叉：新画一笔后原来的 redo 栈无效
      redoStackRef.current = []
      drawingRef.current = null
      forceRender((n) => n + 1)
      render()
      notifyHistory()
      scheduleSave()
    }
  }

  const cursorClass =
    props.tool === 'eraser'
      ? 'is-eraser'
      : props.brush === 'marker'
        ? 'is-pen-marker'
        : 'is-pen-round'

  return (
    <>
      {/* 背景层：独立 DOM，不受 canvas 上橡皮擦的 destination-out 影响 */}
      <div className="board-bg" style={{ background: props.bgColor }} />
      <canvas
        ref={canvasRef}
        className={`board-canvas ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </>
  )
})

export default Board

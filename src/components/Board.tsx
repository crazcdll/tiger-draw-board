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
import {
  createIncrementalState,
  drawStroke,
  drawStrokeIncremental,
  type IncrementalState,
} from '../core/draw'
import {
  exportStrokesToPngBlob,
  formatTimestamp,
  shareOrDownloadBlob,
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
  /** 图章笔当前选择的 emoji */
  stamp: string
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
  /** 离屏缓存：存所有已完成 stroke 的栅格化结果，避免每帧重绘历史笔画 */
  const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cacheValidRef = useRef(false)
  /** 当前"正在画"层：图章/霓虹/彩虹/喷漆走增量累加，避免每帧重画整条 stroke */
  const currentCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const incrementalStateRef = useRef<IncrementalState>(createIncrementalState())
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
    invalidateCache()
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
    invalidateCache()
    render()
    notifyHistory()
    scheduleSave()
    forceRender((n) => n + 1)
  }

  const clearFn = () => {
    strokesRef.current = []
    redoStackRef.current = []
    invalidateCache()
    render()
    notifyHistory()
    flushSave() // 清空立即落盘，防止 400ms 内关页导致老数据残留
    forceRender((n) => n + 1)
  }

  const resetViewFn = () => {
    cameraRef.current = { ...DEFAULT_CAMERA }
    invalidateCache()
    repaintCurrentAfterCameraChange()
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
    const filename = `tiger-draw-${formatTimestamp()}.png`
    // iPad 上会打开分享面板，选"存储图像"可保存到相册；
    // 桌面浏览器会自动降级为下载
    await shareOrDownloadBlob(blob, filename, '小老虎画板')
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
      invalidateCache()
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
      // 画布尺寸变了，两块离屏画布都要作废
      invalidateCache()
      clearCurrentCanvas()
      incrementalStateRef.current = createIncrementalState()
      repaintCurrentAfterCameraChange()
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
      invalidateCache()
      repaintCurrentAfterCameraChange()
      render()
      reportScaleIfChanged()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // ===== 渲染（带离屏缓存） =====
  //
  // 性能关键路径：iPad 上图章/霓虹笔多了会很卡，原因是每次 pointermove 都
  // 重绘所有已完成 stroke。解决方案 —— 把所有已完成 stroke 栅格化到一块离屏
  // canvas，pointermove 时只需 blit 缓存 + 画当前这一笔，历史笔画数再多都 O(1)。
  //
  // 缓存失效：strokes 变（undo/redo/clear/恢复）或 camera 变（缩放/平移）。
  // pointerUp 提交新 stroke 时走"增量"路径，直接画到缓存上，不整体重建。

  const invalidateCache = () => {
    cacheValidRef.current = false
  }

  /** 若缓存无效则重建整张；画布尺寸变化也会自动触发 */
  const ensureCache = () => {
    const main = canvasRef.current
    if (!main) return
    let cache = cacheCanvasRef.current
    if (!cache) {
      cache = document.createElement('canvas')
      cacheCanvasRef.current = cache
    }
    if (cache.width !== main.width || cache.height !== main.height) {
      cache.width = main.width
      cache.height = main.height
      cacheValidRef.current = false
    }
    if (cacheValidRef.current) return

    const ctx = cache.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cache.width, cache.height)
    const dpr = window.devicePixelRatio || 1
    const cam = cameraRef.current
    const k = dpr * cam.scale
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)
    for (const s of strokesRef.current) drawStroke(ctx, s)
    cacheValidRef.current = true
  }

  /** 把一条刚完成的 stroke 增量画到现有缓存上（避免整体重建） */
  const paintStrokeToCache = (stroke: Stroke) => {
    const cache = cacheCanvasRef.current
    if (!cache || !cacheValidRef.current) {
      // 缓存本就无效 → 下次 render 会整体重建
      return
    }
    const ctx = cache.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const dpr = window.devicePixelRatio || 1
    const cam = cameraRef.current
    const k = dpr * cam.scale
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)
    drawStroke(ctx, stroke)
  }

  // ---- 当前"正在画"增量层 ----

  /** 判断 stroke 是否走增量 current-canvas 路径 */
  const isIncrementalStroke = (stroke: Stroke | null): boolean => {
    if (!stroke || stroke.tool !== 'pen') return false
    return (
      stroke.brush === 'stamp' ||
      stroke.brush === 'rainbow' ||
      stroke.brush === 'neon' ||
      stroke.brush === 'spray'
    )
  }

  const ensureCurrentCanvas = () => {
    const main = canvasRef.current
    if (!main) return
    let c = currentCanvasRef.current
    if (!c) {
      c = document.createElement('canvas')
      currentCanvasRef.current = c
    }
    if (c.width !== main.width || c.height !== main.height) {
      c.width = main.width
      c.height = main.height
    }
  }

  const clearCurrentCanvas = () => {
    const c = currentCanvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
  }

  /** 把当前 drawingRef stroke 的新增部分增量画到 currentCanvas */
  const paintCurrentIncremental = () => {
    const stroke = drawingRef.current
    if (!stroke || !isIncrementalStroke(stroke)) return
    ensureCurrentCanvas()
    const c = currentCanvasRef.current!
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const cam = cameraRef.current
    const k = dpr * cam.scale
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)
    drawStrokeIncremental(ctx, stroke, incrementalStateRef.current)
  }

  /** camera 变化时：清当前层并用当前 stroke 从头重画一次（保持视觉一致） */
  const repaintCurrentAfterCameraChange = () => {
    if (!drawingRef.current || !isIncrementalStroke(drawingRef.current)) return
    clearCurrentCanvas()
    incrementalStateRef.current = createIncrementalState()
    paintCurrentIncremental()
  }

  const render = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    ensureCache()
    const cache = cacheCanvasRef.current!

    // 清屏 + 贴缓存（已完成 stroke 全在里面）
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(cache, 0, 0)

    // 正在画的这一笔
    if (drawingRef.current) {
      if (isIncrementalStroke(drawingRef.current)) {
        // current-canvas 已由 pointermove 调用 paintCurrentIncremental 持续更新
        const cur = currentCanvasRef.current
        if (cur) ctx.drawImage(cur, 0, 0)
      } else {
        // pen/marker/eraser：每帧直接重画（便宜，一个 beginPath+stroke）
        const dpr = window.devicePixelRatio || 1
        const cam = cameraRef.current
        const k = dpr * cam.scale
        ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)
        drawStroke(ctx, drawingRef.current)
      }
    }
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
      // 只有"笔"设备（Apple Pencil / 电磁笔）才启用笔压渲染
      hasPressure: e.pointerType === 'pen',
      stampEmoji: cfg.brush === 'stamp' ? cfg.stamp : undefined,
      points: [toWorldPoint(e.clientX, e.clientY, e.pressure || undefined)],
    }
    // 增量画笔：清当前层 + 初始化状态 + 画第一个点
    if (isIncrementalStroke(drawingRef.current)) {
      clearCurrentCanvas()
      incrementalStateRef.current = createIncrementalState()
      paintCurrentIncremental()
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
      invalidateCache()
      repaintCurrentAfterCameraChange()
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
      invalidateCache()
      // 双指手势期间已在开头把 drawingRef 置为 null，不会有"正在画"层，
      // 这里保险起见也调一下，无副作用
      repaintCurrentAfterCameraChange()
      render()
      reportScaleIfChanged()
      return
    }

    // 3) 单指画线继续
    if (drawingRef.current && pointersRef.current.size === 1) {
      drawingRef.current.points.push(
        toWorldPoint(e.clientX, e.clientY, e.pressure || undefined),
      )
      // 增量画笔：只把新增的部分贴到当前层
      if (isIncrementalStroke(drawingRef.current)) {
        paintCurrentIncremental()
      }
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
      const committed = drawingRef.current
      strokesRef.current = [...strokesRef.current, committed]
      // 历史分叉：新画一笔后原来的 redo 栈无效
      redoStackRef.current = []
      drawingRef.current = null
      // 增量贴缓存：只画新这一条 stroke，不整体重建
      paintStrokeToCache(committed)
      // 如果是增量笔 → 清空当前层，下一条 stroke 从头来
      if (isIncrementalStroke(committed)) {
        clearCurrentCanvas()
        incrementalStateRef.current = createIncrementalState()
      }
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
  // 注：新增的 neon/rainbow/stamp/spray 复用圆头笔光标，精度够用

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

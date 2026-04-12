import { useRef, useState } from 'react'
import Board, { type BoardHandle } from './components/Board'
import Toolbar from './components/Toolbar'
import type { BrushType, ToolType } from './core/types'

// 男孩向调色板：鲜亮 + 基础黑，覆盖最常用的颜色
const PALETTE = [
  '#222222', // 黑
  '#ff4d4f', // 红
  '#ff9a3c', // 橙
  '#ffd84d', // 黄
  '#8ed36b', // 绿
  '#4fc1e9', // 蓝
  '#7e5bef', // 紫
  '#8b5a2b', // 棕
] as const

// 背景色：柔和不刺眼，适合长时间看
const BG_PALETTE = [
  '#fffdf5', // 米白（默认）
  '#fff4c2', // 浅黄
  '#e3f2fd', // 浅蓝
  '#e8f5e9', // 浅绿
  '#fde4ec', // 浅粉
  '#f0e6d2', // 牛皮纸
] as const

const SIZES = [3, 6, 12, 22] as const

function App() {
  const [tool, setTool] = useState<ToolType>('pen')
  const [brush, setBrush] = useState<BrushType>('round')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [size, setSize] = useState<number>(SIZES[1])
  const [bgColor, setBgColor] = useState<string>(BG_PALETTE[0])
  const [scale, setScale] = useState(1)
  const boardRef = useRef<BoardHandle>(null)

  return (
    <div className="app">
      <Board
        ref={boardRef}
        tool={tool}
        brush={brush}
        color={color}
        size={tool === 'eraser' ? Math.max(size * 2, 20) : size}
        bgColor={bgColor}
        onScaleChange={setScale}
      />
      <Toolbar
        tool={tool}
        brush={brush}
        color={color}
        size={size}
        scale={scale}
        bgColor={bgColor}
        palette={PALETTE}
        sizes={SIZES}
        bgPalette={BG_PALETTE}
        onToolChange={setTool}
        onBrushChange={(b) => {
          setBrush(b)
          setTool('pen') // 选笔刷时自动退出橡皮模式
        }}
        onColorChange={(c) => {
          setColor(c)
          setTool('pen') // 选颜色时自动退出橡皮模式
        }}
        onSizeChange={setSize}
        onBgColorChange={setBgColor}
        onUndo={() => boardRef.current?.undo()}
        onClear={() => {
          if (window.confirm('要清空整个画布吗？清空后无法恢复哦～')) {
            boardRef.current?.clear()
          }
        }}
        onResetView={() => boardRef.current?.resetView()}
        onExport={() => {
          void boardRef.current?.exportPng()
        }}
      />
    </div>
  )
}

export default App

import type { BrushType, ToolType } from '../core/types'
import StampPreview from './StampPreview'
import './Toolbar.css'

type Props = {
  tool: ToolType
  brush: BrushType
  color: string
  size: number
  scale: number
  bgColor: string
  palette: readonly string[]
  sizes: readonly number[]
  bgPalette: readonly string[]
  stamp: string
  stampPalette: readonly string[]
  onToolChange: (t: ToolType) => void
  onBrushChange: (b: BrushType) => void
  onColorChange: (c: string) => void
  onSizeChange: (s: number) => void
  onBgColorChange: (c: string) => void
  onStampChange: (emoji: string) => void
  canUndo: boolean
  canRedo: boolean
  collapsed: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onResetView: () => void
  onExport: () => void
  onToggleCollapse: () => void
}

/**
 * 卡通风工具栏，固定在屏幕底部中央。
 * 分 4 组：画笔类型 / 颜色 / 粗细 / 操作。
 */
export default function Toolbar(p: Props) {
  const isPen = p.tool === 'pen'

  if (p.collapsed) {
    return (
      <button
        className="toolbar-mini"
        onClick={p.onToggleCollapse}
        title="展开工具栏"
        aria-label="展开工具栏"
      >
        <span className="toolbar-mini-icon">🐯</span>
      </button>
    )
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="画板工具栏">
      {/* 画笔类型 */}
      <div className="group">
        <button
          className={`tool-btn ${isPen && p.brush === 'round' ? 'active' : ''}`}
          onClick={() => p.onBrushChange('round')}
          title="圆头笔"
          aria-label="圆头笔"
        >
          ✏️
        </button>
        <button
          className={`tool-btn ${isPen && p.brush === 'marker' ? 'active' : ''}`}
          onClick={() => p.onBrushChange('marker')}
          title="马克笔"
          aria-label="马克笔"
        >
          🖍️
        </button>
        <button
          className={`tool-btn ${isPen && p.brush === 'neon' ? 'active' : ''}`}
          onClick={() => p.onBrushChange('neon')}
          title="霓虹笔"
          aria-label="霓虹笔"
        >
          ✨
        </button>
        <button
          className={`tool-btn ${isPen && p.brush === 'rainbow' ? 'active' : ''}`}
          onClick={() => p.onBrushChange('rainbow')}
          title="彩虹笔"
          aria-label="彩虹笔"
        >
          🌈
        </button>
        <button
          className={`tool-btn ${isPen && p.brush === 'stamp' ? 'active' : ''}`}
          onClick={() => p.onBrushChange('stamp')}
          title="图章笔"
          aria-label="图章笔"
        >
          🌟
        </button>
        <button
          className={`tool-btn ${isPen && p.brush === 'spray' ? 'active' : ''}`}
          onClick={() => p.onBrushChange('spray')}
          title="喷漆笔"
          aria-label="喷漆笔"
        >
          💨
        </button>
        <button
          className={`tool-btn ${p.tool === 'eraser' ? 'active' : ''}`}
          onClick={() => p.onToolChange('eraser')}
          title="橡皮擦"
          aria-label="橡皮擦"
        >
          🧽
        </button>
      </div>

      <div className="divider" />

      {/* 颜色 or 图章 emoji（图章笔时替换为 emoji 选择） */}
      {isPen && p.brush === 'stamp' ? (
        <div className="group">
          {p.stampPalette.map((stamp) => (
            <button
              key={stamp}
              className={`stamp-btn ${p.stamp === stamp ? 'active' : ''}`}
              onClick={() => p.onStampChange(stamp)}
              aria-label={`图章 ${stamp}`}
              title={`图章 ${stamp}`}
            >
              <StampPreview stamp={stamp} />
            </button>
          ))}
        </div>
      ) : (
        <div className="group">
          {p.palette.map((c) => (
            <button
              key={c}
              className={`color-btn ${
                isPen && p.color === c ? 'active' : ''
              }`}
              style={{ background: c }}
              onClick={() => p.onColorChange(c)}
              aria-label={`颜色 ${c}`}
            />
          ))}
        </div>
      )}

      <div className="divider" />

      {/* 背景色 */}
      <div className="group">
        {p.bgPalette.map((c) => (
          <button
            key={c}
            className={`bg-btn ${p.bgColor === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => p.onBgColorChange(c)}
            title="切换背景色"
            aria-label={`背景色 ${c}`}
          />
        ))}
      </div>

      <div className="divider" />

      {/* 粗细 */}
      <div className="group">
        {p.sizes.map((s) => (
          <button
            key={s}
            className={`size-btn ${p.size === s ? 'active' : ''}`}
            onClick={() => p.onSizeChange(s)}
            title={`粗细 ${s}`}
            aria-label={`粗细 ${s}`}
          >
            <span
              className="size-dot"
              style={{
                width: Math.max(6, Math.min(s * 1.3, 28)),
                height: Math.max(6, Math.min(s * 1.3, 28)),
                background: p.tool === 'eraser' ? '#bbb' : p.color,
              }}
            />
          </button>
        ))}
      </div>

      <div className="divider" />

      {/* 操作 */}
      <div className="group">
        <button
          className="tool-btn"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title="撤销 (Ctrl/Cmd+Z)"
          aria-label="撤销"
        >
          ↩️
        </button>
        <button
          className="tool-btn"
          onClick={p.onRedo}
          disabled={!p.canRedo}
          title="重做 (Ctrl/Cmd+Shift+Z)"
          aria-label="重做"
        >
          ↪️
        </button>
        <button
          className="tool-btn save"
          onClick={p.onExport}
          title="保存为 PNG (Ctrl/Cmd+S)"
          aria-label="保存为 PNG"
        >
          💾
        </button>
        <button
          className="zoom-btn"
          onClick={p.onResetView}
          title="回到原始视图"
          aria-label="回到原始视图"
        >
          <span className="zoom-icon">🎯</span>
          <span className="zoom-label">{Math.round(p.scale * 100)}%</span>
        </button>
        <button
          className="tool-btn danger"
          onClick={p.onClear}
          title="清空"
          aria-label="清空"
        >
          🗑️
        </button>
        <button
          className="tool-btn collapse"
          onClick={p.onToggleCollapse}
          title="收起工具栏"
          aria-label="收起工具栏"
        >
          ⬇️
        </button>
      </div>
    </div>
  )
}

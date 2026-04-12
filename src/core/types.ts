// 画板核心数据类型

export type Point = {
  x: number
  y: number
  pressure?: number
}

export type ToolType = 'pen' | 'eraser'

/** 画笔类型：圆头笔 / 马克笔 */
export type BrushType = 'round' | 'marker'

export type Stroke = {
  id: string
  tool: ToolType
  brush: BrushType
  color: string
  /** 最大线宽（有压力时这是笔压 1.0 对应的宽度） */
  size: number
  /** 是否启用笔压渲染。只有 pointerType === 'pen' 时为 true */
  hasPressure?: boolean
  points: Point[]
}

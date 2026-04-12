// 画板核心数据类型

export type Point = {
  x: number
  y: number
  pressure?: number
}

export type ToolType = 'pen' | 'eraser'

/** 画笔类型 */
export type BrushType =
  | 'round' // 圆头笔
  | 'marker' // 马克笔
  | 'neon' // 霓虹/荧光
  | 'rainbow' // 彩虹
  | 'stamp' // 图章
  | 'spray' // 喷漆

export type Stroke = {
  id: string
  tool: ToolType
  brush: BrushType
  color: string
  /** 最大线宽（有压力时这是笔压 1.0 对应的宽度） */
  size: number
  /** 是否启用笔压渲染。只有 pointerType === 'pen' 时为 true */
  hasPressure?: boolean
  /** 图章笔使用的 emoji，仅 brush === 'stamp' 时有意义 */
  stampEmoji?: string
  points: Point[]
}

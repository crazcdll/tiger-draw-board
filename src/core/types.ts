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
  size: number
  points: Point[]
}

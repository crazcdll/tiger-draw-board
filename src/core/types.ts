// 画板核心数据类型

export type Point = {
  x: number
  y: number
  pressure?: number
}

export type ToolType = 'pen' | 'eraser'

export type Stroke = {
  id: string
  tool: ToolType
  color: string
  size: number
  points: Point[]
}

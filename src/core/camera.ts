// 画布相机：把"屏幕像素坐标"与"世界坐标"解耦
//
// world 坐标系 = 画布内容真正存在的那个无限大平面
// screen 坐标系 = canvas 元素的 CSS 像素坐标（左上角是 0,0）
//
// 所有 Stroke 的点都以 world 坐标存储，渲染前通过 ctx.setTransform 映射到屏幕。

export type Camera = {
  /** 屏幕 (0,0) 对应的世界 x */
  x: number
  /** 屏幕 (0,0) 对应的世界 y */
  y: number
  /** 缩放倍数，1 = 原始大小 */
  scale: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 4

export const clampScale = (s: number): number =>
  Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

export const screenToWorld = (
  cam: Camera,
  sx: number,
  sy: number,
): { x: number; y: number } => ({
  x: sx / cam.scale + cam.x,
  y: sy / cam.scale + cam.y,
})

/**
 * 以屏幕上某一点为中心缩放：保证该屏幕点下方的世界坐标在缩放前后不变。
 * 这是所有"围绕鼠标/手指捏合点"缩放的通用公式。
 */
export const zoomAt = (
  cam: Camera,
  screenX: number,
  screenY: number,
  factor: number,
): Camera => {
  const newScale = clampScale(cam.scale * factor)
  if (newScale === cam.scale) return cam
  const world = screenToWorld(cam, screenX, screenY)
  return {
    scale: newScale,
    x: world.x - screenX / newScale,
    y: world.y - screenY / newScale,
  }
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1 }

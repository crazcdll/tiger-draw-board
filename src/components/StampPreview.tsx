import { useEffect, useRef } from 'react'
import { drawProceduralStamp, isProceduralStamp } from '../core/draw'

/**
 * 图章按钮里的预览。
 * - emoji 类型 → 直接当 span 文字渲染
 * - 程序化图章（比熊等）→ 开一个小 canvas，mount 时 drawProceduralStamp 画上去
 */
export default function StampPreview({ stamp }: { stamp: string }) {
  if (isProceduralStamp(stamp)) {
    return <ProceduralPreview stamp={stamp} />
  }
  return <span className="stamp-emoji">{stamp}</span>
}

function ProceduralPreview({ stamp }: { stamp: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    // 手机窄屏时按钮变小，预览 canvas 跟着变小
    const isPhone =
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 640px)').matches
    const cssSize = isPhone ? 24 : 30
    c.width = cssSize * dpr
    c.height = cssSize * dpr
    c.style.width = `${cssSize}px`
    c.style.height = `${cssSize}px`
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssSize, cssSize)
    drawProceduralStamp(ctx, stamp, cssSize / 2, cssSize / 2, cssSize * 0.9)
  }, [stamp])

  return <canvas ref={ref} className="stamp-proc" />
}

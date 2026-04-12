import { useEffect } from 'react'
import './ConfirmDialog.css'

type Props = {
  open: boolean
  emoji?: string
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 确认按钮是否用危险色（红） */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用卡通风确认弹窗。
 * - 点击遮罩或按 Esc 等同于取消
 * - 打开时 body 禁用滚动（本项目已 overflow:hidden，主要是防御）
 */
export default function ConfirmDialog({
  open,
  emoji = '🐯',
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="confirm-backdrop"
      onPointerDown={(e) => {
        // 只有点在遮罩本身才算取消，点到卡片上不算
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="confirm-emoji" aria-hidden>
          {emoji}
        </div>
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        {description && <p className="confirm-desc">{description}</p>}
        <div className="confirm-actions">
          <button
            className="confirm-btn cancel"
            onClick={onCancel}
            autoFocus
          >
            {cancelText}
          </button>
          <button
            className={`confirm-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

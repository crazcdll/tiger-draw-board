import './Header.css'

/**
 * 左上角 logo：老虎头 emoji + 标题。
 * 整个元素 pointer-events: none，不会拦截画布的触摸/鼠标事件。
 */
export default function Header() {
  return (
    <div className="app-header" aria-hidden>
      <span className="app-header-emoji">🐯</span>
      <span className="app-header-title">小虎画板</span>
    </div>
  )
}

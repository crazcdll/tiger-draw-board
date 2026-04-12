// 本地持久化：把 strokes 和背景色存进 localStorage
//
// 单 key 单 JSON blob 设计，带 version 字段便于未来数据迁移。
// 所有 API 出错都静默吞异常（配额超限、隐私模式等），保证不影响主流程。

import type { Stroke } from './types'

const KEY = 'tiger-draw-board:v1'

type PersistedV1 = {
  version: 1
  strokes: Stroke[]
  bgColor: string
}

const DEFAULT: PersistedV1 = {
  version: 1,
  strokes: [],
  bgColor: '#fffdf5',
}

function readAll(): PersistedV1 {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT }
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return { ...DEFAULT }
    return {
      version: 1,
      strokes: Array.isArray(parsed.strokes) ? parsed.strokes : [],
      bgColor: typeof parsed.bgColor === 'string' ? parsed.bgColor : DEFAULT.bgColor,
    }
  } catch {
    return { ...DEFAULT }
  }
}

function writeAll(patch: Partial<PersistedV1>): void {
  try {
    const current = readAll()
    const next: PersistedV1 = { ...current, ...patch, version: 1 }
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 配额超限 / 隐私模式 / 被禁用：静默忽略
  }
}

export function loadStrokes(): Stroke[] {
  return readAll().strokes
}

export function saveStrokes(strokes: Stroke[]): void {
  writeAll({ strokes })
}

export function loadBgColor(): string {
  return readAll().bgColor
}

export function saveBgColor(bgColor: string): void {
  writeAll({ bgColor })
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 忽略
  }
}

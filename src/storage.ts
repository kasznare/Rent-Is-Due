import { DEFAULT_CONFIG } from './game/data'
import type { GameConfig, GameState, LastMatchSnapshot } from './game/types'

const DRAFT_KEY = 'rent-is-due:draft'
const GAME_KEY = 'rent-is-due:game'
const LAST_MATCH_KEY = 'rent-is-due:last-match'
const TUTORIAL_KEY = 'rent-is-due:tutorial-dismissed'

const hasStorage = () => typeof window !== 'undefined' && 'localStorage' in window

const readJson = <T,>(key: string): T | null => {
  if (!hasStorage()) {
    return null
  }

  const raw = window.localStorage.getItem(key)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const writeJson = (key: string, value: unknown) => {
  if (!hasStorage()) {
    return
  }

  window.localStorage.setItem(key, JSON.stringify(value))
}

export const loadDraft = () => {
  const stored = readJson<Partial<GameConfig>>(DRAFT_KEY)

  return {
    ...DEFAULT_CONFIG,
    ...stored,
  }
}

export const saveDraft = (draft: GameConfig) => {
  writeJson(DRAFT_KEY, draft)
}

export const loadSavedGame = () => readJson<GameState>(GAME_KEY)

export const saveGame = (game: GameState | null) => {
  if (!hasStorage()) {
    return
  }

  if (game) {
    writeJson(GAME_KEY, game)
    return
  }

  window.localStorage.removeItem(GAME_KEY)
}

export const loadLastMatch = () => readJson<LastMatchSnapshot>(LAST_MATCH_KEY)

export const saveLastMatch = (snapshot: LastMatchSnapshot) => {
  writeJson(LAST_MATCH_KEY, snapshot)
}

export const loadTutorialDismissed = () => {
  if (!hasStorage()) {
    return false
  }

  return window.localStorage.getItem(TUTORIAL_KEY) === 'true'
}

export const saveTutorialDismissed = (dismissed: boolean) => {
  if (!hasStorage()) {
    return
  }

  window.localStorage.setItem(TUTORIAL_KEY, dismissed ? 'true' : 'false')
}

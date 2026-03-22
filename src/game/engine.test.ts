import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './data'
import {
  advanceTick,
  createInitialGame,
  performPropertyStrategy,
  performPropertyUpgrade,
  performSupportTransfer,
} from './engine'
import type { GameConfig, GameState } from './types'

const createConfig = (overrides: Partial<GameConfig> = {}): GameConfig => ({
  ...DEFAULT_CONFIG,
  playerName: 'Spec',
  aiCount: 2,
  totalRounds: 4,
  seed: 'alpha-seed',
  ...overrides,
})

const advanceManyTicks = (game: GameState, count: number) => {
  let current = game

  for (let tick = 0; tick < count; tick += 1) {
    current = advanceTick(current)
  }

  return current
}

const snapshotGame = (game: GameState) => ({
  round: game.round,
  tick: game.tick,
  tickInRound: game.tickInRound,
  headline: game.currentHeadline,
  alerts: game.alerts,
  summaries: game.roundSummaries,
  players: game.players.map((player) => ({
    id: player.id,
    cash: player.cash,
    debt: player.debt,
    position: player.position,
    stability: player.stability,
    score: player.score,
    trustInHuman: player.trustInHuman,
    peerLoan: player.peerLoan,
  })),
  tiles: game.tiles.map((tile) => ({
    id: tile.id,
    currentRent: tile.currentRent,
    ownerId: tile.ownerId,
    listed: tile.listed,
    upgradeLevel: tile.upgradeLevel,
    strategy: tile.strategy,
  })),
})

describe('engine', () => {
  it('replays the same run for the same seed', () => {
    const config = createConfig()
    const first = advanceManyTicks(createInitialGame(config), 30)
    const second = advanceManyTicks(createInitialGame(config), 30)

    expect(snapshotGame(first)).toEqual(snapshotGame(second))
  })

  it('records a round summary after a completed round', () => {
    const next = advanceManyTicks(createInitialGame(createConfig()), 20)

    expect(next.round).toBe(2)
    expect(next.roundSummaries).toHaveLength(1)
    expect(next.roundSummaries[0]?.round).toBe(1)
    expect(next.roundSummaries[0]?.players.length).toBe(3)
  })

  it('upgrades owned properties and toggles property strategy', () => {
    const game = createInitialGame(createConfig())
    const human = game.players[0]
    const targetTile = game.tiles[1]

    targetTile.ownerId = human.id
    targetTile.listed = false
    human.ownedTileIds = [targetTile.id]
    human.livingStatus = 'owner'
    human.cash = 1000

    const upgraded = performPropertyUpgrade(game, targetTile.id)
    expect(upgraded.tiles[1]?.upgradeLevel).toBe(1)
    expect(upgraded.players[0]?.cash).toBeLessThan(1000)

    const stabilized = performPropertyStrategy(upgraded, targetTile.id, 'stabilize')
    expect(stabilized.tiles[1]?.strategy).toBe('stabilize')
  })

  it('lets the player buy trust with support transfers', () => {
    const game = createInitialGame(createConfig())
    game.players[0].cash = 100

    const next = performSupportTransfer(game, game.players[1]!.id)

    expect(next.players[0]?.cash).toBe(76)
    expect(next.players[1]?.trustInHuman).toBeGreaterThan(
      game.players[1]?.trustInHuman ?? 0,
    )
  })
})

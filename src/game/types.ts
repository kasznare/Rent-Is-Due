export type JobId = 'corporate' | 'retail' | 'creator' | 'freelance'

export type Archetype =
  | 'stability'
  | 'opportunist'
  | 'social'
  | 'asset-hunter'

export type TileType = 'start' | 'property' | 'event' | 'market'

export type Demand = 'low' | 'medium' | 'high'

export type LoanSize = 'small' | 'large'

export type Tone = 'good' | 'neutral' | 'warn' | 'bad'

export type PropertyStrategy = 'extract' | 'stabilize'

export interface JobProfile {
  id: JobId
  name: string
  tagline: string
  salary: number
  moveCooldown: number
  workLock: number
  gigBonus: number
  stabilityDelta: number
}

export interface TileDefinition {
  id: number
  name: string
  district: string
  type: TileType
  demand: Demand
  baseRent: number
  growth: number
  marketPrice: number
  flavor: string
  gridX: number
  gridY: number
  skyline: number
}

export interface TileState extends TileDefinition {
  currentRent: number
  ownerId: string | null
  listed: boolean
  upgradeLevel: number
  strategy: PropertyStrategy
}

export interface ActiveEffect {
  id: string
  title: string
  description: string
  remainingRounds: number
  incomeMultiplier?: number
  gigMultiplier?: number
  interestDelta?: number
  rentGrowthBonus?: number
  livingCostMultiplier?: number
  marketDiscount?: number
}

export interface MarketListing {
  tileId: number
  price: number
  expiresRound: number
  tag: string
}

export interface PendingMove {
  playerId: string
  rolledSteps: number
  stepsRemaining: number
  cursorPosition: number
  route: number[]
}

export interface PeerLoan {
  lenderId: string
  amount: number
  dueRound: number
}

export interface PlayerState {
  id: string
  name: string
  color: string
  isHuman: boolean
  archetype: Archetype
  jobId: JobId
  cash: number
  debt: number
  creditScore: number
  stability: number
  position: number
  moveCooldown: number
  gigCooldown: number
  workLock: number
  skipActions: number
  survivalRounds: number
  livingStatus: 'solo' | 'roommates' | 'owner'
  roommateWith: string | null
  defaultedThisRound: boolean
  ownedTileIds: number[]
  trustInHuman: number
  peerLoan?: PeerLoan
  score: number
}

export interface LogEntry {
  id: string
  round: number
  tone: Tone
  message: string
}

export interface GameConfig {
  playerName: string
  jobId: JobId
  totalRounds: number
  aiCount: number
  seed: string
}

export interface RoundPlayerSnapshot {
  id: string
  name: string
  cash: number
  debt: number
  stability: number
  score: number
  ownedAssets: number
  livingStatus: PlayerState['livingStatus']
}

export interface RoundSummary {
  id: string
  round: number
  headline: string | null
  notes: string[]
  players: RoundPlayerSnapshot[]
}

export interface LastMatchSnapshot {
  seed: string
  finishedAt: string
  totalRounds: number
  winnerName: string
  winnerScore: number
  summaries: RoundSummary[]
}

export interface GameState {
  phase: 'running' | 'finished'
  config: GameConfig
  seed: number
  rngState: number
  nextId: number
  round: number
  totalRounds: number
  tick: number
  tickInRound: number
  gameSecondsElapsed: number
  tiles: TileState[]
  players: PlayerState[]
  pendingMove: PendingMove | null
  marketListings: MarketListing[]
  activeEffects: ActiveEffect[]
  currentHeadline: string | null
  alerts: string[]
  logs: LogEntry[]
  roundSummaries: RoundSummary[]
  winnerId: string | null
}

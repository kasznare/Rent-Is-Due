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
}

export interface TileState extends TileDefinition {
  currentRent: number
  ownerId: string | null
  listed: boolean
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
}

export interface GameState {
  phase: 'running' | 'finished'
  config: GameConfig
  round: number
  totalRounds: number
  tick: number
  tickInRound: number
  gameSecondsElapsed: number
  tiles: TileState[]
  players: PlayerState[]
  marketListings: MarketListing[]
  activeEffects: ActiveEffect[]
  currentHeadline: string | null
  alerts: string[]
  logs: LogEntry[]
  winnerId: string | null
}

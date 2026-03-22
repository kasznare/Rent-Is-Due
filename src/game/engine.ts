import {
  AI_ROSTER,
  GAME_SECONDS_PER_TICK,
  JOBS,
  MAX_LOGS,
  TILE_DEFINITIONS,
  TICKS_PER_ROUND,
} from './data'
import type {
  ActiveEffect,
  Archetype,
  GameConfig,
  GameState,
  LastMatchSnapshot,
  LoanSize,
  LogEntry,
  MarketListing,
  PlayerState,
  PropertyStrategy,
  RoundSummary,
  Tone,
} from './types'

const HUMAN_ID = 'human'
const MAX_ROUND_SUMMARIES = 8
const MAX_PROPERTY_UPGRADE = 2
const SUPPORT_TRANSFER = 24

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const money = (amount: number) => `$${Math.round(amount)}`

const normalizeSeed = (value: string) => value.trim().toLowerCase() || 'rent-is-due'

export const createSeedFromText = (value: string) => {
  let seed = 1779033703 ^ normalizeSeed(value).length

  for (let index = 0; index < normalizeSeed(value).length; index += 1) {
    seed = Math.imul(seed ^ normalizeSeed(value).charCodeAt(index), 3432918353)
    seed = (seed << 13) | (seed >>> 19)
  }

  seed = Math.imul(seed ^ (seed >>> 16), 2246822507)
  seed = Math.imul(seed ^ (seed >>> 13), 3266489909)
  seed ^= seed >>> 16
  return seed >>> 0
}

const nextRandom = (state: GameState) => {
  let next = (state.rngState += 0x6d2b79f5)
  next = Math.imul(next ^ (next >>> 15), next | 1)
  next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
  return ((next ^ (next >>> 14)) >>> 0) / 4294967296
}

const randInt = (state: GameState, min: number, max: number) =>
  Math.floor(nextRandom(state) * (max - min + 1)) + min

const chance = (state: GameState, value: number) => nextRandom(state) < value

const weightedPick = <T,>(state: GameState, items: T[]) =>
  items[Math.floor(nextRandom(state) * items.length)]

const shuffle = <T,>(state: GameState, items: T[]) => {
  const next = [...items]

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom(state) * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

const nextId = (state: GameState, prefix: string) => `${prefix}-${state.nextId++}`

const getHuman = (state: GameState) =>
  state.players.find((player) => player.id === HUMAN_ID)

const getPlayer = (state: GameState, playerId: string) =>
  state.players.find((player) => player.id === playerId)

const getTile = (state: GameState, tileId: number) =>
  state.tiles.find((tile) => tile.id === tileId)

const getOwnedTiles = (state: GameState, playerId: string) =>
  state.tiles.filter((tile) => tile.ownerId === playerId)

const getEconomySnapshot = (effects: ActiveEffect[]) =>
  effects.reduce(
    (snapshot, effect) => ({
      incomeMultiplier:
        snapshot.incomeMultiplier * (effect.incomeMultiplier ?? 1),
      gigMultiplier: snapshot.gigMultiplier * (effect.gigMultiplier ?? 1),
      interestDelta: snapshot.interestDelta + (effect.interestDelta ?? 0),
      rentGrowthBonus:
        snapshot.rentGrowthBonus + (effect.rentGrowthBonus ?? 0),
      livingCostMultiplier:
        snapshot.livingCostMultiplier * (effect.livingCostMultiplier ?? 1),
      marketDiscount: snapshot.marketDiscount * (effect.marketDiscount ?? 1),
    }),
    {
      incomeMultiplier: 1,
      gigMultiplier: 1,
      interestDelta: 0,
      rentGrowthBonus: 0,
      livingCostMultiplier: 1,
      marketDiscount: 1,
    },
  )

const addLog = (state: GameState, message: string, tone: Tone = 'neutral') => {
  const entry: LogEntry = {
    id: nextId(state, 'log'),
    round: state.round,
    tone,
    message,
  }
  state.logs = [entry, ...state.logs].slice(0, MAX_LOGS)
}

const addAlert = (state: GameState, message: string) => {
  state.alerts = [message, ...state.alerts].slice(0, 4)
}

const normalizePlayerState = (player: PlayerState) => {
  player.cash = Math.max(0, Math.round(player.cash))
  player.debt = Math.max(0, Math.round(player.debt))
  player.creditScore = clamp(Math.round(player.creditScore), 350, 850)
  player.stability = clamp(Math.round(player.stability), 0, 100)
  player.moveCooldown = Math.max(0, Math.round(player.moveCooldown))
  player.gigCooldown = Math.max(0, Math.round(player.gigCooldown))
  player.workLock = Math.max(0, Math.round(player.workLock))
  player.skipActions = Math.max(0, Math.round(player.skipActions))
  player.survivalRounds = Math.max(0, Math.round(player.survivalRounds))
  player.trustInHuman = clamp(Math.round(player.trustInHuman), 0, 100)
}

const getMoveCooldown = (player: PlayerState) => {
  const base = JOBS[player.jobId].moveCooldown
  const stabilityPenalty = player.stability < 36 ? 1 : 0
  const survivalPenalty = player.survivalRounds > 0 ? 1 : 0
  return base + stabilityPenalty + survivalPenalty
}

const getGigCooldown = (player: PlayerState) =>
  Math.max(1, player.jobId === 'freelance' ? 1 : 2)

const getLivingCost = (
  player: PlayerState,
  livingCostMultiplier: number,
) => {
  let cost = 7

  if (player.livingStatus === 'roommates') {
    cost = 4
  }

  if (player.livingStatus === 'owner') {
    cost = 3
  }

  if (player.survivalRounds > 0) {
    cost *= 0.72
  }

  return Math.max(2, Math.round(cost * livingCostMultiplier))
}

const getUpgradeCost = (tile: GameState['tiles'][number]) =>
  Math.round(tile.marketPrice * (0.24 + tile.upgradeLevel * 0.11))

const getPassiveIncomeFromTile = (tile: GameState['tiles'][number]) => {
  if (tile.ownerId === null) {
    return 0
  }

  const baseYield = 0.1 + tile.upgradeLevel * 0.03
  const strategyMultiplier = tile.strategy === 'extract' ? 1.08 : 0.92
  return Math.max(2, Math.round(tile.currentRent * baseYield * strategyMultiplier))
}

const getPassiveIncome = (state: GameState, player: PlayerState) =>
  getOwnedTiles(state, player.id).reduce(
    (total, tile) => total + getPassiveIncomeFromTile(tile),
    0,
  )

const triggerRoommatePenalty = (state: GameState, player: PlayerState) => {
  if (!player.roommateWith) {
    return
  }

  const roommate = getPlayer(state, player.roommateWith)

  if (!roommate) {
    player.roommateWith = null
    player.livingStatus = player.ownedTileIds.length > 0 ? 'owner' : 'solo'
    return
  }

  roommate.stability -= 6
  roommate.creditScore -= 5
  roommate.roommateWith = null
  roommate.livingStatus = roommate.ownedTileIds.length > 0 ? 'owner' : 'solo'
  player.roommateWith = null
  player.livingStatus = player.ownedTileIds.length > 0 ? 'owner' : 'solo'
  addLog(
    state,
    `${player.name} defaulted and dragged ${roommate.name} into the fallout.`,
    'bad',
  )
}

const liquidateAsset = (state: GameState, player: PlayerState) => {
  const mostValuableTile = getOwnedTiles(state, player.id).sort(
    (left, right) => right.marketPrice - left.marketPrice,
  )[0]

  if (!mostValuableTile) {
    return false
  }

  mostValuableTile.ownerId = null
  mostValuableTile.listed = false
  mostValuableTile.upgradeLevel = 0
  mostValuableTile.strategy = 'extract'
  player.ownedTileIds = player.ownedTileIds.filter(
    (ownedTileId) => ownedTileId !== mostValuableTile.id,
  )
  player.cash += Math.round(mostValuableTile.marketPrice * 0.66)
  player.livingStatus = player.ownedTileIds.length > 0 ? 'owner' : 'solo'
  addLog(
    state,
    `${player.name} liquidated ${mostValuableTile.name} for ${money(
      mostValuableTile.marketPrice * 0.66,
    )}.`,
    'warn',
  )
  return true
}

const defaultPlayer = (
  state: GameState,
  player: PlayerState,
  reason: string,
  recipientId?: string,
) => {
  if (player.ownedTileIds.length > 0) {
    liquidateAsset(state, player)
  }

  if (recipientId && player.cash > 0) {
    const recipient = getPlayer(state, recipientId)
    if (recipient) {
      recipient.cash += player.cash
    }
    player.cash = 0
  }

  player.defaultedThisRound = true
  player.creditScore -= 20
  player.stability -= 12
  player.survivalRounds = Math.max(player.survivalRounds, 2)
  addLog(state, `${player.name} defaulted on ${reason}.`, 'bad')

  if (player.isHuman) {
    addAlert(state, `Defaulted on ${reason}. Survival Mode engaged.`)
  }

  triggerRoommatePenalty(state, player)
}

const issueEmergencyLoan = (
  state: GameState,
  player: PlayerState,
  amountNeeded: number,
  reason: string,
) => {
  const riskGate = player.creditScore - player.debt * 0.12

  if (riskGate < 360) {
    return false
  }

  const principal = Math.ceil(amountNeeded * 1.18)
  player.cash += principal
  player.debt += principal
  player.creditScore -= 5
  addLog(
    state,
    `${player.name} auto-financed ${money(principal)} to cover ${reason}.`,
    'warn',
  )
  return true
}

const settlePayment = (
  state: GameState,
  playerId: string,
  amount: number,
  reason: string,
  recipientId?: string,
) => {
  if (amount <= 0) {
    return true
  }

  const player = getPlayer(state, playerId)

  if (!player) {
    return false
  }

  if (player.cash < amount) {
    const approved = issueEmergencyLoan(state, player, amount - player.cash, reason)

    if (!approved) {
      defaultPlayer(state, player, reason, recipientId)
      normalizePlayerState(player)
      return false
    }
  }

  if (player.cash < amount) {
    defaultPlayer(state, player, reason, recipientId)
    normalizePlayerState(player)
    return false
  }

  player.cash -= amount

  if (recipientId) {
    const recipient = getPlayer(state, recipientId)
    if (recipient) {
      recipient.cash += amount
    }
  }

  normalizePlayerState(player)
  return true
}

const createListing = (
  state: GameState,
  tag: string,
  priceFactor: number,
  duration = 2,
) => {
  const economy = getEconomySnapshot(state.activeEffects)
  const availableTiles = state.tiles.filter(
    (tile) => tile.type === 'property' && tile.ownerId === null && !tile.listed,
  )

  if (availableTiles.length === 0) {
    return
  }

  const tile = weightedPick(state, availableTiles)
  tile.listed = true
  const price = Math.round(
    tile.marketPrice *
      priceFactor *
      economy.marketDiscount *
      (1 + Math.max(0, state.round - 1) * 0.035),
  )
  const listing: MarketListing = {
    tileId: tile.id,
    price,
    expiresRound: state.round + duration,
    tag,
  }
  state.marketListings = [listing, ...state.marketListings].slice(0, 4)
  addLog(
    state,
    `${tile.name} hit the market for ${money(price)}. ${tag}.`,
    'neutral',
  )
}

const processLanding = (state: GameState, player: PlayerState) => {
  const tile = getTile(state, player.position)

  if (!tile) {
    return
  }

  if (tile.type === 'start') {
    player.cash += 32
    player.stability += 2
    addLog(
      state,
      `${player.name} grabbed a breathing-space bonus at Payday Square.`,
      'good',
    )
    return
  }

  if (tile.type === 'event') {
    const eventRoll = randInt(state, 1, 5)

    if (eventRoll === 1) {
      const expense = randInt(state, 18, 42)
      settlePayment(state, player.id, expense, 'a surprise medical bill')
      addLog(state, `${player.name} ate a ${money(expense)} medical expense.`, 'bad')
      return
    }

    if (eventRoll === 2) {
      const payout = randInt(state, 28, 74)
      player.cash += payout
      player.stability += 4
      addLog(state, `${player.name} caught a viral spike worth ${money(payout)}.`, 'good')
      return
    }

    if (eventRoll === 3) {
      player.stability -= 8
      player.skipActions += 1
      addLog(state, `${player.name} doomscrolled into burnout.`, 'warn')
      return
    }

    if (eventRoll === 4) {
      player.creditScore += 10
      player.cash += 16
      addLog(
        state,
        `${player.name} squeezed a tiny bureaucratic win out of the system.`,
        'good',
      )
      return
    }

    createListing(state, 'Flash sale', 1.02, 1)
    addLog(state, `${player.name} uncovered a market whisper at ${tile.name}.`, 'neutral')
    return
  }

  if (tile.type === 'market') {
    createListing(state, 'Auction pressure', 0.95, 2)
    player.stability += 3
    addLog(state, `${player.name} stirred the Auction Block.`, 'neutral')
    return
  }

  if (tile.ownerId === player.id) {
    player.stability += tile.strategy === 'stabilize' ? 3 : 1
    addLog(state, `${player.name} landed on ${tile.name} and paid nobody.`, 'good')
    return
  }

  const rent = tile.currentRent
  const owner = tile.ownerId ? getPlayer(state, tile.ownerId) : null
  const recipientId = owner?.id
  settlePayment(state, player.id, rent, `rent at ${tile.name}`, recipientId)

  if (owner) {
    if (!owner.isHuman && tile.strategy === 'stabilize') {
      owner.stability += 1
    }

    if (owner.isHuman) {
      const payerTrustDelta = tile.strategy === 'stabilize' ? 2 : 0
      player.trustInHuman += payerTrustDelta
    }

    addLog(
      state,
      `${player.name} paid ${money(rent)} to ${owner.name} at ${tile.name}.`,
      owner.isHuman ? 'good' : 'warn',
    )
  } else {
    addLog(state, `${player.name} paid ${money(rent)} to The Market at ${tile.name}.`, 'warn')
  }
}

const movePlayer = (state: GameState, playerId: string) => {
  const player = getPlayer(state, playerId)

  if (!player) {
    return
  }

  if (player.workLock > 0 || player.skipActions > 0 || player.moveCooldown > 0) {
    if (player.isHuman) {
      addAlert(
        state,
        'You are locked out right now. Work, burnout, or cooldown is eating the move window.',
      )
    }
    return
  }

  const roll = randInt(state, 1, 6)
  const previousPosition = player.position
  player.position = (player.position + roll) % state.tiles.length
  player.moveCooldown = getMoveCooldown(player)

  if (player.position < previousPosition) {
    player.cash += 55
    player.stability += 2
    addLog(state, `${player.name} looped the board and banked ${money(55)}.`, 'good')
  }

  addLog(state, `${player.name} moved ${roll} spaces.`, player.isHuman ? 'neutral' : 'good')
  processLanding(state, player)
  normalizePlayerState(player)
}

const gigForPlayer = (state: GameState, playerId: string) => {
  const player = getPlayer(state, playerId)

  if (!player) {
    return
  }

  if (player.workLock > 0 || player.skipActions > 0 || player.gigCooldown > 0) {
    if (player.isHuman) {
      addAlert(
        state,
        'No gig slot available. You are either working, burned out, or on cooldown.',
      )
    }
    return
  }

  const economy = getEconomySnapshot(state.activeEffects)
  const job = JOBS[player.jobId]
  let payout = randInt(state, 24, 56)
  payout *= 1 + job.gigBonus
  payout *= economy.gigMultiplier

  if (player.survivalRounds > 0) {
    payout *= 0.84
  }

  const crash = chance(state, 0.11)
  const stabilityCost = randInt(state, 2, 5)

  if (crash) {
    payout *= 0.6
    player.stability -= stabilityCost + 2
    addLog(state, `${player.name} took a low-rated gig hit.`, 'warn')
  } else {
    player.stability -= stabilityCost
  }

  player.cash += Math.round(payout)
  player.gigCooldown = getGigCooldown(player)
  addLog(state, `${player.name} pulled ${money(payout)} from gig work.`, 'good')
  normalizePlayerState(player)
}

const getLoanRate = (
  state: GameState,
  player: PlayerState,
  size: LoanSize,
) => {
  const economy = getEconomySnapshot(state.activeEffects)
  let rate = size === 'small' ? 0.06 : 0.09

  if (player.creditScore > 720) {
    rate -= 0.015
  }

  if (player.creditScore < 620) {
    rate += 0.025
  }

  if (player.debt > 500) {
    rate += 0.015
  }

  rate += economy.interestDelta
  return clamp(rate, 0.035, 0.16)
}

const takeLoan = (state: GameState, playerId: string, size: LoanSize) => {
  const player = getPlayer(state, playerId)

  if (!player) {
    return
  }

  const principal = size === 'small' ? 95 : 190
  const approved =
    size === 'small'
      ? player.creditScore > 450
      : player.creditScore > 600 && player.debt < 540 && player.survivalRounds === 0

  if (!approved) {
    if (player.isHuman) {
      addAlert(state, `${size === 'large' ? 'Large' : 'Small'} loan denied.`)
    }
    addLog(state, `${player.name} got denied for a ${size} loan.`, 'bad')
    return
  }

  player.cash += principal
  player.debt += principal
  player.creditScore -= size === 'small' ? 4 : 8
  const rate = getLoanRate(state, player, size)
  addLog(
    state,
    `${player.name} took a ${size} loan: ${money(principal)} at ${Math.round(
      rate * 100,
    )}% round interest.`,
    'warn',
  )
  normalizePlayerState(player)
}

const buyListing = (state: GameState, playerId: string, tileId: number) => {
  const player = getPlayer(state, playerId)
  const listing = state.marketListings.find((item) => item.tileId === tileId)
  const tile = getTile(state, tileId)

  if (!player || !listing || !tile) {
    return
  }

  if (player.survivalRounds > 0) {
    if (player.isHuman) {
      addAlert(state, 'You cannot buy property while in Survival Mode.')
    }
    return
  }

  if (player.cash < listing.price) {
    if (player.isHuman) {
      addAlert(state, `You need ${money(listing.price)} cash to buy ${tile.name}.`)
    }
    return
  }

  player.cash -= listing.price
  player.ownedTileIds.push(tile.id)
  tile.ownerId = player.id
  tile.listed = false
  tile.upgradeLevel = 0
  tile.strategy = 'extract'
  state.marketListings = state.marketListings.filter((item) => item.tileId !== tileId)

  if (player.roommateWith) {
    const roommate = getPlayer(state, player.roommateWith)
    if (roommate) {
      roommate.roommateWith = null
      roommate.livingStatus = roommate.ownedTileIds.length > 0 ? 'owner' : 'solo'
    }
    player.roommateWith = null
  }

  player.livingStatus = 'owner'
  player.stability += 6
  addLog(state, `${player.name} bought ${tile.name} for ${money(listing.price)}.`, 'good')
  normalizePlayerState(player)
}

const upgradeProperty = (state: GameState, playerId: string, tileId: number) => {
  const player = getPlayer(state, playerId)
  const tile = getTile(state, tileId)

  if (!player || !tile || tile.ownerId !== playerId) {
    return
  }

  if (tile.upgradeLevel >= MAX_PROPERTY_UPGRADE) {
    if (player.isHuman) {
      addAlert(state, `${tile.name} is already fully upgraded.`)
    }
    return
  }

  const cost = getUpgradeCost(tile)

  if (player.cash < cost) {
    if (player.isHuman) {
      addAlert(state, `You need ${money(cost)} to upgrade ${tile.name}.`)
    }
    return
  }

  player.cash -= cost
  tile.upgradeLevel += 1
  player.stability += 2
  addLog(
    state,
    `${player.name} upgraded ${tile.name} to level ${tile.upgradeLevel}.`,
    'good',
  )
}

const setPropertyStrategy = (
  state: GameState,
  playerId: string,
  tileId: number,
  strategy: PropertyStrategy,
) => {
  const player = getPlayer(state, playerId)
  const tile = getTile(state, tileId)

  if (!player || !tile || tile.ownerId !== playerId) {
    return
  }

  tile.strategy = strategy
  addLog(
    state,
    `${player.name} switched ${tile.name} to ${strategy === 'extract' ? 'cash extraction' : 'stabilized housing'}.`,
    strategy === 'extract' ? 'warn' : 'good',
  )
}

const requestRoommatePact = (state: GameState, partnerId: string) => {
  const human = getHuman(state)
  const partner = getPlayer(state, partnerId)

  if (!human || !partner || partner.isHuman) {
    return
  }

  if (human.roommateWith || human.livingStatus === 'owner') {
    addAlert(state, 'You are already housed under a different arrangement.')
    return
  }

  if (partner.roommateWith || partner.livingStatus === 'owner') {
    addAlert(state, `${partner.name} is not available for a roommate pact.`)
    return
  }

  let acceptChance = 0.42
  acceptChance += partner.archetype === 'social' ? 0.22 : 0
  acceptChance += partner.cash < 150 ? 0.14 : 0
  acceptChance += partner.stability < 58 ? 0.08 : 0
  acceptChance += partner.trustInHuman / 200

  if (!chance(state, acceptChance)) {
    partner.trustInHuman -= 8
    addLog(state, `${partner.name} rejected the roommate pitch.`, 'warn')
    addAlert(state, `${partner.name} passed on the roommate deal.`)
    return
  }

  human.roommateWith = partner.id
  human.livingStatus = 'roommates'
  partner.roommateWith = human.id
  partner.livingStatus = 'roommates'
  partner.trustInHuman += 8
  addLog(state, `${human.name} and ${partner.name} started splitting rent.`, 'good')
}

const sendSupport = (state: GameState, partnerId: string) => {
  const human = getHuman(state)
  const partner = getPlayer(state, partnerId)

  if (!human || !partner || partner.isHuman) {
    return
  }

  if (human.cash < SUPPORT_TRANSFER) {
    addAlert(state, `You need ${money(SUPPORT_TRANSFER)} to send support.`)
    return
  }

  human.cash -= SUPPORT_TRANSFER
  partner.cash += SUPPORT_TRANSFER
  partner.trustInHuman += 12
  human.stability += 2
  addLog(
    state,
    `You sent ${partner.name} ${money(SUPPORT_TRANSFER)}. Trust went up.`,
    'good',
  )
}

const requestBridgeLoan = (state: GameState) => {
  const human = getHuman(state)

  if (!human) {
    return
  }

  if (human.peerLoan) {
    addAlert(state, 'You already have an informal player loan outstanding.')
    return
  }

  const lenders = state.players
    .filter((player) => !player.isHuman && player.cash >= 90 && player.trustInHuman >= 40)
    .sort(
      (left, right) =>
        right.cash + right.trustInHuman * 2 - (left.cash + left.trustInHuman * 2),
    )

  const lender = lenders[0]

  if (!lender) {
    addAlert(state, 'Nobody at the table trusts you enough to front cash.')
    return
  }

  const amount = clamp(Math.round(lender.cash * 0.18), 35, 72)
  lender.cash -= amount
  human.cash += amount
  human.peerLoan = {
    lenderId: lender.id,
    amount,
    dueRound: state.round + 2,
  }
  lender.trustInHuman -= 2
  addLog(
    state,
    `${lender.name} floated you ${money(amount)}. No contract, just memory.`,
    'good',
  )
}

const repayBridgeLoan = (state: GameState) => {
  const human = getHuman(state)

  if (!human || !human.peerLoan) {
    return
  }

  const lender = getPlayer(state, human.peerLoan.lenderId)

  if (!lender) {
    human.peerLoan = undefined
    return
  }

  if (human.cash < human.peerLoan.amount) {
    addAlert(state, `You need ${money(human.peerLoan.amount)} cash to repay ${lender.name}.`)
    return
  }

  human.cash -= human.peerLoan.amount
  lender.cash += human.peerLoan.amount
  lender.trustInHuman += 18
  addLog(
    state,
    `You repaid ${lender.name} ${money(human.peerLoan.amount)} and kept the door open.`,
    'good',
  )
  human.peerLoan = undefined
}

const maybeBuyForAi = (state: GameState, player: PlayerState) => {
  const listing = state.marketListings
    .filter((item) => {
      const tile = getTile(state, item.tileId)
      return tile?.ownerId === null
    })
    .sort((left, right) => left.price - right.price)[0]

  if (!listing) {
    return
  }

  const appetiteByArchetype: Record<Archetype, number> = {
    stability: 0.16,
    opportunist: 0.28,
    social: 0.12,
    'asset-hunter': 0.46,
  }

  if (player.cash < listing.price) {
    return
  }

  if (chance(state, appetiteByArchetype[player.archetype])) {
    buyListing(state, player.id, listing.tileId)
  }
}

const maybeManageAiProperties = (state: GameState, player: PlayerState) => {
  const ownedTiles = getOwnedTiles(state, player.id)

  if (ownedTiles.length === 0) {
    return
  }

  ownedTiles.forEach((tile) => {
    if (
      tile.upgradeLevel < MAX_PROPERTY_UPGRADE &&
      player.cash > getUpgradeCost(tile) + 90 &&
      chance(state, player.archetype === 'asset-hunter' ? 0.42 : 0.18)
    ) {
      upgradeProperty(state, player.id, tile.id)
    }

    if (player.archetype === 'stability' && chance(state, 0.4)) {
      setPropertyStrategy(state, player.id, tile.id, 'stabilize')
    }

    if (player.archetype === 'opportunist' && chance(state, 0.4)) {
      setPropertyStrategy(state, player.id, tile.id, 'extract')
    }
  })
}

const maybePairAiRoommates = (state: GameState) => {
  const eligiblePlayers = state.players.filter(
    (player) =>
      !player.isHuman &&
      !player.roommateWith &&
      player.livingStatus === 'solo' &&
      player.ownedTileIds.length === 0 &&
      player.cash < 150,
  )

  if (eligiblePlayers.length < 2 || !chance(state, 0.22)) {
    return
  }

  const [left, right] = shuffle(state, eligiblePlayers).slice(0, 2)

  left.roommateWith = right.id
  right.roommateWith = left.id
  left.livingStatus = 'roommates'
  right.livingStatus = 'roommates'
  addLog(state, `${left.name} and ${right.name} split a place to cut burn rate.`, 'neutral')
}

const maybeTriggerGlobalEvent = (state: GameState) => {
  if (state.round % 2 !== 0) {
    state.currentHeadline = 'No major shock'
    return
  }

  const eventRoll = randInt(state, 1, 6)

  if (eventRoll === 1) {
    state.tiles.forEach((tile) => {
      if (tile.type === 'property') {
        tile.currentRent = Math.round(tile.currentRent * 1.08)
      }
    })
    state.currentHeadline = 'Rent spike'
    addLog(state, 'Global event: rent spike. Every zone got meaner overnight.', 'bad')
    return
  }

  if (eventRoll === 2) {
    state.activeEffects.push({
      id: nextId(state, 'effect'),
      title: 'Recession',
      description: 'Stable income shrinks for two rounds.',
      remainingRounds: 2,
      incomeMultiplier: 0.9,
    })
    state.currentHeadline = 'Recession'
    addLog(state, 'Global event: recession. Salaries just got clipped.', 'warn')
    return
  }

  if (eventRoll === 3) {
    state.activeEffects.push({
      id: nextId(state, 'effect'),
      title: 'Tech boom',
      description: 'Gig work pays better for two rounds.',
      remainingRounds: 2,
      gigMultiplier: 1.22,
    })
    state.currentHeadline = 'Tech boom'
    addLog(state, 'Global event: tech boom. Side hustles are suddenly worth it.', 'good')
    return
  }

  if (eventRoll === 4) {
    state.activeEffects.push({
      id: nextId(state, 'effect'),
      title: 'Rate hike',
      description: 'Debt compounds harder for two rounds.',
      remainingRounds: 2,
      interestDelta: 0.02,
    })
    state.currentHeadline = 'Rate hike'
    addLog(state, 'Global event: rate hike. Borrowing just got uglier.', 'bad')
    return
  }

  if (eventRoll === 5) {
    state.activeEffects.push({
      id: nextId(state, 'effect'),
      title: 'Mutual aid weekend',
      description: 'Living costs drop briefly.',
      remainingRounds: 1,
      livingCostMultiplier: 0.85,
    })
    state.players.forEach((player) => {
      player.stability += 4
    })
    state.currentHeadline = 'Mutual aid weekend'
    addLog(state, 'Global event: mutual aid weekend. The floor softened, briefly.', 'good')
    return
  }

  state.activeEffects.push({
    id: nextId(state, 'effect'),
    title: 'Buyer panic',
    description: 'Market listings get cheaper for one round.',
    remainingRounds: 1,
    marketDiscount: 0.9,
  })
  createListing(state, 'Panic listing', 0.9, 1)
  state.currentHeadline = 'Buyer panic'
  addLog(state, 'Global event: buyer panic. The market blinked.', 'good')
}

const maybeTriggerPersonalEvent = (state: GameState, player: PlayerState) => {
  if (!chance(state, 0.24)) {
    return
  }

  const eventRoll = randInt(state, 1, 4)

  if (eventRoll === 1) {
    const expense = randInt(state, 22, 52)
    settlePayment(state, player.id, expense, 'a personal emergency')
    addLog(
      state,
      `${player.name} got hit by a personal emergency for ${money(expense)}.`,
      'bad',
    )
    return
  }

  if (eventRoll === 2) {
    const payout = randInt(state, 35, 82)
    player.cash += payout
    player.stability += 6
    addLog(state, `${player.name} cashed in a rare positive spike for ${money(payout)}.`, 'good')
    return
  }

  if (eventRoll === 3) {
    player.stability -= 10
    player.skipActions += 1
    addLog(state, `${player.name} hit a burnout wall.`, 'warn')
    return
  }

  player.creditScore += 14
  player.cash += 18
  addLog(state, `${player.name} found a temporary cushion and credit relief.`, 'good')
}

const resolvePeerLoanDeadline = (state: GameState) => {
  const human = getHuman(state)

  if (!human?.peerLoan || human.peerLoan.dueRound >= state.round) {
    return
  }

  const lender = getPlayer(state, human.peerLoan.lenderId)

  if (lender) {
    lender.trustInHuman -= 25
    addLog(
      state,
      `${lender.name} noticed you never repaid the bridge loan. Trust collapsed.`,
      'bad',
    )
  }

  human.peerLoan = undefined
}

const updateScores = (state: GameState) => {
  state.players.forEach((player) => {
    const assetValue = getOwnedTiles(state, player.id).reduce(
      (sum, tile) =>
        sum + tile.marketPrice + tile.upgradeLevel * Math.round(tile.marketPrice * 0.08),
      0,
    )

    const netWorth = player.cash + assetValue - player.debt
    const debtRatio = Math.min(5, player.debt / Math.max(player.cash + assetValue, 1))
    player.score = Math.round(
      netWorth * 1.08 -
        debtRatio * 42 +
        player.stability * 3 +
        player.ownedTileIds.length * 95,
    )
  })
}

const closeExpiredListings = (state: GameState) => {
  const expiredTileIds = state.marketListings
    .filter((listing) => listing.expiresRound < state.round)
    .map((listing) => listing.tileId)

  expiredTileIds.forEach((tileId) => {
    const tile = getTile(state, tileId)
    if (tile) {
      tile.listed = false
    }
  })

  state.marketListings = state.marketListings.filter(
    (listing) => listing.expiresRound >= state.round,
  )
}

const createRoundSummary = (state: GameState): RoundSummary => {
  const notes = state.logs
    .filter((entry) => entry.round === state.round)
    .slice(0, 3)
    .map((entry) => entry.message)

  return {
    id: nextId(state, 'summary'),
    round: state.round,
    headline: state.currentHeadline,
    notes,
    players: [...state.players]
      .sort((left, right) => right.score - left.score)
      .map((player) => ({
        id: player.id,
        name: player.name,
        cash: player.cash,
        debt: player.debt,
        stability: player.stability,
        score: player.score,
        ownedAssets: player.ownedTileIds.length,
        livingStatus: player.livingStatus,
      })),
  }
}

const recordRoundSummary = (state: GameState) => {
  state.roundSummaries = [createRoundSummary(state), ...state.roundSummaries].slice(
    0,
    MAX_ROUND_SUMMARIES,
  )
}

const advanceRound = (state: GameState) => {
  const economy = getEconomySnapshot(state.activeEffects)

  state.players.forEach((player) => {
    const job = JOBS[player.jobId]
    let salary = job.salary * economy.incomeMultiplier

    if (player.stability < 35) {
      salary *= 0.88
    }

    if (player.survivalRounds > 0) {
      salary *= 0.8
      player.survivalRounds -= 1
    }

    player.cash += Math.round(salary)
    player.workLock = job.workLock
    player.stability += job.stabilityDelta
    player.defaultedThisRound = false

    if (player.debt > 0) {
      const rate = getLoanRate(state, player, 'small')
      player.debt = Math.round(player.debt * (1 + rate))
    }

    const stabilizedCount = getOwnedTiles(state, player.id).filter(
      (tile) => tile.strategy === 'stabilize',
    ).length
    if (stabilizedCount > 0) {
      player.stability += stabilizedCount
    }

    maybeTriggerPersonalEvent(state, player)
    normalizePlayerState(player)
  })

  state.tiles.forEach((tile) => {
    if (tile.type !== 'property') {
      return
    }

    const strategyShift = tile.strategy === 'extract' ? 0.015 : -0.01
    const upgradeShift = tile.upgradeLevel * 0.01
    const growthMultiplier = 1 + tile.growth + economy.rentGrowthBonus + strategyShift + upgradeShift
    tile.currentRent = Math.max(tile.baseRent, Math.round(tile.currentRent * growthMultiplier))
  })

  state.activeEffects = state.activeEffects
    .map((effect) => ({
      ...effect,
      remainingRounds: effect.remainingRounds - 1,
    }))
    .filter((effect) => effect.remainingRounds > 0)

  maybeTriggerGlobalEvent(state)
  maybePairAiRoommates(state)
  closeExpiredListings(state)
  resolvePeerLoanDeadline(state)

  if (state.round % 3 === 0) {
    createListing(state, 'Scheduled auction', 1.02, 2)
  }

  state.players
    .filter((player) => !player.isHuman)
    .forEach((player) => {
      maybeBuyForAi(state, player)
      maybeManageAiProperties(state, player)
    })

  updateScores(state)
  recordRoundSummary(state)

  if (state.round >= state.totalRounds) {
    state.phase = 'finished'
    const winner = [...state.players].sort((left, right) => right.score - left.score)[0]
    state.winnerId = winner?.id ?? null
    addLog(state, `${winner?.name ?? 'Nobody'} finished on top when the timer ran out.`, 'good')
    return
  }

  state.round += 1
}

const processTickIncomeAndCosts = (state: GameState) => {
  const economy = getEconomySnapshot(state.activeEffects)

  state.players.forEach((player) => {
    player.moveCooldown = Math.max(0, player.moveCooldown - 1)
    player.gigCooldown = Math.max(0, player.gigCooldown - 1)
    player.workLock = Math.max(0, player.workLock - 1)
    player.skipActions = Math.max(0, player.skipActions - 1)

    const passiveIncome = getPassiveIncome(state, player)
    if (passiveIncome > 0) {
      player.cash += passiveIncome
    }

    const livingCost = getLivingCost(player, economy.livingCostMultiplier)
    settlePayment(state, player.id, livingCost, 'living costs')
    normalizePlayerState(player)
  })
}

const maybeActForAi = (state: GameState, player: PlayerState) => {
  if (player.workLock > 0 || player.skipActions > 0) {
    return
  }

  const lowCash = player.cash < 55
  const shouldGig = lowCash || player.archetype === 'opportunist'
  const moveBias: Record<Archetype, number> = {
    stability: 0.68,
    opportunist: 0.82,
    social: 0.62,
    'asset-hunter': 0.7,
  }

  if (player.moveCooldown === 0 && chance(state, moveBias[player.archetype])) {
    movePlayer(state, player.id)
    return
  }

  if (player.gigCooldown === 0 && shouldGig && chance(state, 0.62)) {
    gigForPlayer(state, player.id)
    return
  }

  if (player.cash < 40 && chance(state, 0.4)) {
    takeLoan(state, player.id, player.creditScore > 650 ? 'large' : 'small')
  }
}

export const createInitialGame = (config: GameConfig): GameState => {
  const seed = createSeedFromText(config.seed)

  const aiPlayers = AI_ROSTER.slice(0, config.aiCount).map((profile, index) => ({
    id: profile.id,
    name: profile.name,
    color: profile.color,
    isHuman: false,
    archetype: profile.archetype,
    jobId: profile.jobId,
    cash: 225 - index * 10,
    debt: 92 + index * 22,
    creditScore: 660 - index * 14,
    stability: 68 - index * 2,
    position: (index + 2) % TILE_DEFINITIONS.length,
    moveCooldown: index % 2,
    gigCooldown: 0,
    workLock: 0,
    skipActions: 0,
    survivalRounds: 0,
    livingStatus: 'solo' as const,
    roommateWith: null,
    defaultedThisRound: false,
    ownedTileIds: [],
    trustInHuman: 55,
    score: 0,
  }))

  const humanPlayer: PlayerState = {
    id: HUMAN_ID,
    name: config.playerName.trim() || 'You',
    color: '#111111',
    isHuman: true,
    archetype: 'social',
    jobId: config.jobId,
    cash: 265,
    debt: 95,
    creditScore: 690,
    stability: 74,
    position: 0,
    moveCooldown: 0,
    gigCooldown: 0,
    workLock: 0,
    skipActions: 0,
    survivalRounds: 0,
    livingStatus: 'solo',
    roommateWith: null,
    defaultedThisRound: false,
    ownedTileIds: [],
    trustInHuman: 0,
    score: 0,
  }

  const state: GameState = {
    phase: 'running',
    config: {
      ...config,
      seed: normalizeSeed(config.seed),
    },
    seed,
    rngState: seed,
    nextId: 1,
    round: 1,
    totalRounds: config.totalRounds,
    tick: 0,
    tickInRound: 0,
    gameSecondsElapsed: 0,
    tiles: TILE_DEFINITIONS.map((tile) => ({
      ...tile,
      currentRent: tile.baseRent,
      ownerId: null,
      listed: false,
      upgradeLevel: 0,
      strategy: 'extract',
    })),
    players: [humanPlayer, ...aiPlayers],
    marketListings: [],
    activeEffects: [],
    currentHeadline: 'Opening week',
    alerts: [`Seed locked: ${normalizeSeed(config.seed)}`],
    logs: [],
    roundSummaries: [],
    winnerId: null,
  }

  addLog(
    state,
    'Match started. The economy ticks every 3 in-game seconds on an accelerated clock.',
    'neutral',
  )
  addLog(state, 'Every property starts owned by The Market.', 'warn')
  updateScores(state)
  return state
}

const finalizeTickState = (state: GameState) => {
  const human = getHuman(state)
  if (human) {
    const economy = getEconomySnapshot(state.activeEffects)
    const nextBill = getLivingCost(human, economy.livingCostMultiplier)
    if (human.cash < nextBill && human.creditScore < 520) {
      addAlert(state, 'Default risk: the next living-cost tick may break you.')
    }
    if (human.peerLoan && human.peerLoan.dueRound === state.round) {
      addAlert(state, 'Bridge loan due this round. Trust expires fast.')
    }
  }
}

export const advanceTick = (game: GameState) => {
  if (game.phase !== 'running') {
    return game
  }

  const next = structuredClone(game)
  next.tick += 1
  next.tickInRound += 1
  next.gameSecondsElapsed += GAME_SECONDS_PER_TICK
  next.alerts = []

  processTickIncomeAndCosts(next)

  next.players
    .filter((player) => !player.isHuman)
    .forEach((player) => maybeActForAi(next, player))

  updateScores(next)

  if (next.tickInRound >= TICKS_PER_ROUND) {
    next.tickInRound = 0
    advanceRound(next)
  }

  finalizeTickState(next)
  return next
}

const cloneAndApply = (game: GameState, work: (next: GameState) => void) => {
  const next = structuredClone(game)
  work(next)
  updateScores(next)
  finalizeTickState(next)
  return next
}

export const performMove = (game: GameState) =>
  cloneAndApply(game, (next) => {
    movePlayer(next, HUMAN_ID)
  })

export const performGig = (game: GameState) =>
  cloneAndApply(game, (next) => {
    gigForPlayer(next, HUMAN_ID)
  })

export const performLoan = (game: GameState, size: LoanSize) =>
  cloneAndApply(game, (next) => {
    takeLoan(next, HUMAN_ID, size)
  })

export const performBuyout = (game: GameState, tileId: number) =>
  cloneAndApply(game, (next) => {
    buyListing(next, HUMAN_ID, tileId)
  })

export const performRoommateRequest = (game: GameState, partnerId: string) =>
  cloneAndApply(game, (next) => {
    requestRoommatePact(next, partnerId)
  })

export const performSupportTransfer = (game: GameState, partnerId: string) =>
  cloneAndApply(game, (next) => {
    sendSupport(next, partnerId)
  })

export const performBridgeLoanRequest = (game: GameState) =>
  cloneAndApply(game, (next) => {
    requestBridgeLoan(next)
  })

export const performBridgeRepayment = (game: GameState) =>
  cloneAndApply(game, (next) => {
    repayBridgeLoan(next)
  })

export const performPropertyUpgrade = (game: GameState, tileId: number) =>
  cloneAndApply(game, (next) => {
    upgradeProperty(next, HUMAN_ID, tileId)
  })

export const performPropertyStrategy = (
  game: GameState,
  tileId: number,
  strategy: PropertyStrategy,
) =>
  cloneAndApply(game, (next) => {
    setPropertyStrategy(next, HUMAN_ID, tileId, strategy)
  })

export const formatMoney = (value: number) => money(value)

export const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

export const getHumanPlayer = (state: GameState) => getHuman(state)

export const getUpcomingLivingCost = (state: GameState, player: PlayerState) => {
  const economy = getEconomySnapshot(state.activeEffects)
  return getLivingCost(player, economy.livingCostMultiplier)
}

export const getPassiveIncomeValue = (state: GameState, player: PlayerState) =>
  getPassiveIncome(state, player)

export const getRoundInterestRate = (state: GameState, player: PlayerState) =>
  getLoanRate(state, player, 'small')

export const getOwnedProperties = (state: GameState, playerId: string) =>
  getOwnedTiles(state, playerId)

export const getPropertyUpgradeCost = (state: GameState, tileId: number) => {
  const tile = getTile(state, tileId)
  return tile ? getUpgradeCost(tile) : 0
}

export const getPropertyPassiveIncomeValue = (state: GameState, tileId: number) => {
  const tile = getTile(state, tileId)
  return tile ? getPassiveIncomeFromTile(tile) : 0
}

export const createLastMatchSnapshot = (state: GameState): LastMatchSnapshot | null => {
  if (state.phase !== 'finished') {
    return null
  }

  const winner = state.players.find((player) => player.id === state.winnerId) ?? state.players[0]

  return {
    seed: state.config.seed,
    finishedAt: new Date().toISOString(),
    totalRounds: state.totalRounds,
    winnerName: winner?.name ?? 'Nobody',
    winnerScore: winner?.score ?? 0,
    summaries: state.roundSummaries,
  }
}

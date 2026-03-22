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
  LoanSize,
  LogEntry,
  MarketListing,
  PlayerState,
  Tone,
} from './types'

const HUMAN_ID = 'human'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

const chance = (value: number) => Math.random() < value

const weightedPick = <T,>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)]

const money = (amount: number) => `$${Math.round(amount)}`

const toneId = () => Math.random().toString(36).slice(2, 10)

const getHuman = (state: GameState) =>
  state.players.find((player) => player.id === HUMAN_ID)

const getPlayer = (state: GameState, playerId: string) =>
  state.players.find((player) => player.id === playerId)

const getTile = (state: GameState, tileId: number) =>
  state.tiles.find((tile) => tile.id === tileId)

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
    id: toneId(),
    round: state.round,
    tone,
    message,
  }
  state.logs = [entry, ...state.logs].slice(0, MAX_LOGS)
}

const addAlert = (state: GameState, message: string) => {
  state.alerts = [message, ...state.alerts].slice(0, 3)
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
}

const getPassiveIncome = (state: GameState, player: PlayerState) =>
  player.ownedTileIds.reduce((total, tileId) => {
    const tile = getTile(state, tileId)

    if (!tile) {
      return total
    }

    return total + Math.max(2, Math.round(tile.currentRent * 0.14))
  }, 0)

const getMoveCooldown = (player: PlayerState) => {
  const base = JOBS[player.jobId].moveCooldown
  const stabilityPenalty = player.stability < 38 ? 1 : 0
  const survivalPenalty = player.survivalRounds > 0 ? 1 : 0
  return base + stabilityPenalty + survivalPenalty
}

const getGigCooldown = (player: PlayerState) =>
  Math.max(1, player.jobId === 'freelance' ? 1 : 2)

const getLivingCost = (
  player: PlayerState,
  livingCostMultiplier: number,
) => {
  let cost = 18

  if (player.livingStatus === 'roommates') {
    cost = 11
  }

  if (player.livingStatus === 'owner') {
    cost = 8
  }

  if (player.survivalRounds > 0) {
    cost *= 0.65
  }

  return Math.max(4, Math.round(cost * livingCostMultiplier))
}

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
  if (player.ownedTileIds.length === 0) {
    return false
  }

  const mostValuableTileId = player.ownedTileIds
    .map((tileId) => getTile(state, tileId))
    .filter(Boolean)
    .sort((a, b) => (b?.marketPrice ?? 0) - (a?.marketPrice ?? 0))[0]?.id

  if (mostValuableTileId === undefined) {
    return false
  }

  const tile = getTile(state, mostValuableTileId)

  if (!tile) {
    return false
  }

  tile.ownerId = null
  tile.listed = false
  player.ownedTileIds = player.ownedTileIds.filter(
    (ownedTileId) => ownedTileId !== tile.id,
  )
  player.cash += Math.round(tile.marketPrice * 0.62)
  player.livingStatus = player.ownedTileIds.length > 0 ? 'owner' : 'solo'
  addLog(
    state,
    `${player.name} liquidated ${tile.name} for ${money(
      tile.marketPrice * 0.62,
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
  player.creditScore -= 26
  player.stability -= 14
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
  const riskGate = player.creditScore - player.debt * 0.18

  if (riskGate < 420) {
    return false
  }

  const principal = Math.ceil(amountNeeded * 1.35)
  player.cash += principal
  player.debt += principal
  player.creditScore -= 7
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

  const tile = weightedPick(availableTiles)
  tile.listed = true
  const price = Math.round(
    tile.marketPrice * priceFactor * economy.marketDiscount * (1 + state.round * 0.05),
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
    player.cash += 25
    player.stability += 2
    addLog(state, `${player.name} grabbed a breathing-space bonus at Payday Square.`, 'good')
    return
  }

  if (tile.type === 'event') {
    const eventRoll = randInt(1, 5)

    if (eventRoll === 1) {
      const expense = randInt(26, 52)
      settlePayment(state, player.id, expense, 'a surprise medical bill')
      addLog(state, `${player.name} ate a ${money(expense)} medical expense.`, 'bad')
      return
    }

    if (eventRoll === 2) {
      const payout = randInt(40, 92)
      player.cash += payout
      player.stability += 4
      addLog(state, `${player.name} caught a viral spike worth ${money(payout)}.`, 'good')
      return
    }

    if (eventRoll === 3) {
      player.stability -= 10
      player.skipActions += 1
      addLog(state, `${player.name} doomscrolled into burnout.`, 'warn')
      return
    }

    if (eventRoll === 4) {
      player.creditScore += 12
      player.cash += 18
      addLog(state, `${player.name} squeezed a tiny bureaucratic win out of the system.`, 'good')
      return
    }

    createListing(state, 'Flash sale', 1.04, 1)
    addLog(state, `${player.name} uncovered a market whisper at ${tile.name}.`, 'neutral')
    return
  }

  if (tile.type === 'market') {
    createListing(state, 'Auction pressure', 0.98, 2)
    player.stability += 3
    addLog(state, `${player.name} stirred the Auction Block.`, 'neutral')
    return
  }

  if (tile.ownerId === player.id) {
    player.stability += 2
    addLog(state, `${player.name} landed on ${tile.name} and paid nobody.`, 'good')
    return
  }

  const rent = tile.currentRent
  const owner = tile.ownerId ? getPlayer(state, tile.ownerId) : null
  const recipientId = owner?.id
  settlePayment(state, player.id, rent, `rent at ${tile.name}`, recipientId)

  if (owner) {
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
      addAlert(state, 'You are locked out right now. Work or burnout is eating the action window.')
    }
    return
  }

  const roll = randInt(1, 6)
  const previousPosition = player.position
  player.position = (player.position + roll) % state.tiles.length
  player.moveCooldown = getMoveCooldown(player)

  if (player.position < previousPosition) {
    player.cash += 40
    player.stability += 2
    addLog(state, `${player.name} looped the board and banked ${money(40)}.`, 'good')
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
      addAlert(state, 'No gig slot available. You are either working, burned out, or on cooldown.')
    }
    return
  }

  const economy = getEconomySnapshot(state.activeEffects)
  const job = JOBS[player.jobId]
  let payout = randInt(28, 68)
  payout *= 1 + job.gigBonus
  payout *= economy.gigMultiplier

  if (player.survivalRounds > 0) {
    payout *= 0.8
  }

  const crash = chance(0.14)
  const stabilityCost = randInt(3, 6)

  if (crash) {
    payout *= 0.55
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
  let rate = size === 'small' ? 0.08 : 0.12

  if (player.creditScore > 720) {
    rate -= 0.02
  }

  if (player.creditScore < 620) {
    rate += 0.03
  }

  if (player.debt > 450) {
    rate += 0.02
  }

  rate += economy.interestDelta
  return clamp(rate, 0.04, 0.2)
}

const takeLoan = (state: GameState, playerId: string, size: LoanSize) => {
  const player = getPlayer(state, playerId)

  if (!player) {
    return
  }

  const principal = size === 'small' ? 110 : 220
  const approved =
    size === 'small'
      ? player.creditScore > 480
      : player.creditScore > 620 && player.debt < 620 && player.survivalRounds === 0

  if (!approved) {
    if (player.isHuman) {
      addAlert(state, `${size === 'large' ? 'Large' : 'Small'} loan denied.`)
    }
    addLog(state, `${player.name} got denied for a ${size} loan.`, 'bad')
    return
  }

  player.cash += principal
  player.debt += principal
  player.creditScore -= size === 'small' ? 4 : 9
  const rate = getLoanRate(state, player, size)
  addLog(
    state,
    `${player.name} took a ${size} loan: ${money(principal)} at ${Math.round(rate * 100)}% round interest.`,
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

  let acceptChance = 0.45
  acceptChance += partner.archetype === 'social' ? 0.25 : 0
  acceptChance += partner.cash < 140 ? 0.18 : 0
  acceptChance += partner.stability < 55 ? 0.1 : 0

  if (!chance(acceptChance)) {
    partner.trustInHuman -= 8
    addLog(state, `${partner.name} rejected the roommate pitch.`, 'warn')
    addAlert(state, `${partner.name} passed on the roommate deal.`)
    return
  }

  human.roommateWith = partner.id
  human.livingStatus = 'roommates'
  partner.roommateWith = human.id
  partner.livingStatus = 'roommates'
  partner.trustInHuman += 6
  addLog(state, `${human.name} and ${partner.name} started splitting rent.`, 'good')
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
    .filter((player) => !player.isHuman && player.cash >= 110 && player.trustInHuman >= 40)
    .sort(
      (left, right) =>
        right.cash + right.trustInHuman * 2 - (left.cash + left.trustInHuman * 2),
    )

  const lender = lenders[0]

  if (!lender) {
    addAlert(state, 'Nobody at the table trusts you enough to front cash.')
    return
  }

  const amount = clamp(Math.round(lender.cash * 0.22), 45, 90)
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
    stability: 0.18,
    opportunist: 0.32,
    social: 0.14,
    'asset-hunter': 0.48,
  }

  if (player.cash < listing.price) {
    return
  }

  if (chance(appetiteByArchetype[player.archetype])) {
    buyListing(state, player.id, listing.tileId)
  }
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

  if (eligiblePlayers.length < 2 || !chance(0.28)) {
    return
  }

  const [left, right] = eligiblePlayers
    .sort(() => Math.random() - 0.5)
    .slice(0, 2)

  left.roommateWith = right.id
  right.roommateWith = left.id
  left.livingStatus = 'roommates'
  right.livingStatus = 'roommates'
  addLog(state, `${left.name} and ${right.name} split a place to cut burn rate.`, 'neutral')
}

const maybeTriggerGlobalEvent = (state: GameState) => {
  if (state.round % 2 !== 0) {
    state.currentHeadline = null
    return
  }

  const eventRoll = randInt(1, 6)

  if (eventRoll === 1) {
    state.tiles.forEach((tile) => {
      if (tile.type === 'property') {
        tile.currentRent = Math.round(tile.currentRent * 1.14)
      }
    })
    state.currentHeadline = 'Rent spike'
    addLog(state, 'Global event: rent spike. Every zone got meaner overnight.', 'bad')
    return
  }

  if (eventRoll === 2) {
    state.activeEffects.push({
      id: toneId(),
      title: 'Recession',
      description: 'Stable income shrinks for two rounds.',
      remainingRounds: 2,
      incomeMultiplier: 0.82,
    })
    state.currentHeadline = 'Recession'
    addLog(state, 'Global event: recession. Salaries just got clipped.', 'warn')
    return
  }

  if (eventRoll === 3) {
    state.activeEffects.push({
      id: toneId(),
      title: 'Tech boom',
      description: 'Gig work pays better for two rounds.',
      remainingRounds: 2,
      gigMultiplier: 1.35,
    })
    state.currentHeadline = 'Tech boom'
    addLog(state, 'Global event: tech boom. Side hustles are suddenly worth it.', 'good')
    return
  }

  if (eventRoll === 4) {
    state.activeEffects.push({
      id: toneId(),
      title: 'Rate hike',
      description: 'Debt compounds harder for two rounds.',
      remainingRounds: 2,
      interestDelta: 0.03,
    })
    state.currentHeadline = 'Rate hike'
    addLog(state, 'Global event: rate hike. Borrowing just got uglier.', 'bad')
    return
  }

  if (eventRoll === 5) {
    state.activeEffects.push({
      id: toneId(),
      title: 'Mutual aid weekend',
      description: 'Living costs drop briefly.',
      remainingRounds: 1,
      livingCostMultiplier: 0.84,
    })
    state.players.forEach((player) => {
      player.stability += 5
    })
    state.currentHeadline = 'Mutual aid weekend'
    addLog(state, 'Global event: mutual aid weekend. The floor softened, briefly.', 'good')
    return
  }

  state.activeEffects.push({
    id: toneId(),
    title: 'Buyer panic',
    description: 'Market listings get cheaper for one round.',
    remainingRounds: 1,
    marketDiscount: 0.86,
  })
  createListing(state, 'Panic listing', 0.93, 1)
  state.currentHeadline = 'Buyer panic'
  addLog(state, 'Global event: buyer panic. The market blinked.', 'good')
}

const maybeTriggerPersonalEvent = (state: GameState, player: PlayerState) => {
  if (!chance(0.34)) {
    return
  }

  const eventRoll = randInt(1, 4)

  if (eventRoll === 1) {
    const expense = randInt(35, 70)
    settlePayment(state, player.id, expense, 'a personal emergency')
    addLog(state, `${player.name} got hit by a personal emergency for ${money(expense)}.`, 'bad')
    return
  }

  if (eventRoll === 2) {
    const payout = randInt(45, 105)
    player.cash += payout
    player.stability += 6
    addLog(state, `${player.name} cashed in a rare positive spike for ${money(payout)}.`, 'good')
    return
  }

  if (eventRoll === 3) {
    player.stability -= 12
    player.skipActions += 1
    addLog(state, `${player.name} hit a burnout wall.`, 'warn')
    return
  }

  player.creditScore += 16
  player.cash += 20
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
    const assetValue = player.ownedTileIds.reduce((sum, tileId) => {
      const tile = getTile(state, tileId)
      return sum + (tile?.marketPrice ?? 0)
    }, 0)

    const netWorth = player.cash + assetValue - player.debt
    const debtRatio =
      player.debt / Math.max(player.cash + assetValue, 1)
    player.score = Math.round(
      netWorth * 1.2 -
        debtRatio * 70 +
        player.stability * 2 +
        player.ownedTileIds.length * 85,
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

const advanceRound = (state: GameState) => {
  const economy = getEconomySnapshot(state.activeEffects)

  state.players.forEach((player) => {
    const job = JOBS[player.jobId]
    let salary = job.salary * economy.incomeMultiplier

    if (player.stability < 35) {
      salary *= 0.84
    }

    if (player.survivalRounds > 0) {
      salary *= 0.72
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

    maybeTriggerPersonalEvent(state, player)
    normalizePlayerState(player)
  })

  state.tiles.forEach((tile) => {
    if (tile.type !== 'property') {
      return
    }

    const growthMultiplier = 1 + tile.growth + economy.rentGrowthBonus
    tile.currentRent = Math.round(tile.currentRent * growthMultiplier)
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
    createListing(state, 'Scheduled auction', 1.08, 2)
  }

  state.players
    .filter((player) => !player.isHuman)
    .forEach((player) => maybeBuyForAi(state, player))

  updateScores(state)

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

  const lowCash = player.cash < 70
  const shouldGig = lowCash || player.archetype === 'opportunist'
  const moveBias: Record<Archetype, number> = {
    stability: 0.7,
    opportunist: 0.84,
    social: 0.66,
    'asset-hunter': 0.72,
  }

  if (player.moveCooldown === 0 && chance(moveBias[player.archetype])) {
    movePlayer(state, player.id)
    return
  }

  if (player.gigCooldown === 0 && shouldGig && chance(0.68)) {
    gigForPlayer(state, player.id)
    return
  }

  if (player.cash < 45 && chance(0.45)) {
    takeLoan(state, player.id, player.creditScore > 650 ? 'large' : 'small')
  }
}

export const createInitialGame = (config: GameConfig): GameState => {
  const aiPlayers = AI_ROSTER.slice(0, config.aiCount).map((profile, index) => ({
    id: profile.id,
    name: profile.name,
    color: profile.color,
    isHuman: false,
    archetype: profile.archetype,
    jobId: profile.jobId,
    cash: 220 - index * 12,
    debt: 120 + index * 28,
    creditScore: 650 - index * 16,
    stability: 66 - index * 3,
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
    trustInHuman: 58,
    score: 0,
  }))

  const humanPlayer: PlayerState = {
    id: HUMAN_ID,
    name: config.playerName.trim() || 'You',
    color: '#111111',
    isHuman: true,
    archetype: 'social',
    jobId: config.jobId,
    cash: 240,
    debt: 135,
    creditScore: 682,
    stability: 72,
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
    config,
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
    })),
    players: [humanPlayer, ...aiPlayers],
    marketListings: [],
    activeEffects: [],
    currentHeadline: 'Prototype speed',
    alerts: ['Client-only prototype: React front end tuned for GitHub Pages deployment.'],
    logs: [],
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

  const human = getHuman(next)
  if (human) {
    const economy = getEconomySnapshot(next.activeEffects)
    const nextBill = getLivingCost(human, economy.livingCostMultiplier)
    if (human.cash < nextBill && human.creditScore < 520) {
      addAlert(next, 'Default risk: the next living-cost tick may break you.')
    }
    if (human.peerLoan && human.peerLoan.dueRound === next.round) {
      addAlert(next, 'Bridge loan due this round. Trust expires fast.')
    }
  }

  return next
}

export const performMove = (game: GameState) => {
  const next = structuredClone(game)
  movePlayer(next, HUMAN_ID)
  updateScores(next)
  return next
}

export const performGig = (game: GameState) => {
  const next = structuredClone(game)
  gigForPlayer(next, HUMAN_ID)
  updateScores(next)
  return next
}

export const performLoan = (game: GameState, size: LoanSize) => {
  const next = structuredClone(game)
  takeLoan(next, HUMAN_ID, size)
  updateScores(next)
  return next
}

export const performBuyout = (game: GameState, tileId: number) => {
  const next = structuredClone(game)
  buyListing(next, HUMAN_ID, tileId)
  updateScores(next)
  return next
}

export const performRoommateRequest = (game: GameState, partnerId: string) => {
  const next = structuredClone(game)
  requestRoommatePact(next, partnerId)
  updateScores(next)
  return next
}

export const performBridgeLoanRequest = (game: GameState) => {
  const next = structuredClone(game)
  requestBridgeLoan(next)
  updateScores(next)
  return next
}

export const performBridgeRepayment = (game: GameState) => {
  const next = structuredClone(game)
  repayBridgeLoan(next)
  updateScores(next)
  return next
}

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

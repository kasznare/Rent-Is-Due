import { startTransition, useEffect, useReducer, useState } from 'react'
import './App.css'
import {
  BASE_TICK_MS,
  GAME_SECONDS_PER_TICK,
  JOBS,
  TICKS_PER_ROUND,
} from './game/data'
import {
  advanceTick,
  createInitialGame,
  createLastMatchSnapshot,
  formatMoney,
  formatTime,
  getHumanPlayer,
  getOwnedProperties,
  getPassiveIncomeValue,
  getPropertyPassiveIncomeValue,
  getPropertyUpgradeCost,
  getRoundInterestRate,
  getUpcomingLivingCost,
  performBridgeLoanRequest,
  performBridgeRepayment,
  performBuyout,
  performGig,
  performLoan,
  performMove,
  performPropertyStrategy,
  performPropertyUpgrade,
  performRoommateRequest,
  performSupportTransfer,
} from './game/engine'
import type {
  GameConfig,
  GameState,
  JobId,
  LastMatchSnapshot,
  LoanSize,
  PlayerState,
  PropertyStrategy,
} from './game/types'
import {
  loadDraft,
  loadLastMatch,
  loadSavedGame,
  loadTutorialDismissed,
  saveDraft,
  saveGame,
  saveLastMatch,
  saveTutorialDismissed,
} from './storage'

type Action =
  | { type: 'clear' }
  | { type: 'start'; config: GameConfig }
  | { type: 'tick' }
  | { type: 'move' }
  | { type: 'gig' }
  | { type: 'loan'; size: LoanSize }
  | { type: 'buyout'; tileId: number }
  | { type: 'roommate'; partnerId: string }
  | { type: 'support'; partnerId: string }
  | { type: 'bridge-loan' }
  | { type: 'repay-bridge' }
  | { type: 'upgrade-property'; tileId: number }
  | { type: 'property-strategy'; tileId: number; strategy: PropertyStrategy }

const SPEED_OPTIONS = [1, 2, 4]

const gameReducer = (state: GameState | null, action: Action) => {
  if (action.type === 'clear') {
    return null
  }

  if (action.type === 'start') {
    return createInitialGame(action.config)
  }

  if (!state) {
    return state
  }

  if (action.type === 'tick') {
    return advanceTick(state)
  }

  if (action.type === 'move') {
    return performMove(state)
  }

  if (action.type === 'gig') {
    return performGig(state)
  }

  if (action.type === 'loan') {
    return performLoan(state, action.size)
  }

  if (action.type === 'buyout') {
    return performBuyout(state, action.tileId)
  }

  if (action.type === 'roommate') {
    return performRoommateRequest(state, action.partnerId)
  }

  if (action.type === 'support') {
    return performSupportTransfer(state, action.partnerId)
  }

  if (action.type === 'bridge-loan') {
    return performBridgeLoanRequest(state)
  }

  if (action.type === 'repay-bridge') {
    return performBridgeRepayment(state)
  }

  if (action.type === 'upgrade-property') {
    return performPropertyUpgrade(state, action.tileId)
  }

  if (action.type === 'property-strategy') {
    return performPropertyStrategy(state, action.tileId, action.strategy)
  }

  return state
}

const getRiskState = (player: PlayerState, nextBill: number) => {
  if (player.survivalRounds > 0 || player.creditScore < 500) {
    return 'critical'
  }

  if (player.cash <= nextBill * 3 || player.debt > player.cash * 2.2) {
    return 'tight'
  }

  return 'stable'
}

const getStatusText = (player: PlayerState) => {
  if (player.survivalRounds > 0) {
    return `Survival Mode ${player.survivalRounds}r`
  }

  if (player.livingStatus === 'owner') {
    return 'Owner'
  }

  if (player.livingStatus === 'roommates') {
    return 'Roommates'
  }

  return 'Solo'
}

const getRoleText = (player: PlayerState) => {
  if (player.isHuman) {
    return 'You'
  }

  return player.archetype.replace('-', ' ')
}

const getMoveHint = (player: PlayerState) => {
  if (player.workLock > 0) {
    return `Working for ${player.workLock} ticks`
  }

  if (player.skipActions > 0) {
    return `Burnout lock for ${player.skipActions} ticks`
  }

  if (player.moveCooldown > 0) {
    return `Move ready in ${player.moveCooldown} ticks`
  }

  return 'Ready now'
}

const getGigHint = (player: PlayerState) => {
  if (player.workLock > 0) {
    return `Job lock for ${player.workLock} ticks`
  }

  if (player.skipActions > 0) {
    return `Burnout lock for ${player.skipActions} ticks`
  }

  if (player.gigCooldown > 0) {
    return `Gig ready in ${player.gigCooldown} ticks`
  }

  return 'Ready now'
}

const getLargeLoanHint = (player: PlayerState) => {
  if (player.survivalRounds > 0) {
    return 'Blocked in Survival Mode'
  }

  if (player.creditScore <= 600) {
    return 'Needs 600+ credit'
  }

  if (player.debt >= 540) {
    return 'Debt ceiling reached'
  }

  return 'Available'
}

const getSupportHint = (player: PlayerState) => {
  if (player.cash < 24) {
    return 'Need $24 cash to build trust'
  }

  return 'Use cash to improve future deals'
}

const createRandomSeed = () => `seed-${Date.now().toString(36)}`

function App() {
  const [draft, setDraft] = useState<GameConfig>(() => loadDraft())
  const [game, dispatch] = useReducer(gameReducer, null, () => loadSavedGame())
  const [speed, setSpeed] = useState(2)
  const [paused, setPaused] = useState(false)
  const [lastMatch, setLastMatch] = useState<LastMatchSnapshot | null>(() => loadLastMatch())
  const [showTutorial, setShowTutorial] = useState(() => !loadTutorialDismissed())
  const clockPaused = paused || game?.phase === 'finished'

  useEffect(() => {
    saveDraft(draft)
  }, [draft])

  useEffect(() => {
    saveGame(game)
  }, [game])

  useEffect(() => {
    saveTutorialDismissed(!showTutorial)
  }, [showTutorial])

  useEffect(() => {
    if (!game || game.phase !== 'running' || clockPaused) {
      return
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: 'tick' })
    }, BASE_TICK_MS / speed)

    return () => window.clearTimeout(timeout)
  }, [clockPaused, game, speed])

  const persistFinishedGame = (current: GameState | null) => {
    if (!current || current.phase !== 'finished') {
      return
    }

    const snapshot = createLastMatchSnapshot(current)
    if (!snapshot) {
      return
    }

    saveLastMatch(snapshot)
    setLastMatch(snapshot)
  }

  const clearToLobby = () => {
    persistFinishedGame(game)
    setPaused(false)
    startTransition(() => dispatch({ type: 'clear' }))
  }

  const startMatch = (config: GameConfig) => {
    persistFinishedGame(game)
    setPaused(false)
    startTransition(() => dispatch({ type: 'start', config }))
  }

  const human = game ? getHumanPlayer(game) : null
  const sortedPlayers = game
    ? [...game.players].sort((left, right) => right.score - left.score)
    : []
  const outstandingLender =
    game && human?.peerLoan
      ? game.players.find((player) => player.id === human.peerLoan?.lenderId) ?? null
      : null
  const nextBill = game && human ? getUpcomingLivingCost(game, human) : 0
  const passiveIncome = game && human ? getPassiveIncomeValue(game, human) : 0
  const roundInterest = game && human ? getRoundInterestRate(game, human) : 0
  const riskState = human ? getRiskState(human, nextBill) : 'stable'
  const ticksLeft = game ? TICKS_PER_ROUND - game.tickInRound : TICKS_PER_ROUND
  const secondsToRound = ticksLeft * GAME_SECONDS_PER_TICK
  const nextRoundLabel =
    game?.phase === 'finished' ? 'Complete' : formatTime(secondsToRound)
  const availableRoommates = game
    ? game.players.filter(
        (player) =>
          !player.isHuman &&
          !player.roommateWith &&
          player.livingStatus === 'solo' &&
          player.ownedTileIds.length === 0,
      )
    : []
  const ownedProperties = game && human ? getOwnedProperties(game, human.id) : []
  const winner =
    game?.phase === 'finished'
      ? sortedPlayers[0] ?? null
      : null
  const canLargeLoan = human
    ? human.creditScore > 600 &&
      human.debt < 540 &&
      human.survivalRounds === 0
    : false

  return (
    <div className="app-shell">
      {game ? (
        <>
          <header className="topbar">
            <div className="topbar__title">
              <p className="eyebrow">Gen Z Monopoly</p>
              <h1>Rent is due. The clock never stops.</h1>
              <p className="lede">
                Seeded simulation build. Runs are now reproducible, round summaries
                persist, and the housing loop is tuned to be harsh without instantly
                collapsing every player.
              </p>
            </div>

            <div className="topbar__meta">
              <div className="pillbox">
                <span>Round</span>
                <strong>
                  {game.round} / {game.totalRounds}
                </strong>
              </div>
              <div className="pillbox">
                <span>Next round</span>
                <strong>{nextRoundLabel}</strong>
              </div>
              <div className="pillbox">
                <span>Seed</span>
                <strong>{game.config.seed}</strong>
              </div>
              <div className="pillbox">
                <span>Elapsed</span>
                <strong>{formatTime(game.gameSecondsElapsed)}</strong>
              </div>
              <div className="speed-switch">
                {SPEED_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={option === speed ? 'is-active' : undefined}
                    onClick={() => setSpeed(option)}
                    type="button"
                  >
                    {option}x
                  </button>
                ))}
              </div>
              <button
                className="secondary"
                disabled={game.phase === 'finished'}
                onClick={() => setPaused((value) => !value)}
                type="button"
              >
                {game.phase === 'finished'
                  ? 'Finished'
                  : clockPaused
                    ? 'Resume'
                    : 'Pause'}
              </button>
              <button
                className="secondary"
                onClick={() => setShowTutorial(true)}
                type="button"
              >
                Guide
              </button>
              <button
                className="secondary"
                onClick={clearToLobby}
                type="button"
              >
                Back to lobby
              </button>
            </div>
          </header>

          <main className="dashboard">
            <section className="panel panel--board">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Board</p>
                  <h2>Heatmap of rent pressure</h2>
                </div>
                <div className="headline-card">
                  <span>Headline</span>
                  <strong>{game.currentHeadline ?? 'Noisy calm'}</strong>
                </div>
              </div>

              <div className="effects-row">
                {game.activeEffects.length > 0 ? (
                  game.activeEffects.map((effect) => (
                    <article className="effect-card" key={effect.id}>
                      <span>{effect.remainingRounds}r</span>
                      <strong>{effect.title}</strong>
                      <p>{effect.description}</p>
                    </article>
                  ))
                ) : (
                  <article className="effect-card effect-card--muted">
                    <span>0r</span>
                    <strong>No active macro shock</strong>
                    <p>The economy is still bad, just not unusually bad.</p>
                  </article>
                )}
              </div>

              <div className="board-grid">
                {game.tiles.map((tile) => {
                  const occupants = game.players.filter(
                    (player) => player.position === tile.id,
                  )
                  const owner = tile.ownerId
                    ? game.players.find((player) => player.id === tile.ownerId) ?? null
                    : null

                  return (
                    <article
                      className={`tile tile--${tile.type} tile--${tile.demand}`}
                      key={tile.id}
                    >
                      <div className="tile__meta">
                        <span className="tile__index">{tile.id}</span>
                        <span className="tile__district">{tile.district}</span>
                      </div>
                      <h3>{tile.name}</h3>
                      <p>{tile.flavor}</p>
                      <div className="tile__footer">
                        {tile.type === 'property' ? (
                          <>
                            <strong>{formatMoney(tile.currentRent)}</strong>
                            <span>
                              {owner
                                ? `${owner.name} · ${tile.strategy} · U${tile.upgradeLevel}`
                                : 'Market-owned'}
                            </span>
                          </>
                        ) : tile.type === 'market' ? (
                          <>
                            <strong>Market</strong>
                            <span>Generates buyout windows</span>
                          </>
                        ) : (
                          <>
                            <strong>Event</strong>
                            <span>Random pressure or relief</span>
                          </>
                        )}
                      </div>
                      {tile.listed ? <div className="tile__tag">Listed</div> : null}
                      <div className="tile__tokens">
                        {occupants.map((player) => (
                          <span
                            key={player.id}
                            className="token"
                            style={{ backgroundColor: player.color }}
                            title={player.name}
                          >
                            {player.name.slice(0, 1)}
                          </span>
                        ))}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="panel panel--controls">
              {human ? (
                <>
                  <div className={`status-hero status-hero--${riskState}`}>
                    <div>
                      <p className="eyebrow">Your state</p>
                      <h2>{human.name}</h2>
                      <p className="risk-copy">
                        {riskState === 'critical'
                          ? 'You are operating inside hard constraints. Stabilize first.'
                          : riskState === 'tight'
                            ? 'You have options, but each one mortgages a future turn.'
                            : 'You still have room to play for leverage instead of pure survival.'}
                      </p>
                    </div>
                    <div className="status-badge">{getStatusText(human)}</div>
                  </div>

                  <div className="stats-grid">
                    <article className="stat-card">
                      <span>Cash</span>
                      <strong>{formatMoney(human.cash)}</strong>
                    </article>
                    <article className="stat-card">
                      <span>Debt</span>
                      <strong>{formatMoney(human.debt)}</strong>
                    </article>
                    <article className="stat-card">
                      <span>Credit</span>
                      <strong>{human.creditScore}</strong>
                    </article>
                    <article className="stat-card">
                      <span>Stability</span>
                      <strong>{human.stability}</strong>
                    </article>
                    <article className="stat-card">
                      <span>Next living tick</span>
                      <strong>{formatMoney(nextBill)}</strong>
                    </article>
                    <article className="stat-card">
                      <span>Round interest</span>
                      <strong>{Math.round(roundInterest * 100)}%</strong>
                    </article>
                    <article className="stat-card">
                      <span>Passive / tick</span>
                      <strong>{formatMoney(passiveIncome)}</strong>
                    </article>
                    <article className="stat-card">
                      <span>Score</span>
                      <strong>{human.score}</strong>
                    </article>
                  </div>

                  {game.alerts.length > 0 ? (
                    <div className="alerts">
                      {game.alerts.map((alert) => (
                        <p key={alert}>{alert}</p>
                      ))}
                    </div>
                  ) : null}

                  <section className="subpanel">
                    <div className="subpanel__header">
                      <div>
                        <p className="eyebrow">Action windows</p>
                        <h3>What is open right now</h3>
                      </div>
                    </div>
                    <div className="hint-grid">
                      <article className="hint-card">
                        <strong>Move</strong>
                        <p>{getMoveHint(human)}</p>
                      </article>
                      <article className="hint-card">
                        <strong>Gig</strong>
                        <p>{getGigHint(human)}</p>
                      </article>
                      <article className="hint-card">
                        <strong>Large loan</strong>
                        <p>{getLargeLoanHint(human)}</p>
                      </article>
                      <article className="hint-card">
                        <strong>Trust</strong>
                        <p>{getSupportHint(human)}</p>
                      </article>
                    </div>
                  </section>

                  <div className="actions-grid">
                    <button
                      className="primary"
                      disabled={human.moveCooldown > 0 || human.workLock > 0 || human.skipActions > 0}
                      onClick={() => dispatch({ type: 'move' })}
                      type="button"
                    >
                      Move
                      <span>{getMoveHint(human)}</span>
                    </button>

                    <button
                      className="primary"
                      disabled={human.gigCooldown > 0 || human.workLock > 0 || human.skipActions > 0}
                      onClick={() => dispatch({ type: 'gig' })}
                      type="button"
                    >
                      Work a gig
                      <span>{getGigHint(human)}</span>
                    </button>

                    <button
                      className="secondary"
                      onClick={() => dispatch({ type: 'loan', size: 'small' })}
                      type="button"
                    >
                      Small loan
                      <span>Fast approval, higher drag later</span>
                    </button>

                    <button
                      className="secondary"
                      disabled={!canLargeLoan}
                      onClick={() => dispatch({ type: 'loan', size: 'large' })}
                      type="button"
                    >
                      Large loan
                      <span>{getLargeLoanHint(human)}</span>
                    </button>

                    <button
                      className="secondary"
                      disabled={Boolean(human.peerLoan)}
                      onClick={() => dispatch({ type: 'bridge-loan' })}
                      type="button"
                    >
                      Ask table for help
                      <span>Generic bridge loan from the best-trusting rival</span>
                    </button>

                    <button
                      className="secondary"
                      disabled={!human.peerLoan}
                      onClick={() => dispatch({ type: 'repay-bridge' })}
                      type="button"
                    >
                      Repay bridge loan
                      <span>
                        {human.peerLoan && outstandingLender
                          ? `${formatMoney(human.peerLoan.amount)} to ${outstandingLender.name}`
                          : 'Nothing outstanding'}
                      </span>
                    </button>
                  </div>

                  <section className="subpanel">
                    <div className="subpanel__header">
                      <div>
                        <p className="eyebrow">Market</p>
                        <h3>Late-game buyouts</h3>
                      </div>
                      <span>{game.marketListings.length} open</span>
                    </div>
                    <div className="listing-grid">
                      {game.marketListings.length > 0 ? (
                        game.marketListings.map((listing) => {
                          const tile = game.tiles.find((item) => item.id === listing.tileId)

                          if (!tile) {
                            return null
                          }

                          return (
                            <article className="listing-card" key={listing.tileId}>
                              <div>
                                <p>{listing.tag}</p>
                                <h4>{tile.name}</h4>
                                <span>
                                  {tile.district} · {tile.demand} demand
                                </span>
                              </div>
                              <div className="listing-card__meta">
                                <strong>{formatMoney(listing.price)}</strong>
                                <span>Expires round {listing.expiresRound}</span>
                              </div>
                              <button
                                className="secondary"
                                onClick={() =>
                                  dispatch({ type: 'buyout', tileId: listing.tileId })
                                }
                                type="button"
                              >
                                Buy from market
                              </button>
                            </article>
                          )
                        })
                      ) : (
                        <article className="listing-card listing-card--muted">
                          <div>
                            <p>No listing</p>
                            <h4>The market is holding inventory</h4>
                            <span>Auctions appear through events and round pressure.</span>
                          </div>
                        </article>
                      )}
                    </div>
                  </section>

                  <section className="subpanel">
                    <div className="subpanel__header">
                      <div>
                        <p className="eyebrow">Ownership</p>
                        <h3>Manage your holdings</h3>
                      </div>
                      <span>{ownedProperties.length} owned</span>
                    </div>
                    <div className="property-grid">
                      {ownedProperties.length > 0 ? (
                        ownedProperties.map((tile) => {
                          const upgradeCost = getPropertyUpgradeCost(game, tile.id)
                          const passivePerTile = getPropertyPassiveIncomeValue(game, tile.id)

                          return (
                            <article className="property-card" key={tile.id}>
                              <div>
                                <p>{tile.district}</p>
                                <h4>{tile.name}</h4>
                                <span>
                                  Rent {formatMoney(tile.currentRent)} · Passive{' '}
                                  {formatMoney(passivePerTile)} / tick
                                </span>
                              </div>
                              <div className="property-card__stats">
                                <span>Upgrade {tile.upgradeLevel} / 2</span>
                                <span>Policy {tile.strategy}</span>
                              </div>
                              <div className="property-card__actions">
                                <button
                                  className="secondary"
                                  disabled={tile.upgradeLevel >= 2}
                                  onClick={() =>
                                    dispatch({
                                      type: 'upgrade-property',
                                      tileId: tile.id,
                                    })
                                  }
                                  type="button"
                                >
                                  Upgrade
                                  <span>
                                    {tile.upgradeLevel >= 2
                                      ? 'Maxed'
                                      : formatMoney(upgradeCost)}
                                  </span>
                                </button>
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: 'property-strategy',
                                      tileId: tile.id,
                                      strategy:
                                        tile.strategy === 'extract'
                                          ? 'stabilize'
                                          : 'extract',
                                    })
                                  }
                                  type="button"
                                >
                                  {tile.strategy === 'extract'
                                    ? 'Switch to stabilize'
                                    : 'Switch to extract'}
                                  <span>
                                    {tile.strategy === 'extract'
                                      ? 'Lower growth, steadier trust'
                                      : 'Higher growth, harder pressure'}
                                  </span>
                                </button>
                              </div>
                            </article>
                          )
                        })
                      ) : (
                        <article className="property-card property-card--muted">
                          <div>
                            <h4>No owned properties</h4>
                            <p>Buyouts unlock upgrades and policy choices.</p>
                          </div>
                        </article>
                      )}
                    </div>
                  </section>

                  <section className="subpanel">
                    <div className="subpanel__header">
                      <div>
                        <p className="eyebrow">Social</p>
                        <h3>Trust, support, and roommates</h3>
                      </div>
                      <span>
                        {human.roommateWith
                          ? `Sharing with ${
                              game.players.find((player) => player.id === human.roommateWith)?.name
                            }`
                          : 'No pact'}
                      </span>
                    </div>
                    <div className="roommate-grid">
                      {availableRoommates.length > 0 ? (
                        availableRoommates.map((player) => (
                          <article className="roommate-card" key={player.id}>
                            <div>
                              <h4>{player.name}</h4>
                              <p>{getRoleText(player)}</p>
                            </div>
                            <div className="roommate-card__stats">
                              <span>Cash {formatMoney(player.cash)}</span>
                              <span>Trust {player.trustInHuman}</span>
                            </div>
                            <div className="roommate-card__actions">
                              <button
                                className="secondary"
                                onClick={() =>
                                  dispatch({ type: 'roommate', partnerId: player.id })
                                }
                                type="button"
                              >
                                Pitch roommate deal
                              </button>
                              <button
                                className="secondary"
                                disabled={human.cash < 24}
                                onClick={() =>
                                  dispatch({ type: 'support', partnerId: player.id })
                                }
                                type="button"
                              >
                                Send support
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <article className="roommate-card roommate-card--muted">
                          <div>
                            <h4>No available partners</h4>
                            <p>The room is either housed, broke, or distrustful.</p>
                          </div>
                        </article>
                      )}
                    </div>
                  </section>
                </>
              ) : null}
            </section>

            <aside className="sidebar">
              <section className="panel panel--leaderboard">
                <div className="panel__header">
                  <div>
                    <p className="eyebrow">Standings</p>
                    <h2>Scoreboard</h2>
                  </div>
                </div>
                <div className="leaderboard">
                  {sortedPlayers.map((player, index) => (
                    <article
                      className={`leaderboard-card ${
                        player.isHuman ? 'leaderboard-card--human' : ''
                      }`}
                      key={player.id}
                    >
                      <div className="leaderboard-card__top">
                        <div className="identity">
                          <span
                            className="identity__dot"
                            style={{ backgroundColor: player.color }}
                          />
                          <div>
                            <strong>
                              #{index + 1} {player.name}
                            </strong>
                            <p>
                              {getRoleText(player)} · {JOBS[player.jobId].name}
                            </p>
                          </div>
                        </div>
                        <span className="leaderboard-card__score">{player.score}</span>
                      </div>
                      <div className="leaderboard-card__stats">
                        <span>Cash {formatMoney(player.cash)}</span>
                        <span>Debt {formatMoney(player.debt)}</span>
                        <span>{getStatusText(player)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel panel--summary">
                <div className="panel__header">
                  <div>
                    <p className="eyebrow">Round recap</p>
                    <h2>Recent rounds</h2>
                  </div>
                  <span>{game.roundSummaries.length} stored</span>
                </div>
                <div className="summary-stream">
                  {game.roundSummaries.length > 0 ? (
                    game.roundSummaries.map((summary) => (
                      <article className="summary-card" key={summary.id}>
                        <div className="summary-card__top">
                          <strong>Round {summary.round}</strong>
                          <span>{summary.headline ?? 'No headline'}</span>
                        </div>
                        <div className="summary-card__leaders">
                          {summary.players.slice(0, 2).map((player) => (
                            <p key={player.id}>
                              {player.name}: {player.score}
                            </p>
                          ))}
                        </div>
                        <div className="summary-card__notes">
                          {summary.notes.map((note) => (
                            <p key={note}>{note}</p>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <article className="summary-card summary-card--muted">
                      <p>Round summaries appear after each completed round.</p>
                    </article>
                  )}
                </div>
              </section>

              <section className="panel panel--log">
                <div className="panel__header">
                  <div>
                    <p className="eyebrow">Feed</p>
                    <h2>Event log</h2>
                  </div>
                  <span>{game.logs.length} entries</span>
                </div>
                <div className="log-stream">
                  {game.logs.map((entry) => (
                    <article className={`log-entry log-entry--${entry.tone}`} key={entry.id}>
                      <span>R{entry.round}</span>
                      <p>{entry.message}</p>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </main>

          {winner ? (
            <div className="overlay">
              <div className="overlay__card">
                <p className="eyebrow">Match complete</p>
                <h2>{winner.isHuman ? 'You escaped on top.' : `${winner.name} won.`}</h2>
                <p>
                  Seed <strong>{game.config.seed}</strong>. Final score {winner.score}. The
                  match now stores recent round summaries for replay and balancing work.
                </p>
                <div className="overlay__ranking">
                  {sortedPlayers.map((player, index) => (
                    <div className="overlay__row" key={player.id}>
                      <span>#{index + 1}</span>
                      <strong>{player.name}</strong>
                      <span>{player.score}</span>
                    </div>
                  ))}
                </div>
                <div className="overlay__summary-list">
                  {game.roundSummaries.slice(0, 3).map((summary) => (
                    <article className="summary-card" key={summary.id}>
                      <div className="summary-card__top">
                        <strong>Round {summary.round}</strong>
                        <span>{summary.headline ?? 'No headline'}</span>
                      </div>
                      <div className="summary-card__notes">
                        {summary.notes.map((note) => (
                          <p key={note}>{note}</p>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="overlay__actions">
                  <button
                    className="primary"
                    onClick={() => startMatch(draft)}
                    type="button"
                  >
                    Run it again
                  </button>
                  <button
                    className="secondary"
                    onClick={clearToLobby}
                    type="button"
                  >
                    Back to lobby
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <main className="setup">
          <section className="setup__hero">
            <p className="eyebrow">Static React build</p>
            <h1>GEN Z MONOPOLY</h1>
            <p className="setup__lede">
              A real-time economic survival prototype with seeded runs, debt,
              inflation, trust-driven social actions, and ownership decisions that
              continue after purchase.
            </p>
            <div className="setup__stats">
              <article>
                <strong>3s</strong>
                <span>In-game tick</span>
              </article>
              <article>
                <strong>Seeded</strong>
                <span>Deterministic runs</span>
              </article>
              <article>
                <strong>Stored</strong>
                <span>Draft + last match</span>
              </article>
            </div>
          </section>

          <section className="setup__form">
            <div className="form-card">
              <label className="field">
                <span>Player name</span>
                <input
                  maxLength={18}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      playerName: event.target.value,
                    }))
                  }
                  placeholder="You"
                  type="text"
                  value={draft.playerName}
                />
              </label>

              <div className="field">
                <span>Choose your job</span>
                <div className="job-grid">
                  {Object.values(JOBS).map((job) => (
                    <button
                      className={`job-card ${
                        draft.jobId === job.id ? 'job-card--active' : ''
                      }`}
                      key={job.id}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          jobId: job.id as JobId,
                        }))
                      }
                      type="button"
                    >
                      <strong>{job.name}</strong>
                      <p>{job.tagline}</p>
                      <span>
                        Salary {formatMoney(job.salary)} · Move CD {job.moveCooldown}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>Match length</span>
                  <select
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        totalRounds: Number(event.target.value),
                      }))
                    }
                    value={draft.totalRounds}
                  >
                    <option value={10}>Quick match</option>
                    <option value={12}>Standard</option>
                    <option value={14}>Long match</option>
                  </select>
                </label>

                <label className="field">
                  <span>AI rivals</span>
                  <select
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        aiCount: Number(event.target.value),
                      }))
                    }
                    value={draft.aiCount}
                  >
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                  </select>
                </label>
              </div>

              <div className="field">
                <span>Seed</span>
                <div className="seed-row">
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        seed: event.target.value,
                      }))
                    }
                    placeholder="rent-is-due"
                    type="text"
                    value={draft.seed}
                  />
                  <button
                    className="secondary"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        seed: createRandomSeed(),
                      }))
                    }
                    type="button"
                  >
                    Randomize
                  </button>
                </div>
              </div>

              <div className="setup__actions">
                <button
                  className="primary primary--large"
                  onClick={() => startMatch(draft)}
                  type="button"
                >
                  Start match
                </button>
                <button
                  className="secondary"
                  onClick={() => setShowTutorial(true)}
                  type="button"
                >
                  Open guide
                </button>
              </div>
            </div>

            <div className="feature-stack">
              <article className="feature-card">
                <p className="eyebrow">Core loop</p>
                <h2>Survive the next bill without ruining the round after it.</h2>
                <p>
                  The economy now runs on seeded randomness, so a bad run can be
                  replayed, tuned, and tested instead of hand-waved as luck.
                </p>
              </article>

              <article className="feature-card">
                <p className="eyebrow">Social layer</p>
                <h2>Trust is now a resource you can invest in.</h2>
                <p>
                  Support transfers raise trust, roommate pacts reduce burn, and
                  informal loans still carry social risk if you flake on repayment.
                </p>
              </article>

              <article className="feature-card">
                <p className="eyebrow">Ownership loop</p>
                <h2>Buying an asset is the start of a decision tree.</h2>
                <p>
                  Upgrades and strategy toggles let you play for extraction or
                  stabilization instead of treating ownership as a pure score bump.
                </p>
              </article>

              {lastMatch ? (
                <article className="feature-card feature-card--last-match">
                  <p className="eyebrow">Last match</p>
                  <h2>
                    {lastMatch.winnerName} won on seed <code>{lastMatch.seed}</code>
                  </h2>
                  <p>
                    Score {lastMatch.winnerScore}. {lastMatch.totalRounds} rounds
                    recorded.
                  </p>
                  <div className="last-match__list">
                    {lastMatch.summaries.slice(0, 3).map((summary) => (
                      <div className="last-match__item" key={summary.id}>
                        <strong>Round {summary.round}</strong>
                        <span>{summary.headline ?? 'No headline'}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}
            </div>
          </section>
        </main>
      )}

      {showTutorial ? (
        <div className="overlay">
          <div className="overlay__card overlay__card--guide">
            <p className="eyebrow">Guide</p>
            <h2>How to read the pressure loop</h2>
            <div className="guide-grid">
              <article className="guide-card">
                <strong>1. Ticks hurt first</strong>
                <p>Every tick applies living costs and passive income before the next round resets salaries.</p>
              </article>
              <article className="guide-card">
                <strong>2. Rounds reshape the economy</strong>
                <p>Debt compounds, rent grows, events trigger, and the board usually gets meaner.</p>
              </article>
              <article className="guide-card">
                <strong>3. Trust is convertible</strong>
                <p>Support actions improve trust, which makes roommate and informal-loan outcomes better later.</p>
              </article>
              <article className="guide-card">
                <strong>4. Ownership needs management</strong>
                <p>Upgrades increase value, and property strategy changes whether you optimize for extraction or stability.</p>
              </article>
            </div>
            <div className="overlay__actions">
              <button
                className="primary"
                onClick={() => setShowTutorial(false)}
                type="button"
              >
                Close guide
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App

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
  getDisplayedPlayerPosition,
  getHumanMoveOptions,
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
  performMoveSettle,
  performMoveStep,
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

type OverlayKey = 'market' | 'social' | 'assets' | 'feed' | 'standings' | 'summary'

type Action =
  | { type: 'clear' }
  | { type: 'start'; config: GameConfig }
  | { type: 'tick' }
  | { type: 'move' }
  | { type: 'move-step'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'move-settle' }
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

  if (action.type === 'move-step') {
    return performMoveStep(state, action.direction)
  }

  if (action.type === 'move-settle') {
    return performMoveSettle(state)
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
    return `Survival ${player.survivalRounds}r`
  }

  if (player.livingStatus === 'owner') {
    return 'Owner'
  }

  if (player.livingStatus === 'roommates') {
    return 'Roommates'
  }

  return 'Solo'
}

const getRoleText = (player: PlayerState) =>
  player.isHuman ? 'You' : player.archetype.replace('-', ' ')

const createRandomSeed = () => `nyc-${Date.now().toString(36)}`

function App() {
  const [draft, setDraft] = useState<GameConfig>(() => loadDraft())
  const [game, dispatch] = useReducer(gameReducer, null, () => loadSavedGame())
  const [speed, setSpeed] = useState(2)
  const [paused, setPaused] = useState(false)
  const [overlay, setOverlay] = useState<OverlayKey | null>(null)
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
    setOverlay(null)
    setPaused(false)
    startTransition(() => dispatch({ type: 'clear' }))
  }

  const startMatch = (config: GameConfig) => {
    persistFinishedGame(game)
    setOverlay(null)
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
  const moveOptions = game ? getHumanMoveOptions(game) : null
  const humanPendingMove =
    game && human && game.pendingMove?.playerId === human.id ? game.pendingMove : null
  const winner = game?.phase === 'finished' ? sortedPlayers[0] ?? null : null
  const canLargeLoan = human
    ? human.creditScore > 600 && human.debt < 540 && human.survivalRounds === 0
    : false

  return (
    <div className="app-shell">
      {game ? (
        <>
          <header className="city-header">
            <div className="city-header__title">
              <p className="eyebrow">Gen Z Monopoly</p>
              <h1>Move the grid. Hold the rent line.</h1>
            </div>

            <div className="city-header__stats">
              <div className="hud-card">
                <span>Cash</span>
                <strong>{formatMoney(human?.cash ?? 0)}</strong>
              </div>
              <div className="hud-card">
                <span>Debt</span>
                <strong>{formatMoney(human?.debt ?? 0)}</strong>
              </div>
              <div className="hud-card">
                <span>Next bill</span>
                <strong>{formatMoney(nextBill)}</strong>
              </div>
              <div className="hud-card">
                <span>Round</span>
                <strong>
                  {game.round}/{game.totalRounds}
                </strong>
              </div>
              <div className="hud-card">
                <span>Next round</span>
                <strong>{nextRoundLabel}</strong>
              </div>
              <div className="hud-card">
                <span>Seed</span>
                <strong>{game.config.seed}</strong>
              </div>
            </div>

            <div className="city-header__actions">
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
              <button className="secondary" onClick={() => setShowTutorial(true)} type="button">
                Guide
              </button>
              <button className="secondary" onClick={clearToLobby} type="button">
                Lobby
              </button>
            </div>
          </header>

          <main className="city-layout">
            <section className="city-stage">
              <div className="city-stage__head">
                <div>
                  <p className="eyebrow">City board</p>
                  <h2>{game.currentHeadline ?? 'Noisy calm'}</h2>
                </div>
                <div className={`status-chip status-chip--${riskState}`}>
                  {human ? getStatusText(human) : 'Watching'}
                </div>
              </div>

              {humanPendingMove ? (
                <div className="route-banner">
                  <strong>{humanPendingMove.stepsRemaining} blocks left</strong>
                  <p>
                    Route: {humanPendingMove.route.map((tileId) => game.tiles[tileId]?.name).join(' -> ')}
                  </p>
                </div>
              ) : null}

              <div className="city-board">
                {game.tiles.map((tile) => {
                  const owner = tile.ownerId
                    ? game.players.find((player) => player.id === tile.ownerId) ?? null
                    : null
                  const occupants = game.players.filter(
                    (player) => getDisplayedPlayerPosition(game, player.id) === tile.id,
                  )
                  const routeIndex = humanPendingMove
                    ? humanPendingMove.route.indexOf(tile.id)
                    : -1

                  return (
                    <article
                      className={`block block--${tile.type} block--${tile.demand} ${
                        routeIndex >= 0 ? 'block--route' : ''
                      } ${humanPendingMove?.cursorPosition === tile.id ? 'block--cursor' : ''}`}
                      key={tile.id}
                      style={{
                        gridColumn: tile.gridX + 1,
                        gridRow: tile.gridY + 1,
                        ['--tower-height' as string]: `${48 + tile.skyline * 12 + tile.upgradeLevel * 12}px`,
                      }}
                    >
                      <div className="block__tower" aria-hidden="true">
                        <div className="block__roof" />
                        <div className="block__front" />
                        <div className="block__side" />
                      </div>
                      <div className="block__content">
                        <div className="block__labels">
                          <span>
                            {tile.gridX + 1} / {tile.gridY + 1}
                          </span>
                          <span>{tile.district}</span>
                        </div>
                        <h3>{tile.name}</h3>
                        <p>{tile.flavor}</p>
                        <div className="block__meta">
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
                              <span>Listings and auctions</span>
                            </>
                          ) : (
                            <>
                              <strong>{tile.type === 'start' ? 'Start' : 'Event'}</strong>
                              <span>Land here for an effect</span>
                            </>
                          )}
                        </div>
                        <div className="block__tokens">
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
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className="overlay-launcher">
                <button className="secondary" onClick={() => setOverlay('market')} type="button">
                  Market
                </button>
                <button className="secondary" onClick={() => setOverlay('social')} type="button">
                  Social
                </button>
                <button className="secondary" onClick={() => setOverlay('assets')} type="button">
                  Assets
                </button>
                <button className="secondary" onClick={() => setOverlay('standings')} type="button">
                  Standings
                </button>
                <button className="secondary" onClick={() => setOverlay('feed')} type="button">
                  Feed
                </button>
                <button className="secondary" onClick={() => setOverlay('summary')} type="button">
                  Recap
                </button>
              </div>
            </section>

            <aside className="command-dock">
              {human ? (
                <>
                  <div className={`status-panel status-panel--${riskState}`}>
                    <p className="eyebrow">Status</p>
                    <h2>{human.name}</h2>
                    <p>
                      {riskState === 'critical'
                        ? 'You are one bad payment away from another forced concession.'
                        : riskState === 'tight'
                          ? 'You still have agency, but every move costs future slack.'
                          : 'You have enough runway to play for position rather than panic.'}
                    </p>
                  </div>

                  <div className="command-section">
                    <p className="eyebrow">Movement</p>
                    <button
                      className="primary"
                      disabled={Boolean(game.pendingMove) || human.moveCooldown > 0 || human.workLock > 0 || human.skipActions > 0}
                      onClick={() => dispatch({ type: 'move' })}
                      type="button"
                    >
                      Open route
                      <span>
                        {human.moveCooldown > 0
                          ? `${human.moveCooldown} ticks cooldown`
                          : 'Roll blocks, then steer the route'}
                      </span>
                    </button>

                    <div className="arrow-pad">
                      <button
                        className="secondary"
                        disabled={!moveOptions?.up}
                        onClick={() => dispatch({ type: 'move-step', direction: 'up' })}
                        type="button"
                      >
                        North
                      </button>
                      <div className="arrow-pad__middle">
                        <button
                          className="secondary"
                          disabled={!moveOptions?.left}
                          onClick={() => dispatch({ type: 'move-step', direction: 'left' })}
                          type="button"
                        >
                          West
                        </button>
                        <button
                          className="secondary"
                          disabled={!game.pendingMove}
                          onClick={() => dispatch({ type: 'move-settle' })}
                          type="button"
                        >
                          Settle here
                        </button>
                        <button
                          className="secondary"
                          disabled={!moveOptions?.right}
                          onClick={() => dispatch({ type: 'move-step', direction: 'right' })}
                          type="button"
                        >
                          East
                        </button>
                      </div>
                      <button
                        className="secondary"
                        disabled={!moveOptions?.down}
                        onClick={() => dispatch({ type: 'move-step', direction: 'down' })}
                        type="button"
                      >
                        South
                      </button>
                    </div>
                  </div>

                  <div className="command-section">
                    <p className="eyebrow">Cash actions</p>
                    <div className="command-grid">
                      <button
                        className="primary"
                        disabled={human.gigCooldown > 0 || human.workLock > 0 || human.skipActions > 0}
                        onClick={() => dispatch({ type: 'gig' })}
                        type="button"
                      >
                        Work a gig
                        <span>
                          {human.gigCooldown > 0
                            ? `${human.gigCooldown} ticks cooldown`
                            : 'Fast cash with variance'}
                        </span>
                      </button>
                      <button
                        className="secondary"
                        onClick={() => dispatch({ type: 'loan', size: 'small' })}
                        type="button"
                      >
                        Small loan
                        <span>Quick liquidity</span>
                      </button>
                      <button
                        className="secondary"
                        disabled={!canLargeLoan}
                        onClick={() => dispatch({ type: 'loan', size: 'large' })}
                        type="button"
                      >
                        Large loan
                        <span>{canLargeLoan ? 'Unlocked' : 'Blocked right now'}</span>
                      </button>
                      <button
                        className="secondary"
                        disabled={Boolean(human.peerLoan)}
                        onClick={() => dispatch({ type: 'bridge-loan' })}
                        type="button"
                      >
                        Ask the table
                        <span>Informal trust loan</span>
                      </button>
                      <button
                        className="secondary"
                        disabled={!human.peerLoan}
                        onClick={() => dispatch({ type: 'repay-bridge' })}
                        type="button"
                      >
                        Repay bridge
                        <span>
                          {human.peerLoan && outstandingLender
                            ? `${formatMoney(human.peerLoan.amount)} to ${outstandingLender.name}`
                            : 'Nothing outstanding'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="command-strip">
                    <div className="mini-stat">
                      <span>Stability</span>
                      <strong>{human.stability}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Interest</span>
                      <strong>{Math.round(roundInterest * 100)}%</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Passive</span>
                      <strong>{formatMoney(passiveIncome)}/tick</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Score</span>
                      <strong>{human.score}</strong>
                    </div>
                  </div>

                  {game.alerts.length > 0 ? (
                    <div className="alert-stack">
                      {game.alerts.map((alert) => (
                        <p key={alert}>{alert}</p>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </aside>
          </main>

          {overlay ? (
            <div className="overlay">
              <div className="overlay__card overlay__card--wide">
                <div className="overlay__header">
                  <div>
                    <p className="eyebrow">Overlay</p>
                    <h2>
                      {overlay === 'market'
                        ? 'Market'
                        : overlay === 'social'
                          ? 'Social'
                          : overlay === 'assets'
                            ? 'Assets'
                            : overlay === 'standings'
                              ? 'Standings'
                              : overlay === 'summary'
                                ? 'Round recap'
                                : 'Event feed'}
                    </h2>
                  </div>
                  <button className="secondary" onClick={() => setOverlay(null)} type="button">
                    Close
                  </button>
                </div>

                {overlay === 'market' ? (
                  <div className="modal-grid">
                    {game.marketListings.length > 0 ? (
                      game.marketListings.map((listing) => {
                        const tile = game.tiles.find((item) => item.id === listing.tileId)
                        if (!tile) {
                          return null
                        }

                        return (
                          <article className="modal-card" key={listing.tileId}>
                            <p>{listing.tag}</p>
                            <h3>{tile.name}</h3>
                            <span>
                              {tile.district} · {tile.demand} demand · expires round{' '}
                              {listing.expiresRound}
                            </span>
                            <strong>{formatMoney(listing.price)}</strong>
                            <button
                              className="secondary"
                              onClick={() => dispatch({ type: 'buyout', tileId: listing.tileId })}
                              type="button"
                            >
                              Buy from market
                            </button>
                          </article>
                        )
                      })
                    ) : (
                      <article className="modal-card modal-card--muted">
                        <h3>No active listings</h3>
                        <p>Auctions open through events and round pressure.</p>
                      </article>
                    )}
                  </div>
                ) : null}

                {overlay === 'social' ? (
                  <div className="modal-grid">
                    {availableRoommates.length > 0 ? (
                      availableRoommates.map((player) => (
                        <article className="modal-card" key={player.id}>
                          <p>{getRoleText(player)}</p>
                          <h3>{player.name}</h3>
                          <span>
                            Cash {formatMoney(player.cash)} · Trust {player.trustInHuman}
                          </span>
                          <div className="modal-card__actions">
                            <button
                              className="secondary"
                              onClick={() => dispatch({ type: 'roommate', partnerId: player.id })}
                              type="button"
                            >
                              Pitch roommate pact
                            </button>
                            <button
                              className="secondary"
                              disabled={(human?.cash ?? 0) < 24}
                              onClick={() => dispatch({ type: 'support', partnerId: player.id })}
                              type="button"
                            >
                              Send support
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <article className="modal-card modal-card--muted">
                        <h3>No open partners</h3>
                        <p>Everyone is already housed, distrustful, or holding assets.</p>
                      </article>
                    )}
                  </div>
                ) : null}

                {overlay === 'assets' ? (
                  <div className="modal-grid">
                    {ownedProperties.length > 0 ? (
                      ownedProperties.map((tile) => (
                        <article className="modal-card" key={tile.id}>
                          <p>{tile.district}</p>
                          <h3>{tile.name}</h3>
                          <span>
                            Rent {formatMoney(tile.currentRent)} · Passive{' '}
                            {formatMoney(getPropertyPassiveIncomeValue(game, tile.id))}/tick
                          </span>
                          <span>
                            Upgrade {tile.upgradeLevel}/2 · Policy {tile.strategy}
                          </span>
                          <div className="modal-card__actions">
                            <button
                              className="secondary"
                              disabled={tile.upgradeLevel >= 2}
                              onClick={() =>
                                dispatch({ type: 'upgrade-property', tileId: tile.id })
                              }
                              type="button"
                            >
                              Upgrade for {formatMoney(getPropertyUpgradeCost(game, tile.id))}
                            </button>
                            <button
                              className="secondary"
                              onClick={() =>
                                dispatch({
                                  type: 'property-strategy',
                                  tileId: tile.id,
                                  strategy:
                                    tile.strategy === 'extract' ? 'stabilize' : 'extract',
                                })
                              }
                              type="button"
                            >
                              Switch to {tile.strategy === 'extract' ? 'stabilize' : 'extract'}
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <article className="modal-card modal-card--muted">
                        <h3>No properties owned</h3>
                        <p>Buyouts unlock this layer.</p>
                      </article>
                    )}
                  </div>
                ) : null}

                {overlay === 'standings' ? (
                  <div className="modal-grid">
                    {sortedPlayers.map((player, index) => (
                      <article className="modal-card" key={player.id}>
                        <p>#{index + 1}</p>
                        <h3>{player.name}</h3>
                        <span>
                          {getRoleText(player)} · {JOBS[player.jobId].name}
                        </span>
                        <span>
                          Cash {formatMoney(player.cash)} · Debt {formatMoney(player.debt)}
                        </span>
                        <strong>{player.score}</strong>
                      </article>
                    ))}
                  </div>
                ) : null}

                {overlay === 'feed' ? (
                  <div className="feed-list">
                    {game.logs.map((entry) => (
                      <article className={`log-entry log-entry--${entry.tone}`} key={entry.id}>
                        <span>R{entry.round}</span>
                        <p>{entry.message}</p>
                      </article>
                    ))}
                  </div>
                ) : null}

                {overlay === 'summary' ? (
                  <div className="modal-grid">
                    {game.roundSummaries.length > 0 ? (
                      game.roundSummaries.map((summary) => (
                        <article className="modal-card" key={summary.id}>
                          <p>Round {summary.round}</p>
                          <h3>{summary.headline ?? 'No headline'}</h3>
                          <span>
                            {summary.players[0]?.name} leads at {summary.players[0]?.score}
                          </span>
                          <div className="modal-card__notes">
                            {summary.notes.map((note) => (
                              <p key={note}>{note}</p>
                            ))}
                          </div>
                        </article>
                      ))
                    ) : (
                      <article className="modal-card modal-card--muted">
                        <h3>No round summaries yet</h3>
                        <p>They appear after each completed round.</p>
                      </article>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {winner ? (
            <div className="overlay">
              <div className="overlay__card">
                <p className="eyebrow">Match complete</p>
                <h2>{winner.isHuman ? 'You escaped on top.' : `${winner.name} won.`}</h2>
                <p>
                  Final seed <code>{game.config.seed}</code>. Score {winner.score}.
                </p>
                <div className="finish-list">
                  {sortedPlayers.map((player, index) => (
                    <div className="finish-row" key={player.id}>
                      <span>#{index + 1}</span>
                      <strong>{player.name}</strong>
                      <span>{player.score}</span>
                    </div>
                  ))}
                </div>
                <div className="overlay__actions">
                  <button className="primary" onClick={() => startMatch(draft)} type="button">
                    Run it again
                  </button>
                  <button className="secondary" onClick={clearToLobby} type="button">
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
              A board-first prototype with a fixed city grid, routed movement, and modal
              overlays for the systems around the board.
            </p>
            <div className="setup__stats">
              <article>
                <strong>Grid</strong>
                <span>Static city overview</span>
              </article>
              <article>
                <strong>Route</strong>
                <span>Up/down/left/right movement</span>
              </article>
              <article>
                <strong>Seeded</strong>
                <span>Deterministic runs</span>
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
                      className={`job-card ${draft.jobId === job.id ? 'job-card--active' : ''}`}
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
                        Salary {formatMoney(job.salary)} · Route CD {job.moveCooldown}
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
                <button className="primary primary--large" onClick={() => startMatch(draft)} type="button">
                  Start match
                </button>
                <button className="secondary" onClick={() => setShowTutorial(true)} type="button">
                  Open guide
                </button>
              </div>
            </div>

            <div className="feature-stack">
              <article className="feature-card">
                <p className="eyebrow">Board-first</p>
                <h2>The city stays still while the systems move around it.</h2>
                <p>
                  The board is now the visual anchor. Market, social, assets, and logs sit in
                  overlays instead of crowding the main frame.
                </p>
              </article>

              <article className="feature-card">
                <p className="eyebrow">Movement</p>
                <h2>Route block by block.</h2>
                <p>
                  Open a route, get a movement budget, and steer north, south, east, or west
                  across the city grid before settling on a destination.
                </p>
              </article>

              {lastMatch ? (
                <article className="feature-card feature-card--last-match">
                  <p className="eyebrow">Last match</p>
                  <h2>
                    {lastMatch.winnerName} won on <code>{lastMatch.seed}</code>
                  </h2>
                  <p>
                    Score {lastMatch.winnerScore}. {lastMatch.totalRounds} rounds recorded.
                  </p>
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
            <h2>Read the city like a board game</h2>
            <div className="guide-grid">
              <article className="guide-card">
                <strong>1. Open a route</strong>
                <p>Press `Open route`, roll a movement budget, and steer through adjacent blocks.</p>
              </article>
              <article className="guide-card">
                <strong>2. Settle where it helps</strong>
                <p>You can stop early if the current tile is better than spending the full route.</p>
              </article>
              <article className="guide-card">
                <strong>3. Keep overlays secondary</strong>
                <p>The board is the stable overview. Market, social, and assets live in overlays.</p>
              </article>
              <article className="guide-card">
                <strong>4. Buildings tell the story</strong>
                <p>Higher-demand districts and upgraded properties read taller in the skyline.</p>
              </article>
            </div>
            <div className="overlay__actions">
              <button className="primary" onClick={() => setShowTutorial(false)} type="button">
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

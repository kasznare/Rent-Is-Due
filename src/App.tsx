import { useEffect, useReducer, useState } from 'react'
import './App.css'
import {
  BASE_TICK_MS,
  DEFAULT_CONFIG,
  GAME_SECONDS_PER_TICK,
  JOBS,
  TICKS_PER_ROUND,
} from './game/data'
import {
  advanceTick,
  createInitialGame,
  formatMoney,
  formatTime,
  getHumanPlayer,
  getPassiveIncomeValue,
  getRoundInterestRate,
  getUpcomingLivingCost,
  performBridgeLoanRequest,
  performBridgeRepayment,
  performBuyout,
  performGig,
  performLoan,
  performMove,
  performRoommateRequest,
} from './game/engine'
import type { GameConfig, GameState, JobId, LoanSize, PlayerState } from './game/types'

type Action =
  | { type: 'clear' }
  | { type: 'start'; config: GameConfig }
  | { type: 'tick' }
  | { type: 'move' }
  | { type: 'gig' }
  | { type: 'loan'; size: LoanSize }
  | { type: 'buyout'; tileId: number }
  | { type: 'roommate'; partnerId: string }
  | { type: 'bridge-loan' }
  | { type: 'repay-bridge' }

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

  if (action.type === 'bridge-loan') {
    return performBridgeLoanRequest(state)
  }

  if (action.type === 'repay-bridge') {
    return performBridgeRepayment(state)
  }

  return state
}

const getRiskState = (player: PlayerState, nextBill: number) => {
  if (player.survivalRounds > 0 || player.creditScore < 500) {
    return 'critical'
  }

  if (player.cash <= nextBill * 2 || player.debt > player.cash * 3) {
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

function App() {
  const [draft, setDraft] = useState<GameConfig>(DEFAULT_CONFIG)
  const [game, dispatch] = useReducer(gameReducer, null)
  const [speed, setSpeed] = useState(2)
  const [paused, setPaused] = useState(false)
  const clockPaused = paused || game?.phase === 'finished'

  useEffect(() => {
    if (!game || game.phase !== 'running' || clockPaused) {
      return
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: 'tick' })
    }, BASE_TICK_MS / speed)

    return () => window.clearTimeout(timeout)
  }, [clockPaused, game, speed])

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
  const winner =
    game?.phase === 'finished'
      ? sortedPlayers[0] ?? null
      : null

  return (
    <div className="app-shell">
      {game ? (
        <>
          <header className="topbar">
            <div className="topbar__title">
              <p className="eyebrow">Gen Z Monopoly</p>
              <h1>Rent is due. The clock never stops.</h1>
              <p className="lede">
                Client-only prototype for static hosting. The economy runs on a
                compressed clock so a full match lands in a few minutes.
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
                onClick={() => {
                  setPaused(false)
                  dispatch({ type: 'clear' })
                }}
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
                            <span>{owner ? `Owned by ${owner.name}` : 'Market-owned'}</span>
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
                          ? 'One bad tick from collapse.'
                          : riskState === 'tight'
                            ? 'Manage the next round carefully.'
                            : 'You have room to choose rather than react.'}
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

                  <div className="actions-grid">
                    <button
                      className="primary"
                      disabled={human.moveCooldown > 0 || human.workLock > 0 || human.skipActions > 0}
                      onClick={() => dispatch({ type: 'move' })}
                      type="button"
                    >
                      Move
                      <span>
                        {human.moveCooldown > 0
                          ? `${human.moveCooldown} ticks`
                          : 'Roll automatically'}
                      </span>
                    </button>

                    <button
                      className="primary"
                      disabled={human.gigCooldown > 0 || human.workLock > 0 || human.skipActions > 0}
                      onClick={() => dispatch({ type: 'gig' })}
                      type="button"
                    >
                      Work a gig
                      <span>
                        {human.gigCooldown > 0
                          ? `${human.gigCooldown} ticks`
                          : 'Fast cash, high stress'}
                      </span>
                    </button>

                    <button
                      className="secondary"
                      onClick={() => dispatch({ type: 'loan', size: 'small' })}
                      type="button"
                    >
                      Small loan
                      <span>Quick approval, ugly interest</span>
                    </button>

                    <button
                      className="secondary"
                      onClick={() => dispatch({ type: 'loan', size: 'large' })}
                      type="button"
                    >
                      Large loan
                      <span>Better liquidity, stricter gate</span>
                    </button>

                    <button
                      className="secondary"
                      disabled={Boolean(human.peerLoan)}
                      onClick={() => dispatch({ type: 'bridge-loan' })}
                      type="button"
                    >
                      Ask table for help
                      <span>Trust-based player loan</span>
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
                        <p className="eyebrow">Social</p>
                        <h3>Roommate pacts</h3>
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
                            <button
                              className="secondary"
                              onClick={() =>
                                dispatch({ type: 'roommate', partnerId: player.id })
                              }
                              type="button"
                            >
                              Pitch roommate deal
                            </button>
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
                  Final score {winner.score}. Net worth, debt ratio, stability, and
                  assets all fed the result.
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
                <div className="overlay__actions">
                  <button
                    className="primary"
                    onClick={() => {
                      setPaused(false)
                      dispatch({ type: 'start', config: draft })
                    }}
                    type="button"
                  >
                    Run it again
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setPaused(false)
                      dispatch({ type: 'clear' })
                    }}
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
              A real-time economic survival prototype with debt, inflation,
              gig work, roommate risk, and rare ownership windows. Built to run on
              GitHub Pages without a backend.
            </p>
            <div className="setup__stats">
              <article>
                <strong>3s</strong>
                <span>In-game tick</span>
              </article>
              <article>
                <strong>20</strong>
                <span>Ticks per round</span>
              </article>
              <article>
                <strong>2-6</strong>
                <span>Players supported in prototype</span>
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

              <button
                className="primary primary--large"
                onClick={() => {
                  setPaused(false)
                  dispatch({ type: 'start', config: draft })
                }}
                type="button"
              >
                Start match
              </button>
            </div>

            <div className="feature-stack">
              <article className="feature-card">
                <p className="eyebrow">Core loop</p>
                <h2>Survive the next bill without ruining the round after it.</h2>
                <p>
                  Every tick applies passive income and living costs. Every round
                  compounds debt, raises rent, and gives the economy new ways to hurt
                  you.
                </p>
              </article>

              <article className="feature-card">
                <p className="eyebrow">Design adaptation</p>
                <h2>Static-hosted version</h2>
                <p>
                  The original concept called for a server-authoritative multiplayer
                  economy. This build compresses that into a local simulation with AI
                  rivals so it can ship cleanly to GitHub Pages.
                </p>
              </article>

              <article className="feature-card">
                <p className="eyebrow">Win state</p>
                <h2>Timer-based scoring</h2>
                <p>
                  Final ranking blends net worth, debt ratio, stability, and owned
                  assets. You can survive with debt, but you usually cannot win with
                  it.
                </p>
              </article>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

export default App

'use client'

import { useMemo, useState, useEffect } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
  X,
  Zap,
  AlertCircle,
} from 'lucide-react'
import { useWallet } from '../lib/wallet'
import {
  walletSummary,
  walletEvents,
  leaderboard,
  weights,
  chainsStatus,
  health,
  type WalletSummary,
  type IndexedEvent,
  type LeaderboardEntry,
  type WeightsResponse,
  type ChainStatus,
  ApiError,
} from '../lib/api'

const navItems = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Activity', icon: Activity },
  { label: 'Leaderboard', icon: Trophy },
]

function ScoreRing({ score, maxScore }: { score: number; maxScore: number }) {
  const radius = 78
  const circumference = 2 * Math.PI * radius
  const progress = circumference - (score / Math.max(maxScore, score)) * circumference

  return (
    <div className="score-ring" aria-label={`Credit score ${score}`}>
      <svg viewBox="0 0 190 190" aria-hidden="true">
        <circle className="ring-track" cx="95" cy="95" r={radius} />
        <circle className="ring-progress" cx="95" cy="95" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: progress }} />
      </svg>
      <div className="score-copy">
        <span className="score-number">{score}</span>
        <span className="score-label">Raw score</span>
      </div>
    </div>
  )
}

function LoadingSpinner({ size = 24 }: { size?: number }) {
  return <Loader2 className="spin" size={size} />
}

function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="error-banner">
      <AlertCircle size={16} />
      <span>{error}</span>
      <button className="text-button" onClick={onRetry}>Retry</button>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <AlertCircle size={32} />
      <p>{message}</p>
    </div>
  )
}

export default function Page() {
  const [activeNav, setActiveNav] = useState('Overview')
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  
  // Wallet state
  const { address: walletAddress, isConnected, isConnecting, error: walletError, connect, disconnect } = useWallet()
  
  // API data state
  const [searchAddress, setSearchAddress] = useState('')
  const [currentAddress, setCurrentAddress] = useState<string | null>(null)
  const [summary, setSummary] = useState<WalletSummary | null>(null)
  const [events, setEvents] = useState<IndexedEvent[]>([])
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([])
  const [weightsData, setWeightsData] = useState<WeightsResponse | null>(null)
  const [chainsData, setChainsData] = useState<ChainStatus[]>([])
  
  // Loading and error states
  const [loading, setLoading] = useState({
    summary: false,
    events: false,
    leaderboard: false,
    weights: false,
    chains: false,
  })
  const [errors, setErrors] = useState({
    summary: null as string | null,
    events: null as string | null,
    leaderboard: null as string | null,
    weights: null as string | null,
    chains: null as string | null,
  })
  
  // Activity pagination and filtering
  const [eventPage, setEventPage] = useState(1)
  const [eventFilter, setEventFilter] = useState<string | null>(null)
  const [totalEvents, setTotalEvents] = useState(0)

  // Network dropdown state
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false)
  const [selectedChain, setSelectedChain] = useState('sepolia')

  // Block explorer URLs for different chains
  const getBlockExplorerUrl = (chain: string, address: string) => {
    const explorers: Record<string, string> = {
      'ethereum': `https://etherscan.io/address/${address}`,
      'sepolia': `https://sepolia.etherscan.io/address/${address}`,
      'cc3 testnet': `https://creditcoin3-testnet.subscan.io/address/${address}`,
      'cc3-testnet': `https://creditcoin3-testnet.subscan.io/address/${address}`,
    }
    return explorers[chain.toLowerCase()] || `https://etherscan.io/address/${address}`
  }

  // Transaction explorer URLs for different chains
  const getTxExplorerUrl = (chain: string, txHash: string) => {
    const explorers: Record<string, string> = {
      'ethereum': `https://etherscan.io/tx/${txHash}`,
      'sepolia': `https://sepolia.etherscan.io/tx/${txHash}`,
      'cc3 testnet': `https://creditcoin3-testnet.subscan.io/tx/${txHash}`,
      'cc3-testnet': `https://creditcoin3-testnet.subscan.io/tx/${txHash}`,
    }
    return explorers[chain.toLowerCase()] || `https://etherscan.io/tx/${txHash}`
  }

  // Load weights and chains status once on mount
  useEffect(() => {
    const loadGlobalData = async () => {
      setLoading(prev => ({ ...prev, weights: true, chains: true }))
      try {
        const [weightsRes, chainsRes] = await Promise.all([
          weights().catch(e => { throw e }),
          chainsStatus().catch(e => { throw e }),
        ])
        setWeightsData(weightsRes)
        setChainsData(chainsRes.chains)
        setErrors(prev => ({ ...prev, weights: null, chains: null }))
      } catch (e: any) {
        const errorMsg = e instanceof ApiError ? e.message : 'Failed to connect to API'
        setErrors(prev => ({ 
          ...prev, 
          weights: errorMsg,
          chains: errorMsg,
        }))
      } finally {
        setLoading(prev => ({ ...prev, weights: false, chains: false }))
      }
    }
    loadGlobalData()
  }, [])

  // Load wallet data when address changes
  useEffect(() => {
    const addressToLoad = searchAddress || walletAddress
    if (!addressToLoad || addressToLoad === currentAddress) return

    setCurrentAddress(addressToLoad)
    loadWalletData(addressToLoad)
  }, [searchAddress, walletAddress])

  const loadWalletData = async (address: string) => {
    setLoading(prev => ({ ...prev, summary: true, events: true }))
    setErrors(prev => ({ ...prev, summary: null, events: null }))
    
    try {
      const [summaryRes, eventsRes] = await Promise.all([
        walletSummary(address),
        walletEvents(address, { page: 1, limit: 50 }),
      ])
      setSummary(summaryRes)
      setEvents(eventsRes.events)
      setTotalEvents(eventsRes.pagination.total)
      setEventPage(1)
    } catch (e: any) {
      setErrors(prev => ({ 
        ...prev, 
        summary: e instanceof ApiError ? e.message : 'Failed to load wallet data',
        events: e instanceof ApiError ? e.message : 'Failed to load events',
      }))
    } finally {
      setLoading(prev => ({ ...prev, summary: false, events: false }))
    }
  }

  // Load leaderboard when that tab is opened
  useEffect(() => {
    if (activeNav === 'Leaderboard' && leaderboardData.length === 0) {
      loadLeaderboard()
    }
  }, [activeNav])

  const loadLeaderboard = async () => {
    setLoading(prev => ({ ...prev, leaderboard: true }))
    setErrors(prev => ({ ...prev, leaderboard: null }))
    
    try {
      const res = await leaderboard()
      setLeaderboardData(res.leaderboard)
    } catch (e: any) {
      setErrors(prev => ({ 
        ...prev, 
        leaderboard: e instanceof ApiError ? e.message : 'Failed to load leaderboard',
      }))
    } finally {
      setLoading(prev => ({ ...prev, leaderboard: false }))
    }
  }

  // Load filtered events
  useEffect(() => {
    if (!currentAddress) return
    
    const loadFilteredEvents = async () => {
      setLoading(prev => ({ ...prev, events: true }))
      setErrors(prev => ({ ...prev, events: null }))
      
      try {
        const params: any = { page: eventPage, limit: 50 }
        if (eventFilter) params.eventName = eventFilter
        
        const res = await walletEvents(currentAddress, params)
        setEvents(res.events)
        setTotalEvents(res.pagination.total)
      } catch (e: any) {
        setErrors(prev => ({ 
          ...prev, 
          events: e instanceof ApiError ? e.message : 'Failed to load events',
        }))
      } finally {
        setLoading(prev => ({ ...prev, events: false }))
      }
    }
    
    loadFilteredEvents()
  }, [eventPage, eventFilter, currentAddress])

  const handleSearch = () => {
    if (query.trim()) {
      setSearchAddress(query.trim())
    }
  }

  const handleRefresh = () => {
    if (currentAddress) {
      loadWalletData(currentAddress)
    }
    if (activeNav === 'Leaderboard') {
      loadLeaderboard()
    }
  }

  // Compute score composition from real stats and weights
  const scoreComposition = useMemo(() => {
    if (!summary || !weightsData) return []
    
    const stats = summary.stats
    const weights = weightsData
    
    return [
      {
        name: 'Supply',
        count: parseInt(stats.supplyCount),
        weight: parseInt(weights.supplyWeight),
        contribution: parseInt(stats.supplyCount) * parseInt(weights.supplyWeight),
        tone: 'mint' as const,
      },
      {
        name: 'Borrow',
        count: parseInt(stats.borrowCount),
        weight: parseInt(weights.borrowWeight),
        contribution: parseInt(stats.borrowCount) * parseInt(weights.borrowWeight),
        tone: 'gold' as const,
      },
      {
        name: 'Repay',
        count: parseInt(stats.repayCount),
        weight: parseInt(weights.repayWeight),
        contribution: parseInt(stats.repayCount) * parseInt(weights.repayWeight),
        tone: 'blue' as const,
      },
      {
        name: 'Withdraw',
        count: parseInt(stats.withdrawCount),
        weight: parseInt(weights.withdrawWeight),
        contribution: parseInt(stats.withdrawCount) * parseInt(weights.withdrawWeight),
        tone: 'peach' as const,
      },
      {
        name: 'Liquidation',
        count: parseInt(stats.liquidationCount),
        weight: parseInt(weights.liquidationWeight),
        contribution: parseInt(stats.liquidationCount) * parseInt(weights.liquidationWeight),
        tone: 'peach' as const,
      },
    ].filter(item => item.count > 0)
  }, [summary, weightsData])

  // Get rank and percentile from leaderboard
  const rankInfo = useMemo(() => {
    if (!currentAddress || !leaderboardData.length) return null
    
    const entry = leaderboardData.find(e => e.wallet.toLowerCase() === currentAddress.toLowerCase())
    if (!entry) return null
    
    const percentile = Math.round((1 - entry.rank / leaderboardData.length) * 100)
    return { rank: entry.rank, percentile }
  }, [currentAddress, leaderboardData])

  // Get max score for ring scaling
  const maxScore = useMemo(() => {
    if (leaderboardData.length > 0) {
      return Math.max(...leaderboardData.map(e => e.score))
    }
    return 1000 // fallback
  }, [leaderboardData])

  // Event name mapping
  const eventIcons: Record<string, any> = {
    Supply: ArrowUpRight,
    Borrow: ArrowDownRight,
    Repay: ArrowUpRight,
    Withdraw: ArrowDownRight,
    LiquidationCall: AlertCircle,
  }

  const eventColors: Record<string, string> = {
    Supply: 'mint',
    Borrow: 'gold',
    Repay: 'mint',
    Withdraw: 'blue',
    LiquidationCall: 'peach',
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={17} /></div>
          <span className="brand-name">credit<span>score</span></span>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <div className="network-pill">
          <span className="network-dot" />
          <button 
            className="network-dropdown-toggle"
            onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
          >
            {selectedChain} <ChevronDown size={14} />
          </button>
          {networkDropdownOpen && (
            <div className="network-dropdown">
              {chainsData.length > 0 ? (
                chainsData.map(chain => (
                  <button 
                    key={chain.chain}
                    onClick={() => { setSelectedChain(chain.chain.toLowerCase()); setNetworkDropdownOpen(false) }}
                  >
                    {chain.chain}
                  </button>
                ))
              ) : (
                <button onClick={() => { setSelectedChain('sepolia'); setNetworkDropdownOpen(false) }}>
                  Sepolia
                </button>
              )}
            </div>
          )}
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${activeNav === label ? 'nav-item-active' : ''}`} onClick={() => { setActiveNav(label); setMobileOpen(false) }}>
              <Icon size={18} /> {label}
              {label === 'Activity' && summary && summary.unprovenCount > 0 && (
                <span className="nav-count">{summary.unprovenCount}</span>
              )}
            </button>
          ))}
          <p className="nav-label nav-label-spaced">Manage</p>
          <button className="nav-item" onClick={() => setActiveNav('Settings')}><Settings2 size={18} /> Settings</button>
          <button className="nav-item" onClick={() => setActiveNav('Help')}><CircleHelp size={18} /> Help center</button>
        </nav>

      </aside>

      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      <section className="content-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div>
              <p className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <h1>{activeNav === 'Overview' ? (currentAddress ? 'Wallet overview' : 'Good morning') : activeNav}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="search-box">
              <Search size={16} />
              <input 
                aria-label="Search wallet address" 
                value={query} 
                onChange={(event) => setQuery(event.target.value)} 
                placeholder="Search wallet address..."
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button className="search-submit" onClick={handleSearch}>Go</button>
            </div>
            <button className="icon-button notification" aria-label="Notifications"><Bell size={18} /></button>
            {isConnected ? (
              <button className="wallet-button">
                <span className="wallet-avatar">{walletAddress?.substring(2, 4).toUpperCase()}</span>
                <span>{walletAddress?.substring(0, 6)}...{walletAddress?.substring(38)}</span>
                <ChevronDown size={15} />
              </button>
            ) : (
              <button className="connect-button compact" onClick={connect} disabled={isConnecting}>
                {isConnecting ? <LoadingSpinner size={16} /> : <Wallet size={14} />}
              </button>
            )}
          </div>
        </header>

        <div className="dashboard-content">
          {errors.weights && errors.weights.includes('API') && (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>{errors.weights}</span>
              <button className="text-button" onClick={() => window.open('http://localhost:3002/api/health', '_blank')}>
                Check API status
              </button>
            </div>
          )}
          
          {walletError && (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>{walletError}</span>
              {walletError.includes('extension') && (
                <>
                  <button className="text-button" onClick={() => window.open('about:extensions', '_blank')}>
                    Manage extensions
                  </button>
                  <button className="text-button" onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer,private')}>
                    Try incognito
                  </button>
                </>
              )}
            </div>
          )}

          {summary && summary.unprovenCount > 0 && (
            <div className="status-banner warning">
              <div className="status-icon"><AlertCircle size={19} /></div>
              <div>
                <strong>{summary.unprovenCount} events pending verification</strong>
                <span>Some events are waiting to be proven on-chain.</span>
              </div>
            </div>
          )}

          {activeNav === 'Overview' && (
            <>
              {!currentAddress ? (
                <div className="empty-state large">
                  <Wallet size={48} />
                  <h2>Connect a wallet or search an address</h2>
                  <p>Enter a wallet address above to view their credit score and activity.</p>
                </div>
              ) : (
                <>
                  {errors.summary && <ErrorBanner error={errors.summary} onRetry={handleRefresh} />}
                  
                  <div className="dashboard-grid">
                    <section className="panel score-panel">
                      <div className="panel-header">
                        <div>
                          <p className="eyebrow">Credit score</p>
                          <h2>On-chain reputation</h2>
                        </div>
                        <button className="refresh-button" aria-label="Refresh score" onClick={handleRefresh} disabled={loading.summary}>
                          {loading.summary ? <LoadingSpinner size={16} /> : <RefreshCw size={16} />}
                          {loading.summary ? 'Loading...' : 'Refresh'}
                        </button>
                      </div>
                      {loading.summary ? (
                        <div className="panel-loading"><LoadingSpinner size={24} /></div>
                      ) : summary ? (
                        <div className="score-main">
                          <ScoreRing score={parseInt(summary.score)} maxScore={maxScore} />
                          <div className="score-meta">
                            {rankInfo ? (
                              <>
                                <div className="score-change">
                                  <Trophy size={17} />
                                  <strong>#{rankInfo.rank}</strong>
                                  <span>rank</span>
                                </div>
                                <p>Top {rankInfo.percentile}% of verified wallets</p>
                              </>
                            ) : (
                              <p>Not ranked in top 50 yet</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <EmptyState message="Failed to load score data" />
                      )}
                      <div className="score-footer">
                        <span>Last calculated {summary?.lastEventAt ? new Date(summary.lastEventAt).toLocaleString() : 'N/A'}</span>
                      </div>
                    </section>

                    <section className="panel wallet-panel">
                      <div className="panel-header">
                        <div>
                          <p className="eyebrow">Wallet</p>
                          <h2>Identity overview</h2>
                        </div>
                        <button className="copy-button" aria-label="Copy wallet address" onClick={() => navigator.clipboard?.writeText(currentAddress)}>
                          <Copy size={15} />
                        </button>
                      </div>
                      <div className="wallet-address">
                        <div className="wallet-large-avatar">{currentAddress.substring(2, 4).toUpperCase()}</div>
                        <div>
                          <strong>{currentAddress.substring(0, 8)}...{currentAddress.substring(36)}</strong>
                          <span>Connected</span>
                        </div>
                      </div>
                      <div className="wallet-stats">
                        <div>
                          <span>Rank</span>
                          <strong>{rankInfo ? `#${rankInfo.rank}` : 'N/A'}</strong>
                        </div>
                        <div>
                          <span>Percentile</span>
                          <strong>{rankInfo ? `${rankInfo.percentile}th` : 'N/A'}</strong>
                        </div>
                        <div>
                          <span>Unproven</span>
                          <strong>{summary ? summary.unprovenCount : 0}</strong>
                        </div>
                      </div>
                      <button 
                        className="outline-button"
                        onClick={() => window.open(getBlockExplorerUrl(selectedChain, currentAddress), '_blank')}
                      >
                        View on block explorer <ExternalLink size={14} />
                      </button>
                    </section>
                  </div>

                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Score composition</p>
                      <h2>What's driving your score?</h2>
                    </div>
                  </div>
                  <section className="panel factors-panel">
                    {loading.summary ? (
                      <div className="panel-loading"><LoadingSpinner size={24} /></div>
                    ) : scoreComposition.length > 0 ? (
                      <>
                        <div className="factor-intro">
                          <div className="factor-badge"><BarChart3 size={20} /></div>
                          <div>
                            <h3>Score breakdown</h3>
                            <p>Your score is calculated from verified on-chain events.</p>
                          </div>
                          <div className="factor-total">
                            <span>Total score</span>
                            <strong>{summary?.score || '0'}</strong>
                          </div>
                        </div>
                        <div className="factor-list">
                          {scoreComposition.map((factor) => (
                            <div className="factor-row" key={factor.name}>
                              <div className="factor-name">
                                <span className={`factor-dot ${factor.tone}`} />
                                <strong>{factor.name}</strong>
                                <span className="factor-score">
                                  {factor.contribution > 0 ? '+' : ''}{factor.contribution}
                                </span>
                              </div>
                              <div className="progress-track">
                                <div 
                                  className={`progress-fill ${factor.tone}`} 
                                  style={{ width: `${Math.min(100, (factor.count / 10) * 100)}%` }} 
                                />
                              </div>
                              <span className="factor-value">{factor.count} events</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <EmptyState message="No activity contributing to score yet" />
                    )}
                  </section>

                  <div className="section-heading activity-heading">
                    <div>
                      <p className="eyebrow">Recent activity</p>
                      <h2>Latest events</h2>
                    </div>
                    <button className="text-button" onClick={() => setActiveNav('Activity')}>
                      See all activity <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <section className="panel activity-panel">
                    {loading.events ? (
                      <div className="panel-loading"><LoadingSpinner size={24} /></div>
                    ) : errors.events ? (
                      <ErrorBanner error={errors.events} onRetry={() => currentAddress && loadWalletData(currentAddress)} />
                    ) : events.length > 0 ? (
                      events.slice(0, 5).map((event) => {
                        const Icon = eventIcons[event.eventName] || Activity
                        const color = eventColors[event.eventName] || 'blue'
                        return (
                          <div className="activity-row" key={`${event.txHash}-${event.logIndex}`}>
                            <div className={`activity-icon ${color}`}>
                              <Icon size={17} />
                            </div>
                            <div className="activity-detail">
                              <strong>{event.eventName}</strong>
                              <span>{event.asset || 'Unknown'} · {event.amount}</span>
                            </div>
                            <span className="activity-date">
                              {event.timestamp ? new Date(event.timestamp * 1000).toLocaleDateString() : 'N/A'}
                            </span>
                            <strong className={`activity-points ${event.proven ? 'proven' : 'unproven'}`}>
                              {event.proven ? 'Verified' : 'Pending'}
                            </strong>
                            <a 
                              href={getTxExplorerUrl(event.chain, event.txHash)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="activity-link"
                              title="View on block explorer"
                            >
                              <ExternalLink size={16} />
                            </a>
                          </div>
                        )
                      })
                    ) : (
                      <EmptyState message="No activity found for this wallet" />
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {activeNav === 'Activity' && (
            <>
              {!currentAddress ? (
                <div className="empty-state large">
                  <Activity size={48} />
                  <h2>Connect a wallet to view activity</h2>
                  <p>Enter a wallet address above to view their activity history.</p>
                </div>
              ) : (
                <>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Activity</p>
                      <h2>All events</h2>
                    </div>
                    <div className="activity-controls">
                      <select 
                        className="filter-dropdown" 
                        value={eventFilter || ''} 
                        onChange={(e) => setEventFilter(e.target.value || null)}
                      >
                        <option value="">All events</option>
                        <option value="Supply">Supply</option>
                        <option value="Borrow">Borrow</option>
                        <option value="Repay">Repay</option>
                        <option value="Withdraw">Withdraw</option>
                        <option value="LiquidationCall">Liquidation</option>
                      </select>
                      <button className="refresh-button" onClick={handleRefresh} disabled={loading.events}>
                        {loading.events ? <LoadingSpinner size={16} /> : <RefreshCw size={16} />}
                      </button>
                    </div>
                  </div>
                  
                  {errors.events && <ErrorBanner error={errors.events} onRetry={() => currentAddress && loadWalletData(currentAddress)} />}
                  
                  <section className="panel activity-panel full">
                    {loading.events ? (
                      <div className="panel-loading"><LoadingSpinner size={24} /></div>
                    ) : events.length > 0 ? (
                      <>
                        {events.map((event) => {
                          const Icon = eventIcons[event.eventName] || Activity
                          const color = eventColors[event.eventName] || 'blue'
                          return (
                            <div className="activity-row" key={`${event.txHash}-${event.logIndex}`}>
                              <div className={`activity-icon ${color}`}>
                                <Icon size={17} />
                              </div>
                              <div className="activity-detail">
                                <strong>{event.eventName}</strong>
                                <span>{event.asset || 'Unknown'} · {event.amount}</span>
                              </div>
                              <span className="activity-date">
                                {event.timestamp ? new Date(event.timestamp * 1000).toLocaleString() : 'N/A'}
                              </span>
                              <strong className={`activity-points ${event.proven ? 'proven' : 'unproven'}`}>
                                {event.proven ? 'Verified' : 'Pending'}
                              </strong>
                              <a 
                                href={getTxExplorerUrl(event.chain, event.txHash)} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="activity-link"
                                title="View on block explorer"
                              >
                                <ExternalLink size={16} />
                              </a>
                            </div>
                          )
                        })}
                        <div className="pagination">
                          <button 
                            className="pagination-button" 
                            disabled={eventPage === 1}
                            onClick={() => setEventPage(p => p - 1)}
                          >
                            Previous
                          </button>
                          <span>Page {eventPage}</span>
                          <button 
                            className="pagination-button" 
                            disabled={events.length < 50}
                            onClick={() => setEventPage(p => p + 1)}
                          >
                            Next
                          </button>
                        </div>
                      </>
                    ) : (
                      <EmptyState message="No activity found" />
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {activeNav === 'Leaderboard' && (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Leaderboard</p>
                  <h2>Top wallets by score</h2>
                </div>
                <button className="refresh-button" onClick={loadLeaderboard} disabled={loading.leaderboard}>
                  {loading.leaderboard ? <LoadingSpinner size={16} /> : <RefreshCw size={16} />}
                </button>
              </div>
              
              {errors.leaderboard && <ErrorBanner error={errors.leaderboard} onRetry={loadLeaderboard} />}
              
              <section className="panel leaderboard-panel">
                {loading.leaderboard ? (
                  <div className="panel-loading"><LoadingSpinner size={24} /></div>
                ) : leaderboardData.length > 0 ? (
                  <div className="leaderboard-list">
                    {leaderboardData.map((entry) => (
                      <div className="leaderboard-row" key={entry.wallet}>
                        <span className="leaderboard-rank">#{entry.rank}</span>
                        <span className="leaderboard-wallet">
                          {entry.wallet.substring(0, 8)}...{entry.wallet.substring(36)}
                        </span>
                        <span className="leaderboard-score">{entry.score}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No leaderboard data available" />
                )}
              </section>
            </>
          )}

          {activeNav === 'Settings' && (
            <div className="empty-state large">
              <Settings2 size={48} />
              <h2>Settings</h2>
              <p>No settings to configure yet. More options coming soon.</p>
            </div>
          )}

          {activeNav === 'Help' && (
            <div className="empty-state large">
              <CircleHelp size={48} />
              <h2>Help center</h2>
              <p>Documentation and support coming soon.</p>
            </div>
          )}

          <footer className="page-footer">
            <span>Powered by transparent on-chain data</span>
            <span>Data refreshes in real-time</span>
          </footer>
        </div>
      </section>
    </main>
  )
}

'use client'

import Link from 'next/link'
import { Activity, ArrowUpRight, BarChart3, Copy, ExternalLink, RefreshCw, Trophy, Wallet } from 'lucide-react'
import { useAppData } from '../lib/app-data'
import { EmptyState, ErrorBanner, LoadingSpinner, ScoreRing } from '../components/shared'

export default function OverviewPage() {
  const {
    currentAddress,
    summary,
    loading,
    errors,
    handleRefresh,
    scoreComposition,
    rankInfo,
    maxScore,
    selectedChain,
    getBlockExplorerUrl,
    events,
    eventIcons,
    eventColors,
    protocolColors,
    getTxExplorerUrl,
  } = useAppData()

  if (!currentAddress) {
    return (
      <div className="empty-state large">
        <Wallet size={48} />
        <h2>Connect a wallet or search an address</h2>
        <p>Enter a wallet address above to view their credit score and activity.</p>
      </div>
    )
  }

  return (
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
        <Link className="text-button" href="/activity">
          See all activity <ArrowUpRight size={15} />
        </Link>
      </div>
      <section className="panel activity-panel">
        {loading.events ? (
          <div className="panel-loading"><LoadingSpinner size={24} /></div>
        ) : errors.events ? (
          <ErrorBanner error={errors.events} onRetry={handleRefresh} />
        ) : events.length > 0 ? (
          events.slice(0, 5).map((event) => {
            const Icon = eventIcons[event.eventName] || Activity
            const color = eventColors[event.eventName] || 'blue'
            const protocolColor = protocolColors[event.protocol || 'aave'] || 'blue'
            return (
              <div className="activity-row" key={`${event.txHash}-${event.logIndex}`}>
                <div className={`activity-icon ${color}`}>
                  <Icon size={17} />
                </div>
                <div className="activity-detail">
                  <strong>{event.eventName}</strong>
                  <span>{event.asset || 'Unknown'} · {event.amount}</span>
                </div>
                <span className={`activity-badge ${protocolColor}`}>
                  {event.protocol || 'aave'}
                </span>
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
  )
}
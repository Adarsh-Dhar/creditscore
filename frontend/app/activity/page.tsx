'use client'

import { Activity, ExternalLink, RefreshCw } from 'lucide-react'
import { useAppData } from '../../lib/app-data'
import { EmptyState, ErrorBanner, LoadingSpinner } from '../../components/shared'

export default function ActivityPage() {
  const {
    currentAddress,
    events,
    loading,
    errors,
    eventFilter,
    setEventFilter,
    protocolFilter,
    setProtocolFilter,
    eventPage,
    setEventPage,
    loadWalletData,
    eventIcons,
    eventColors,
    protocolColors,
    getTxExplorerUrl,
  } = useAppData()

  if (!currentAddress) {
    return (
      <div className="empty-state large">
        <Activity size={48} />
        <h2>Connect a wallet to view activity</h2>
        <p>Enter a wallet address above to view their activity history.</p>
      </div>
    )
  }

  return (
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
          <select
            className="filter-dropdown"
            value={protocolFilter || ''}
            onChange={(e) => setProtocolFilter(e.target.value || null)}
          >
            <option value="">All protocols</option>
            <option value="aave">Aave</option>
            <option value="compound">Compound</option>
            <option value="morpho">Morpho</option>
          </select>
          <button className="refresh-button" onClick={() => loadWalletData(currentAddress)} disabled={loading.events}>
            {loading.events ? <LoadingSpinner size={16} /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {errors.events && <ErrorBanner error={errors.events} onRetry={() => loadWalletData(currentAddress)} />}

      <section className="panel activity-panel full">
        {loading.events ? (
          <div className="panel-loading"><LoadingSpinner size={24} /></div>
        ) : events.length > 0 ? (
          <>
            {events.map((event) => {
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
  )
}
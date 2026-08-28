'use client'

import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAppData } from '../../lib/app-data'
import { EmptyState, ErrorBanner, LoadingSpinner } from '../../components/shared'

export default function LeaderboardPage() {
  const { leaderboardData, loading, errors, loadLeaderboard } = useAppData()

  // Refresh leaderboard every time this route is visited (parity with the old activeNav effect)
  useEffect(() => {
    loadLeaderboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
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
  )
}
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowUpRight, Check, ChevronDown, Copy, ExternalLink, RefreshCw, Send, Trophy, Wallet, X } from 'lucide-react'
import ScoreHistoryChart from '../components/ScoreHistoryChart'
import { useAppData } from '../lib/app-data'
import { EmptyState, ErrorBanner, LoadingSpinner, ScoreRing } from '../components/shared'
import { executeTx, type TxResult } from '../lib/api'

// ── Execute-Transaction modal ─────────────────────────────────────────────────

const TX_MENU = {
  aave: {
    label: 'Aave V3',
    color: 'peach',
    operations: [
      { id: 'supply',            label: 'Supply WETH',            desc: 'Deposit WETH as collateral' },
      { id: 'borrow',            label: 'Borrow USDC',            desc: 'Borrow USDC against collateral' },
      { id: 'repay',             label: 'Repay USDC',             desc: 'Repay outstanding USDC debt' },
      { id: 'withdraw',          label: 'Withdraw WETH',          desc: 'Withdraw WETH collateral' },
      { id: 'add-collateral',    label: 'Add Collateral',         desc: 'Deposit more WETH collateral' },
      { id: 'remove-collateral', label: 'Remove Collateral',      desc: 'Withdraw WETH collateral' },
    ],
  },
  compound: {
    label: 'Compound V3',
    color: 'blue',
    operations: [
      { id: 'supply-base',          label: 'Supply USDC (Repay)',     desc: 'Supply USDC base asset → credited as Repay' },
      { id: 'supply-collateral',    label: 'Supply WETH (Collateral)',desc: 'Supply WETH collateral → credited as Supply' },
      { id: 'withdraw-base',        label: 'Withdraw USDC (Borrow)',  desc: 'Withdraw USDC from base → credited as Borrow' },
      { id: 'withdraw-collateral',  label: 'Withdraw WETH',          desc: 'Withdraw WETH collateral → credited as Withdraw' },
    ],
  },
  liquity: {
    label: 'Liquity V2',
    color: 'mint',
    operations: [
      { id: 'open',          label: 'Open Trove',       desc: 'Open a new Liquity trove (needs 2 WETH collateral)' },
      { id: 'add-coll',      label: 'Add Collateral',   desc: 'Add WETH collateral to existing trove' },
      { id: 'withdraw-coll', label: 'Withdraw Coll',    desc: 'Withdraw WETH collateral from trove' },
      { id: 'withdraw-bold', label: 'Borrow BOLD',      desc: 'Borrow more BOLD against your trove' },
      { id: 'repay-bold',    label: 'Repay BOLD',       desc: 'Repay BOLD debt on your trove' },
      { id: 'close',         label: 'Close Trove',      desc: 'Repay all debt and close trove' },
    ],
  },
} as const

type Protocol = keyof typeof TX_MENU

type Step = 'protocol' | 'operation' | 'confirm' | 'pending' | 'done'

function ExecuteTxModal({ onClose }: { onClose: () => void }) {
  const [step, setStep]           = useState<Step>('protocol')
  const [protocol, setProtocol]   = useState<Protocol | null>(null)
  const [opId, setOpId]           = useState<string | null>(null)
  const [result, setResult]       = useState<TxResult | null>(null)

  const selectedOp = protocol && opId
    ? TX_MENU[protocol].operations.find(o => o.id === opId)
    : null

  async function submit() {
    if (!protocol || !opId) return
    setStep('pending')
    const res = await executeTx(protocol, opId)
    setResult(res)
    setStep('done')
  }

  return (
    <div className="etx-backdrop" role="dialog" aria-modal="true" aria-label="Execute transaction">
      <div className="etx-modal">

        {/* Header */}
        <div className="etx-header">
          <div className="etx-header-left">
            <div className="etx-header-icon"><Send size={15} /></div>
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Testnet</p>
              <strong style={{ fontSize: 13 }}>Execute Transaction</strong>
            </div>
          </div>
          <button className="etx-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Progress pills */}
        <div className="etx-steps">
          {(['protocol', 'operation', 'confirm'] as Step[]).map((s, i) => (
            <div key={s} className={`etx-step ${step === s ? 'active' : ['done', 'pending'].includes(step) || (['operation', 'confirm'].includes(step) && i === 0) || (step === 'confirm' && i === 1) ? 'done' : ''}`}>
              <span className="etx-step-num">{i + 1}</span>
              <span className="etx-step-label">{s === 'protocol' ? 'Protocol' : s === 'operation' ? 'Transaction' : 'Confirm'}</span>
            </div>
          ))}
        </div>

        {/* ── Step 1: Protocol ── */}
        {step === 'protocol' && (
          <div className="etx-body">
            <p className="etx-hint">Choose the protocol to interact with.</p>
            <div className="etx-protocol-grid">
              {(Object.keys(TX_MENU) as Protocol[]).map(p => (
                <button
                  key={p}
                  className={`etx-protocol-card color-${TX_MENU[p].color}`}
                  onClick={() => { setProtocol(p); setOpId(null); setStep('operation') }}
                >
                  <span className="etx-protocol-dot" />
                  <strong>{TX_MENU[p].label}</strong>
                  <span className="etx-protocol-ops">{TX_MENU[p].operations.length} operations</span>
                  <ChevronDown size={13} className="etx-chevron" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Operation ── */}
        {step === 'operation' && protocol && (
          <div className="etx-body">
            <button className="etx-back" onClick={() => setStep('protocol')}>← Back</button>
            <p className="etx-hint">Choose a transaction type for <strong>{TX_MENU[protocol].label}</strong>.</p>
            <div className="etx-op-list">
              {TX_MENU[protocol].operations.map(op => (
                <button
                  key={op.id}
                  className={`etx-op-row ${opId === op.id ? 'selected' : ''}`}
                  onClick={() => { setOpId(op.id); setStep('confirm') }}
                >
                  <div className={`etx-op-dot color-${TX_MENU[protocol].color}`} />
                  <div className="etx-op-info">
                    <strong>{op.label}</strong>
                    <span>{op.desc}</span>
                  </div>
                  <ChevronDown size={13} style={{ transform: 'rotate(-90deg)', flexShrink: 0, color: 'var(--muted-foreground)' }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === 'confirm' && protocol && selectedOp && (
          <div className="etx-body">
            <button className="etx-back" onClick={() => setStep('operation')}>← Back</button>
            <p className="etx-hint">Review and submit the transaction.</p>
            <div className="etx-confirm-card">
              <div className="etx-confirm-row">
                <span>Protocol</span>
                <strong className={`etx-badge color-${TX_MENU[protocol].color}`}>{TX_MENU[protocol].label}</strong>
              </div>
              <div className="etx-confirm-row">
                <span>Operation</span>
                <strong>{selectedOp.label}</strong>
              </div>
              <div className="etx-confirm-row">
                <span>Network</span>
                <strong>Sepolia testnet</strong>
              </div>
              <div className="etx-confirm-row">
                <span>Description</span>
                <span style={{ textAlign: 'right', maxWidth: 200 }}>{selectedOp.desc}</span>
              </div>
            </div>
            <p className="etx-warning">
              ⚠ This will sign and broadcast a real Sepolia transaction using the wallet configured in the tx-server's <code>.env</code>.
            </p>
            <button className="etx-submit" onClick={submit}>
              Submit transaction
            </button>
          </div>
        )}

        {/* ── Step 4: Pending ── */}
        {step === 'pending' && (
          <div className="etx-body etx-center">
            <LoadingSpinner size={36} />
            <p style={{ marginTop: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
              Broadcasting transaction…
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted-foreground)' }}>
              Waiting for on-chain confirmation. This may take 15–30 seconds.
            </p>
          </div>
        )}

        {/* ── Step 5: Done ── */}
        {step === 'done' && result && (
          <div className="etx-body etx-center">
            {result.ok ? (
              <>
                <div className="etx-success-icon"><Check size={22} /></div>
                <p style={{ margin: '14px 0 4px', fontSize: 14, fontWeight: 700 }}>Transaction confirmed</p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted-foreground)' }}>Block #{result.blockNumber}</p>
                {result.txHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${result.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="etx-tx-link"
                  >
                    View on Etherscan <ExternalLink size={11} />
                  </a>
                )}
                {result.troveId && (
                  <p className="etx-trove-id">
                    Trove ID: <code>{result.troveId.slice(0, 18)}…</code>
                    <br />
                    <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>Set LIQUITY_TROVE_ID in .env to use it in future ops</span>
                  </p>
                )}
                <div className="etx-done-actions">
                  <button className="etx-again" onClick={() => { setStep('protocol'); setProtocol(null); setOpId(null); setResult(null) }}>
                    New transaction
                  </button>
                  <button className="etx-close-btn" onClick={onClose}>Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="etx-error-icon"><X size={22} /></div>
                <p style={{ margin: '14px 0 6px', fontSize: 14, fontWeight: 700 }}>Transaction failed</p>
                <p className="etx-error-msg">{result.error}</p>
                <div className="etx-done-actions">
                  <button className="etx-again" onClick={() => { setStep('confirm'); setResult(null) }}>
                    Try again
                  </button>
                  <button className="etx-close-btn" onClick={onClose}>Close</button>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [copied, setCopied]     = useState(false)
  const [showTxModal, setShowTxModal] = useState(false)

  const {
    currentAddress,
    summary,
    loading,
    errors,
    handleRefresh,
    rankInfo,
    selectedChain,
    getBlockExplorerUrl,
    events,
    eventIcons,
    eventColors,
    protocolColors,
    getTxExplorerUrl,
  } = useAppData()

  const handleCopyAddress = async () => {
    if (!currentAddress) return
    try {
      await navigator.clipboard.writeText(currentAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = currentAddress
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

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

      {/* ── Execute Transaction button ── */}
      <div className="etx-bar">
        <div className="etx-bar-left">
          <Send size={13} />
          <span>Submit a testnet transaction to build your on-chain credit history.</span>
        </div>
        <button className="etx-trigger" onClick={() => setShowTxModal(true)}>
          Execute Transaction <ChevronDown size={13} />
        </button>
      </div>

      {showTxModal && <ExecuteTxModal onClose={() => setShowTxModal(false)} />}

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
              <ScoreRing score={parseInt(summary.score)} />
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
            <button
              className="copy-button"
              aria-label={copied ? 'Address copied' : 'Copy wallet address'}
              onClick={handleCopyAddress}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
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
          <p className="eyebrow">Score history</p>
          <h2>Score over time</h2>
        </div>
      </div>
      <section className="panel factors-panel">
        {loading.summary ? (
          <div className="panel-loading"><LoadingSpinner size={24} /></div>
        ) : (
          <ScoreHistoryChart wallet={currentAddress} />
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

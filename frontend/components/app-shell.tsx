'use client'

import { type ReactNode, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  AlertCircle,
  Bell,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  Menu,
  Search,
  Settings2,
  Sparkles,
  Trophy,
  Wallet,
  X,
} from 'lucide-react'
import { AppDataProvider, useAppData } from '../lib/app-data'
import { LoadingSpinner } from './shared'

const navItems = [
  { label: 'Overview', icon: LayoutDashboard, href: '/' },
  { label: 'Activity', icon: Activity, href: '/activity' },
  { label: 'Leaderboard', icon: Trophy, href: '/leaderboard' },
]

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false)

  const {
    query, setQuery, handleSearch,
    isConnected, isConnecting, walletAddress, connect,
    chainsData, selectedChain, setSelectedChain,
    summary, walletError, errors, currentAddress,
  } = useAppData()

  const activeLabel = navItems.find(n => n.href === pathname)?.label ?? 'Overview'

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
          <button className="network-dropdown-toggle" onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}>
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
          {navItems.map(({ label, icon: Icon, href }) => (
            <Link
              key={label}
              href={href}
              className={`nav-item ${pathname === href ? 'nav-item-active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} /> {label}
              {label === 'Activity' && summary && summary.unprovenCount > 0 && (
                <span className="nav-count">{summary.unprovenCount}</span>
              )}
            </Link>
          ))}
        </nav>
      </aside>

      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      <section className="content-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div>
              <p className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <h1>{activeLabel === 'Overview' ? (currentAddress ? 'Wallet overview' : 'Good morning') : activeLabel}</h1>
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
              <button className="text-button" onClick={() => window.open('http://localhost:3001/api/health', '_blank')}>
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

          {children}

          <footer className="page-footer">
            <span>Powered by transparent on-chain data</span>
            <span>Data refreshes in real-time</span>
          </footer>
        </div>
      </section>
    </main>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppDataProvider>
      <ShellInner>{children}</ShellInner>
    </AppDataProvider>
  )
}
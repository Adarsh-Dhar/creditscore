import { useState, useEffect, useRef } from 'react';

interface EIP1193Provider {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (accounts: string[]) => void) => void;
  removeListener: (event: string, handler: (accounts: string[]) => void) => void;
}

interface EIP6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<EIP6963ProviderDetail>;
  }
}

export interface WalletState {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

// Wallet extensions (Phantom, etc.) inject scripts that listen for the
// EIP-6963 request event below and can throw internally when responding.
// Those errors originate entirely inside the extension's own script context
// — we never touch that code and can't fix it — so we filter them out of
// the console/dev-overlay instead of leaving real app errors mixed in with
// noise we don't control. Anything not from a chrome-extension:// source is
// left completely untouched.
function isExtensionOriginError(source: string | undefined): boolean {
  return !!source && source.startsWith('chrome-extension://');
}

function suppressExtensionErrors() {
  const onError = (event: ErrorEvent) => {
    if (isExtensionOriginError(event.filename)) {
      event.preventDefault();
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const stack: string | undefined = event.reason?.stack;
    if (stack && stack.includes('chrome-extension://')) {
      event.preventDefault();
    }
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

// Collects every wallet extension announced on the page via EIP-6963,
// but only returns MetaMask to avoid interference from other wallets.
const METAMASK_RDNS = 'io.metamask';

function useDiscoveredProviders() {
  const providersRef = useRef<Map<string, EIP1193Provider>>(new Map());

  useEffect(() => {
    const removeSuppressor = suppressExtensionErrors();
    const onAnnounce = (event: WindowEventMap['eip6963:announceProvider']) => {
      providersRef.current.set(event.detail.info.rdns, event.detail.provider);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      removeSuppressor();
    };
  }, []);

  // Only return MetaMask provider to avoid Phantom extension interference
  const getCandidates = (): EIP1193Provider[] => {
    // First try EIP-6963 announced MetaMask
    const metamaskEIP6963 = providersRef.current.get(METAMASK_RDNS);
    if (metamaskEIP6963) {
      return [metamaskEIP6963];
    }

    // Fallback to older MetaMask versions that don't support EIP-6963
    if (window.ethereum) {
      // Check if window.ethereum is MetaMask directly
      if (window.ethereum.isMetaMask) {
        return [window.ethereum];
      }

      // Check window.ethereum.providers array (older MetaMask pattern)
      if ('providers' in window.ethereum && Array.isArray(window.ethereum.providers)) {
        const metamaskProvider = window.ethereum.providers.find((p: any) => p.isMetaMask);
        if (metamaskProvider) {
          return [metamaskProvider];
        }
      }
    }

    // MetaMask not found
    return [];
  };

  return { getCandidates };
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });
  const { getCandidates } = useDiscoveredProviders();
  const activeProviderRef = useRef<EIP1193Provider | null>(null);

  useEffect(() => {
    // Check if wallet is already connected on mount. Try every discovered
    // provider (not just window.ethereum) so a broken/unrelated extension
    // can't block detection of an already-connected wallet.
    const checkConnection = async () => {
      for (const provider of getCandidates()) {
        try {
          const accounts = await Promise.race([
            provider.request({ method: 'eth_accounts' }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection check timeout')), 5000)
            )
          ]) as string[];

          if (accounts && accounts.length > 0) {
            activeProviderRef.current = provider;
            setState({
              address: accounts[0],
              isConnected: true,
              isConnecting: false,
              error: null,
            });
            return;
          }
        } catch (error) {
          // This provider failed or isn't connected - move on to the next one.
          console.log('Wallet check skipped for a provider (unavailable or interfering)');
        }
      }
    };

    checkConnection();

    // Listen for account changes on every discovered provider - whichever
    // one the user ends up connected with will fire this.
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: null,
        });
      } else if (accounts[0] !== state.address) {
        setState({
          address: accounts[0],
          isConnected: true,
          isConnecting: false,
          error: null,
        });
      }
    };

    const candidates = getCandidates();
    candidates.forEach(provider => provider.on('accountsChanged', handleAccountsChanged));

    return () => {
      candidates.forEach(provider => provider.removeListener('accountsChanged', handleAccountsChanged));
    };
  }, [state.address]);

  const connect = async () => {
    const candidates = getCandidates();

    if (candidates.length === 0) {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: 'MetaMask not found. Please install the MetaMask extension and refresh the page.',
      });
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    let lastError: any = null;

    // Try each discovered provider in turn. If one throws or times out
    // (e.g. a broken injected provider like Phantom's evmAsk bridge),
    // move on to the next candidate instead of retrying the same one.
    for (const provider of candidates) {
      try {
        const accounts = await Promise.race([
          provider.request({ method: 'eth_requestAccounts' }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), 15000)
          )
        ]) as string[];

        if (accounts && accounts.length > 0) {
          activeProviderRef.current = provider;
          setState({
            address: accounts[0],
            isConnected: true,
            isConnecting: false,
            error: null,
          });
          return;
        }
      } catch (error: any) {
        console.error('Wallet connection error:', error);
        lastError = error;

        // The user explicitly rejected the request in their wallet - stop
        // immediately rather than trying other providers.
        if (error.code === 4001) {
          setState({
            address: null,
            isConnected: false,
            isConnecting: false,
            error: 'Connection request was rejected. Please try again.',
          });
          return;
        }

        // If provider is not responding or has internal errors, try next candidate
        if (error.message?.includes('MetaMask extension not found') || 
            error.message?.includes('Failed to connect')) {
          console.log('Provider not available, trying next candidate...');
          continue;
        }

        // Otherwise this provider is unavailable/broken - fall through to
        // the next candidate.
      }
    }

    // All candidates failed.
    if (lastError?.message === 'Connection timeout') {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: 'Connection timed out. Please ensure MetaMask is unlocked and try again. If you have multiple wallet extensions, try disabling others.',
      });
    } else if (lastError?.message?.includes('MetaMask extension not found')) {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: 'MetaMask extension not responding. Please refresh the page or reinstall MetaMask.',
      });
    } else {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: lastError?.message || 'Failed to connect wallet. Please ensure MetaMask is installed and unlocked.',
      });
    }
  };

  const disconnect = () => {
    activeProviderRef.current = null;
    setState({
      address: null,
      isConnected: false,
      isConnecting: false,
      error: null,
    });
  };

  return {
    ...state,
    connect,
    disconnect,
  };
}
import { useState, useEffect } from 'react';

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (accounts: string[]) => void) => void;
      removeListener: (event: string, handler: (accounts: string[]) => void) => void;
    };
  }
}

export interface WalletState {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  useEffect(() => {
    // Check if wallet is already connected on mount
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            setState({
              address: accounts[0],
              isConnected: true,
              isConnecting: false,
              error: null,
            });
          }
        } catch (error) {
          console.error('Failed to check wallet connection:', error);
        }
      }
    };

    checkConnection();

    // Listen for account changes
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

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      }
    };
  }, [state.address]);

  const connect = async () => {
    if (!window.ethereum) {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: 'No wallet extension found. Please install MetaMask or another Web3 wallet.',
      });
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        setState({
          address: accounts[0],
          isConnected: true,
          isConnecting: false,
          error: null,
        });
      }
    } catch (error: any) {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: error?.message || 'Failed to connect wallet',
      });
    }
  };

  const disconnect = () => {
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

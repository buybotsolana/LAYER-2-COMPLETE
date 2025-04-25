import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWalletState } from '../../hooks/useWalletState';

/**
 * MobileWalletConnect component for React Native
 * Implements Solana Mobile Wallet Adapter for connecting to mobile wallets
 */
const MobileWalletConnect = () => {
  const { 
    connected, 
    publicKey, 
    connecting, 
    balance, 
    connect, 
    disconnect, 
    fetchBalance 
  } = useWalletState();

  // Handle wallet connection
  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', 'Failed to connect to wallet. Please try again.');
    }
  };

  // Handle wallet disconnection
  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Disconnection error:', error);
      Alert.alert('Disconnection Error', 'Failed to disconnect wallet. Please try again.');
    }
  };

  // Render wallet connection button or wallet info
  return (
    <View style={styles.container}>
      {!connected ? (
        <TouchableOpacity 
          style={styles.connectButton} 
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Connect Wallet</Text>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.walletInfo}>
          <Text style={styles.walletTitle}>Connected Wallet</Text>
          <Text style={styles.walletAddress}>
            {publicKey?.toBase58().slice(0, 6)}...{publicKey?.toBase58().slice(-6)}
          </Text>
          <Text style={styles.balanceText}>
            Balance: {balance !== null ? `${balance} SOL` : 'Loading...'}
          </Text>
          <TouchableOpacity 
            style={styles.disconnectButton} 
            onPress={handleDisconnect}
          >
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// Component styles
const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginVertical: 10,
  },
  connectButton: {
    backgroundColor: '#512DA8',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#D32F2F',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  walletInfo: {
    alignItems: 'center',
  },
  walletTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  walletAddress: {
    fontSize: 16,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  balanceText: {
    fontSize: 16,
    marginBottom: 12,
  },
});

export default MobileWalletConnect;

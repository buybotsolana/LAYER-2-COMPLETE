import React, { useState, useEffect } from 'react';
import { Box, Card, CardHeader, CardBody, CardFooter, Button, Text, Flex, Heading, Input, Select, Spinner, useToast } from '@chakra-ui/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useSwapState } from '../../hooks/useSwapState';
import { TokenSelector } from '../common/TokenSelector';
import { SwapSettings } from './SwapSettings';

/**
 * SwapInterface component for token swapping on Layer-2
 * Provides a user interface for swapping tokens with price impact and slippage settings
 */
const SwapInterface = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const toast = useToast();
  
  const {
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    slippage,
    priceImpact,
    swapping,
    availableTokens,
    setFromToken,
    setToToken,
    setFromAmount,
    setSlippage,
    calculateToAmount,
    executeSwap,
    getTokenBalance
  } = useSwapState();

  const [fromBalance, setFromBalance] = useState(0);
  const [toBalance, setToBalance] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  // Update balances when tokens or wallet changes
  useEffect(() => {
    if (publicKey && fromToken) {
      updateFromBalance();
    }
  }, [publicKey, fromToken]);

  useEffect(() => {
    if (publicKey && toToken) {
      updateToBalance();
    }
  }, [publicKey, toToken]);

  // Calculate output amount when input amount changes
  useEffect(() => {
    if (fromToken && toToken && fromAmount > 0) {
      calculateToAmount(fromAmount);
    }
  }, [fromToken, toToken, fromAmount]);

  // Update token balances
  const updateFromBalance = async () => {
    if (!publicKey || !fromToken) return;
    try {
      const balance = await getTokenBalance(fromToken.address);
      setFromBalance(balance);
    } catch (error) {
      console.error('Error fetching from token balance:', error);
    }
  };

  const updateToBalance = async () => {
    if (!publicKey || !toToken) return;
    try {
      const balance = await getTokenBalance(toToken.address);
      setToBalance(balance);
    } catch (error) {
      console.error('Error fetching to token balance:', error);
    }
  };

  // Handle token selection
  const handleFromTokenChange = (tokenAddress) => {
    const token = availableTokens.find(t => t.address === tokenAddress);
    if (token) {
      setFromToken(token);
      // If same token selected for both, swap them
      if (toToken && token.address === toToken.address) {
        setToToken(fromToken);
      }
    }
  };

  const handleToTokenChange = (tokenAddress) => {
    const token = availableTokens.find(t => t.address === tokenAddress);
    if (token) {
      setToToken(token);
      // If same token selected for both, swap them
      if (fromToken && token.address === fromToken.address) {
        setFromToken(toToken);
      }
    }
  };

  // Handle amount input
  const handleFromAmountChange = (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setFromAmount(value);
    } else {
      setFromAmount(0);
    }
  };

  // Handle max button click
  const handleMaxClick = () => {
    setFromAmount(fromBalance);
  };

  // Handle swap button click
  const handleSwap = async () => {
    if (!publicKey) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to swap tokens',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (!fromToken || !toToken) {
      toast({
        title: 'Select tokens',
        description: 'Please select tokens to swap',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (fromAmount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid amount to swap',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (fromAmount > fromBalance) {
      toast({
        title: 'Insufficient balance',
        description: `You don't have enough ${fromToken.symbol}`,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    try {
      const signature = await executeSwap();
      
      toast({
        title: 'Swap successful',
        description: `Swapped ${fromAmount} ${fromToken.symbol} for ${toAmount} ${toToken.symbol}`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
      
      // Update balances after swap
      updateFromBalance();
      updateToBalance();
    } catch (error) {
      console.error('Swap error:', error);
      toast({
        title: 'Swap failed',
        description: error.message || 'Failed to execute swap',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Handle token swap (reverse from/to)
  const handleReverseTokens = () => {
    const tempToken = fromToken;
    const tempAmount = fromAmount;
    
    setFromToken(toToken);
    setToToken(tempToken);
    setFromAmount(toAmount);
    
    // Update balances after swap
    updateFromBalance();
    updateToBalance();
  };

  return (
    <Card borderRadius="xl" boxShadow="xl" width="100%" maxWidth="450px" bg="white">
      <CardHeader>
        <Flex justifyContent="space-between" alignItems="center">
          <Heading size="md">Swap Tokens</Heading>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSettings(!showSettings)}
          >
            ⚙️ Settings
          </Button>
        </Flex>
        
        {showSettings && (
          <SwapSettings
            slippage={slippage}
            setSlippage={setSlippage}
            onClose={() => setShowSettings(false)}
          />
        )}
      </CardHeader>
      
      <CardBody>
        {/* From Token Section */}
        <Box mb={4}>
          <Flex justifyContent="space-between" mb={2}>
            <Text fontSize="sm" fontWeight="medium">From</Text>
            <Text fontSize="sm">
              Balance: {fromBalance.toFixed(6)} {fromToken?.symbol || ''}
            </Text>
          </Flex>
          
          <Flex>
            <TokenSelector
              selectedToken={fromToken}
              tokens={availableTokens}
              onChange={handleFromTokenChange}
            />
            
            <Box ml={2} flex="1">
              <Input
                type="number"
                value={fromAmount || ''}
                onChange={handleFromAmountChange}
                placeholder="0.0"
                size="lg"
              />
            </Box>
            
            <Button
              ml={2}
              size="sm"
              alignSelf="center"
              onClick={handleMaxClick}
            >
              MAX
            </Button>
          </Flex>
        </Box>
        
        {/* Swap Direction Button */}
        <Flex justifyContent="center" my={2}>
          <Button
            size="sm"
            borderRadius="full"
            onClick={handleReverseTokens}
          >
            ↓↑
          </Button>
        </Flex>
        
        {/* To Token Section */}
        <Box mb={4}>
          <Flex justifyContent="space-between" mb={2}>
            <Text fontSize="sm" fontWeight="medium">To</Text>
            <Text fontSize="sm">
              Balance: {toBalance.toFixed(6)} {toToken?.symbol || ''}
            </Text>
          </Flex>
          
          <Flex>
            <TokenSelector
              selectedToken={toToken}
              tokens={availableTokens}
              onChange={handleToTokenChange}
            />
            
            <Box ml={2} flex="1">
              <Input
                type="number"
                value={toAmount || ''}
                placeholder="0.0"
                size="lg"
                isReadOnly
              />
            </Box>
          </Flex>
        </Box>
        
        {/* Swap Details */}
        {fromToken && toToken && fromAmount > 0 && toAmount > 0 && (
          <Box
            p={3}
            borderRadius="md"
            bg="gray.50"
            fontSize="sm"
          >
            <Flex justifyContent="space-between" mb={1}>
              <Text>Rate</Text>
              <Text>
                1 {fromToken.symbol} = {(toAmount / fromAmount).toFixed(6)} {toToken.symbol}
              </Text>
            </Flex>
            
            <Flex justifyContent="space-between" mb={1}>
              <Text>Price Impact</Text>
              <Text color={priceImpact > 5 ? "red.500" : "inherit"}>
                {priceImpact.toFixed(2)}%
              </Text>
            </Flex>
            
            <Flex justifyContent="space-between">
              <Text>Max Slippage</Text>
              <Text>{slippage}%</Text>
            </Flex>
          </Box>
        )}
      </CardBody>
      
      <CardFooter>
        <Button
          colorScheme="blue"
          width="100%"
          size="lg"
          onClick={handleSwap}
          isLoading={swapping}
          loadingText="Swapping..."
          isDisabled={!publicKey || !fromToken || !toToken || fromAmount <= 0 || fromAmount > fromBalance}
        >
          {!publicKey
            ? 'Connect Wallet'
            : !fromToken || !toToken
            ? 'Select Tokens'
            : fromAmount <= 0
            ? 'Enter Amount'
            : fromAmount > fromBalance
            ? 'Insufficient Balance'
            : 'Swap'}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default SwapInterface;

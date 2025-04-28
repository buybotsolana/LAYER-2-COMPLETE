import React, { useState, useEffect } from 'react';
import { Box, Card, CardHeader, CardBody, CardFooter, Button, Text, Flex, Heading, Input, Slider, SliderTrack, SliderFilledTrack, SliderThumb, FormControl, FormLabel, useToast } from '@chakra-ui/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useLendingState } from '../../hooks/useLendingState';
import { TokenSelector } from '../common/TokenSelector';

/**
 * LendingInterface component for lending and borrowing on Layer-2
 * Provides a user interface for depositing collateral, borrowing assets, and managing positions
 */
const LendingInterface = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const toast = useToast();
  
  const {
    availableTokens,
    depositedTokens,
    borrowedTokens,
    depositToken,
    borrowToken,
    depositAmount,
    borrowAmount,
    healthFactor,
    maxBorrowAmount,
    liquidationThreshold,
    isDepositing,
    isBorrowing,
    isRepaying,
    isWithdrawing,
    getTokenBalance,
    executeDeposit,
    executeBorrow,
    executeRepay,
    executeWithdraw,
    setDepositToken,
    setBorrowToken,
    setDepositAmount,
    setBorrowAmount,
    calculateMaxBorrow,
    calculateHealthFactor
  } = useLendingState();

  const [depositBalance, setDepositBalance] = useState(0);
  const [borrowBalance, setBorrowBalance] = useState(0);
  const [activeTab, setActiveTab] = useState('deposit'); // 'deposit', 'borrow', 'repay', 'withdraw'

  // Update balances when tokens or wallet changes
  useEffect(() => {
    if (publicKey && depositToken) {
      updateDepositBalance();
    }
  }, [publicKey, depositToken]);

  useEffect(() => {
    if (publicKey && borrowToken) {
      updateBorrowBalance();
    }
  }, [publicKey, borrowToken]);

  // Calculate max borrow when deposit amount changes
  useEffect(() => {
    if (depositToken && depositAmount > 0) {
      calculateMaxBorrow(depositAmount);
    }
  }, [depositToken, depositAmount]);

  // Update token balances
  const updateDepositBalance = async () => {
    if (!publicKey || !depositToken) return;
    try {
      const balance = await getTokenBalance(depositToken.address);
      setDepositBalance(balance);
    } catch (error) {
      console.error('Error fetching deposit token balance:', error);
    }
  };

  const updateBorrowBalance = async () => {
    if (!publicKey || !borrowToken) return;
    try {
      const balance = await getTokenBalance(borrowToken.address);
      setBorrowBalance(balance);
    } catch (error) {
      console.error('Error fetching borrow token balance:', error);
    }
  };

  // Handle token selection
  const handleDepositTokenChange = (tokenAddress) => {
    const token = availableTokens.find(t => t.address === tokenAddress);
    if (token) {
      setDepositToken(token);
    }
  };

  const handleBorrowTokenChange = (tokenAddress) => {
    const token = availableTokens.find(t => t.address === tokenAddress);
    if (token) {
      setBorrowToken(token);
    }
  };

  // Handle amount input
  const handleDepositAmountChange = (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setDepositAmount(value);
    } else {
      setDepositAmount(0);
    }
  };

  const handleBorrowAmountChange = (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setBorrowAmount(value);
      calculateHealthFactor(value);
    } else {
      setBorrowAmount(0);
      calculateHealthFactor(0);
    }
  };

  // Handle max button click
  const handleMaxDepositClick = () => {
    setDepositAmount(depositBalance);
  };

  const handleMaxBorrowClick = () => {
    setBorrowAmount(maxBorrowAmount);
    calculateHealthFactor(maxBorrowAmount);
  };

  // Handle deposit action
  const handleDeposit = async () => {
    if (!publicKey) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to deposit',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (!depositToken) {
      toast({
        title: 'Select token',
        description: 'Please select a token to deposit',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (depositAmount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid amount to deposit',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (depositAmount > depositBalance) {
      toast({
        title: 'Insufficient balance',
        description: `You don't have enough ${depositToken.symbol}`,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    try {
      const signature = await executeDeposit();
      
      toast({
        title: 'Deposit successful',
        description: `Deposited ${depositAmount} ${depositToken.symbol}`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
      
      // Update balances after deposit
      updateDepositBalance();
    } catch (error) {
      console.error('Deposit error:', error);
      toast({
        title: 'Deposit failed',
        description: error.message || 'Failed to execute deposit',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Handle borrow action
  const handleBorrow = async () => {
    if (!publicKey) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to borrow',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (!borrowToken) {
      toast({
        title: 'Select token',
        description: 'Please select a token to borrow',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (borrowAmount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid amount to borrow',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (borrowAmount > maxBorrowAmount) {
      toast({
        title: 'Exceeds borrow limit',
        description: `You can borrow up to ${maxBorrowAmount} ${borrowToken.symbol}`,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (healthFactor < 1.1) {
      toast({
        title: 'Unsafe health factor',
        description: 'Borrowing this amount would put your position at risk of liquidation',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    try {
      const signature = await executeBorrow();
      
      toast({
        title: 'Borrow successful',
        description: `Borrowed ${borrowAmount} ${borrowToken.symbol}`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
      
      // Update balances after borrow
      updateBorrowBalance();
    } catch (error) {
      console.error('Borrow error:', error);
      toast({
        title: 'Borrow failed',
        description: error.message || 'Failed to execute borrow',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Render health factor indicator
  const renderHealthFactor = () => {
    let color = 'green.500';
    if (healthFactor < 1.1) color = 'red.500';
    else if (healthFactor < 1.5) color = 'orange.500';
    else if (healthFactor < 2) color = 'yellow.500';

    return (
      <Box mt={4} p={3} borderRadius="md" bg="gray.50">
        <Text mb={2}>Health Factor: <Text as="span" color={color} fontWeight="bold">{healthFactor.toFixed(2)}</Text></Text>
        <Slider
          aria-label="health-factor"
          value={Math.min(healthFactor * 33.3, 100)}
          isReadOnly
          colorScheme={healthFactor < 1.1 ? 'red' : healthFactor < 1.5 ? 'orange' : healthFactor < 2 ? 'yellow' : 'green'}
        >
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb />
        </Slider>
        <Text mt={1} fontSize="sm">
          {healthFactor < 1.1 ? 'High risk of liquidation!' : 
           healthFactor < 1.5 ? 'Caution: Low safety margin' : 
           healthFactor < 2 ? 'Moderate safety margin' : 
           'Safe position'}
        </Text>
      </Box>
    );
  };

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'deposit':
        return (
          <>
            <Box mb={4}>
              <Flex justifyContent="space-between" mb={2}>
                <Text fontSize="sm" fontWeight="medium">Deposit Token</Text>
                <Text fontSize="sm">
                  Balance: {depositBalance.toFixed(6)} {depositToken?.symbol || ''}
                </Text>
              </Flex>
              
              <Flex>
                <TokenSelector
                  selectedToken={depositToken}
                  tokens={availableTokens}
                  onChange={handleDepositTokenChange}
                />
                
                <Box ml={2} flex="1">
                  <Input
                    type="number"
                    value={depositAmount || ''}
                    onChange={handleDepositAmountChange}
                    placeholder="0.0"
                    size="lg"
                  />
                </Box>
                
                <Button
                  ml={2}
                  size="sm"
                  alignSelf="center"
                  onClick={handleMaxDepositClick}
                >
                  MAX
                </Button>
              </Flex>
            </Box>
            
            {depositToken && (
              <Box p={3} borderRadius="md" bg="gray.50" fontSize="sm" mb={4}>
                <Flex justifyContent="space-between" mb={1}>
                  <Text>Deposit APY</Text>
                  <Text>{depositToken.depositApy || '0.00'}%</Text>
                </Flex>
                
                <Flex justifyContent="space-between">
                  <Text>Collateral Factor</Text>
                  <Text>{depositToken.collateralFactor || '0.00'}%</Text>
                </Flex>
              </Box>
            )}
            
            <Button
              colorScheme="blue"
              width="100%"
              size="lg"
              onClick={handleDeposit}
              isLoading={isDepositing}
              loadingText="Depositing..."
              isDisabled={!publicKey || !depositToken || depositAmount <= 0 || depositAmount > depositBalance}
            >
              {!publicKey
                ? 'Connect Wallet'
                : !depositToken
                ? 'Select Token'
                : depositAmount <= 0
                ? 'Enter Amount'
                : depositAmount > depositBalance
                ? 'Insufficient Balance'
                : 'Deposit'}
            </Button>
          </>
        );
        
      case 'borrow':
        return (
          <>
            <Box mb={4}>
              <Flex justifyContent="space-between" mb={2}>
                <Text fontSize="sm" fontWeight="medium">Borrow Token</Text>
                <Text fontSize="sm">
                  Available: {maxBorrowAmount.toFixed(6)} {borrowToken?.symbol || ''}
                </Text>
              </Flex>
              
              <Flex>
                <TokenSelector
                  selectedToken={borrowToken}
                  tokens={availableTokens}
                  onChange={handleBorrowTokenChange}
                />
                
                <Box ml={2} flex="1">
                  <Input
                    type="number"
                    value={borrowAmount || ''}
                    onChange={handleBorrowAmountChange}
                    placeholder="0.0"
                    size="lg"
                  />
                </Box>
                
                <Button
                  ml={2}
                  size="sm"
                  alignSelf="center"
                  onClick={handleMaxBorrowClick}
                >
                  MAX
                </Button>
              </Flex>
            </Box>
            
            {borrowToken && (
              <Box p={3} borderRadius="md" bg="gray.50" fontSize="sm" mb={4}>
                <Flex justifyContent="space-between" mb={1}>
                  <Text>Borrow APY</Text>
                  <Text>{borrowToken.borrowApy || '0.00'}%</Text>
                </Flex>
                
                <Flex justifyContent="space-between">
                  <Text>Liquidation Threshold</Text>
                  <Text>{liquidationThreshold || '0.00'}%</Text>
                </Flex>
              </Box>
            )}
            
            {renderHealthFactor()}
            
            <Button
              colorScheme="blue"
              width="100%"
              size="lg"
              mt={4}
              onClick={handleBorrow}
              isLoading={isBorrowing}
              loadingText="Borrowing..."
              isDisabled={!publicKey || !borrowToken || borrowAmount <= 0 || borrowAmount > maxBorrowAmount || healthFactor < 1.1}
            >
              {!publicKey
                ? 'Connect Wallet'
                : !borrowToken
                ? 'Select Token'
                : borrowAmount <= 0
                ? 'Enter Amount'
                : borrowAmount > maxBorrowAmount
                ? 'Exceeds Borrow Limit'
                : healthFactor < 1.1
                ? 'Unsafe Health Factor'
                : 'Borrow'}
            </Button>
          </>
        );
        
      case 'repay':
        return (
          <Box p={4} textAlign="center">
            <Text>Repay functionality will be implemented in the next phase</Text>
          </Box>
        );
        
      case 'withdraw':
        return (
          <Box p={4} textAlign="center">
            <Text>Withdraw functionality will be implemented in the next phase</Text>
          </Box>
        );
        
      default:
        return null;
    }
  };

  return (
    <Card borderRadius="xl" boxShadow="xl" width="100%" maxWidth="450px" bg="white">
      <CardHeader>
        <Heading size="md">Lending Protocol</Heading>
      </CardHeader>
      
      <Box px={4}>
        <Flex>
          <Button
            flex="1"
            variant={activeTab === 'deposit' ? 'solid' : 'ghost'}
            colorScheme={activeTab === 'deposit' ? 'blue' : 'gray'}
            onClick={() => setActiveTab('deposit')}
          >
            Deposit
          </Button>
          <Button
            flex="1"
            variant={activeTab === 'borrow' ? 'solid' : 'ghost'}
            colorScheme={activeTab === 'borrow' ? 'blue' : 'gray'}
            onClick={() => setActiveTab('borrow')}
          >
            Borrow
          </Button>
          <Button
            flex="1"
            variant={activeTab === 'repay' ? 'solid' : 'ghost'}
            colorScheme={activeTab === 'repay' ? 'blue' : 'gray'}
            onClick={() => setActiveTab('repay')}
          >
            Repay
          </Button>
          <Button
            flex="1"
            variant={activeTab === 'withdraw' ? 'solid' : 'ghost'}
            colorScheme={activeTab === 'withdraw' ? 'blue' : 'gray'}
            onClick={() => setActiveTab('withdraw')}
          >
            Withdraw
          </Button>
        </Flex>
      </Box>
      
      <CardBody>
        {renderTabContent()}
      </CardBody>
    </Card>
  );
};

export default LendingInterface;

// src/e2e/deposit_transact_withdraw_test.js
const { ethers } = require('ethers');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { expect } = require('chai');

describe('End-to-End: Deposit, Transact, Withdraw Flow', function() {
  // This test may take longer than the default Mocha timeout
  this.timeout(60000);
  
  let ethProvider;
  let solConnection;
  let depositBridge;
  let withdrawalBridge;
  let l2Client;
  let user;
  let l2Wallet;
  
  before(async function() {
    // Setup connections
    ethProvider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
    solConnection = new Connection("http://localhost:8899", "confirmed");
    l2Client = new L2Client("http://localhost:3000");
    
    // Get user wallet
    const privateKey = "0x" + "1".repeat(64); // Deterministic private key from ganache
    user = new ethers.Wallet(privateKey, ethProvider);
    
    // Setup L2 wallet
    l2Wallet = Keypair.generate();
    
    console.log("User ETH address:", user.address);
    console.log("L2 wallet public key:", l2Wallet.publicKey.toString());
    
    // Get contract addresses from deployment
    const deploymentInfo = require('../ethereum/deployments/localhost/deployment.json');
    
    depositBridge = new ethers.Contract(
      deploymentInfo.depositBridge,
      require('../ethereum/artifacts/contracts/L1ToL2DepositBridge.sol/L1ToL2DepositBridge.json').abi,
      user
    );
    
    withdrawalBridge = new ethers.Contract(
      deploymentInfo.withdrawalBridge,
      require('../ethereum/artifacts/contracts/L2ToL1WithdrawalBridge.sol/L2ToL1WithdrawalBridge.json').abi,
      user
    );
    
    console.log("Deposit Bridge address:", depositBridge.address);
    console.log("Withdrawal Bridge address:", withdrawalBridge.address);
  });
  
  it('should complete a full deposit, transaction, and withdrawal cycle', async function() {
    // Step 1: Check initial balances
    console.log("Step 1: Checking initial balances");
    
    const initialL1Balance = await ethProvider.getBalance(user.address);
    const initialL2Balance = await l2Client.getBalance(l2Wallet.publicKey);
    
    console.log("Initial L1 balance:", ethers.utils.formatEther(initialL1Balance), "ETH");
    console.log("Initial L2 balance:", ethers.utils.formatEther(initialL2Balance), "ETH");
    
    // Step 2: Deposit ETH from L1 to L2
    console.log("Step 2: Depositing ETH from L1 to L2");
    
    const depositAmount = ethers.utils.parseEther("1.0");
    console.log("Deposit amount:", ethers.utils.formatEther(depositAmount), "ETH");
    
    const depositTx = await depositBridge.deposit(
      Buffer.from(l2Wallet.publicKey.toBytes()),
      { value: depositAmount }
    );
    
    console.log("Deposit transaction hash:", depositTx.hash);
    await depositTx.wait();
    console.log("Deposit transaction confirmed on L1");
    
    // Step 3: Wait for deposit to be processed on L2
    console.log("Step 3: Waiting for deposit to be processed on L2");
    
    let l2BalanceAfterDeposit;
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      l2BalanceAfterDeposit = await l2Client.getBalance(l2Wallet.publicKey);
      
      if (l2BalanceAfterDeposit.gt(initialL2Balance)) {
        console.log("Deposit processed on L2");
        break;
      }
      
      console.log("Waiting for deposit to be processed...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      throw new Error("Deposit was not processed on L2 within the expected time");
    }
    
    console.log("L2 balance after deposit:", ethers.utils.formatEther(l2BalanceAfterDeposit), "ETH");
    expect(l2BalanceAfterDeposit.sub(initialL2Balance).eq(depositAmount)).to.be.true;
    
    // Step 4: Execute a transaction on L2
    console.log("Step 4: Executing a transaction on L2");
    
    const recipient = Keypair.generate();
    console.log("Recipient public key:", recipient.publicKey.toString());
    
    const transferAmount = ethers.utils.parseEther("0.5");
    console.log("Transfer amount:", ethers.utils.formatEther(transferAmount), "ETH");
    
    const transferTx = await l2Client.transfer(
      l2Wallet,
      recipient.publicKey,
      transferAmount
    );
    
    console.log("Transfer transaction signature:", transferTx);
    
    // Step 5: Verify the transaction on L2
    console.log("Step 5: Verifying the transaction on L2");
    
    let recipientBalance;
    attempts = 0;
    
    while (attempts < maxAttempts) {
      recipientBalance = await l2Client.getBalance(recipient.publicKey);
      
      if (recipientBalance.gt(0)) {
        console.log("Transfer confirmed on L2");
        break;
      }
      
      console.log("Waiting for transfer to be confirmed...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      throw new Error("Transfer was not confirmed on L2 within the expected time");
    }
    
    const l2BalanceAfterTransfer = await l2Client.getBalance(l2Wallet.publicKey);
    
    console.log("Recipient balance after transfer:", ethers.utils.formatEther(recipientBalance), "ETH");
    console.log("Sender balance after transfer:", ethers.utils.formatEther(l2BalanceAfterTransfer), "ETH");
    
    expect(recipientBalance.eq(transferAmount)).to.be.true;
    expect(l2BalanceAfterDeposit.sub(l2BalanceAfterTransfer).eq(transferAmount)).to.be.true;
    
    // Step 6: Initiate withdrawal from L2 to L1
    console.log("Step 6: Initiating withdrawal from L2 to L1");
    
    const withdrawalAmount = ethers.utils.parseEther("0.3");
    console.log("Withdrawal amount:", ethers.utils.formatEther(withdrawalAmount), "ETH");
    
    const withdrawalTx = await l2Client.withdraw(
      l2Wallet,
      user.address,
      withdrawalAmount
    );
    
    console.log("Withdrawal transaction signature:", withdrawalTx);
    
    // Step 7: Wait for withdrawal to be finalized
    console.log("Step 7: Waiting for withdrawal to be finalized");
    
    // In a real implementation, this would take 7 days in production
    // For testing, we'll simulate a faster finalization
    const withdrawalId = await l2Client.waitForWithdrawalFinalization(withdrawalTx);
    console.log("Withdrawal ID:", withdrawalId);
    
    // Step 8: Complete withdrawal on L1
    console.log("Step 8: Completing withdrawal on L1");
    
    const completeWithdrawalTx = await withdrawalBridge.completeWithdrawal(withdrawalId);
    console.log("Complete withdrawal transaction hash:", completeWithdrawalTx.hash);
    await completeWithdrawalTx.wait();
    console.log("Withdrawal transaction confirmed on L1");
    
    // Step 9: Verify final balances
    console.log("Step 9: Verifying final balances");
    
    const finalL1Balance = await ethProvider.getBalance(user.address);
    const finalL2Balance = await l2Client.getBalance(l2Wallet.publicKey);
    
    console.log("Final L1 balance:", ethers.utils.formatEther(finalL1Balance), "ETH");
    console.log("Final L2 balance:", ethers.utils.formatEther(finalL2Balance), "ETH");
    
    // Account for gas costs in L1 balance comparison
    const l1BalanceDiff = finalL1Balance.sub(initialL1Balance);
    console.log("L1 balance change:", ethers.utils.formatEther(l1BalanceDiff), "ETH");
    
    // The L1 balance should be lower due to deposit and gas costs, but higher due to withdrawal
    // So we expect: initialL1Balance - depositAmount - gasCosts + withdrawalAmount
    // This means l1BalanceDiff should be negative but greater than -depositAmount
    expect(l1BalanceDiff.lt(0)).to.be.true;
    expect(l1BalanceDiff.gt(depositAmount.mul(-1))).to.be.true;
    
    // The L2 balance should reflect deposit - transfer - withdrawal
    const expectedL2Balance = depositAmount.sub(transferAmount).sub(withdrawalAmount);
    console.log("Expected L2 balance:", ethers.utils.formatEther(expectedL2Balance), "ETH");
    
    expect(finalL2Balance.eq(expectedL2Balance)).to.be.true;
  });
});

// Mock L2Client class for testing
// In a real implementation, this would be replaced with actual SDK
class L2Client {
  constructor(url) {
    this.url = url;
    this.balances = new Map();
    this.withdrawals = new Map();
    this.nextWithdrawalId = 1;
  }
  
  async getBalance(publicKey) {
    const key = publicKey.toString();
    return this.balances.get(key) || ethers.BigNumber.from(0);
  }
  
  async transfer(fromWallet, toPublicKey, amount) {
    const fromKey = fromWallet.publicKey.toString();
    const toKey = toPublicKey.toString();
    
    const fromBalance = await this.getBalance(fromWallet.publicKey);
    
    if (fromBalance.lt(amount)) {
      throw new Error("Insufficient balance");
    }
    
    // Update balances
    this.balances.set(fromKey, fromBalance.sub(amount));
    
    const toBalance = await this.getBalance(toPublicKey);
    this.balances.set(toKey, toBalance.add(amount));
    
    // Return a mock transaction signature
    return "mock_transaction_signature";
  }
  
  async withdraw(wallet, l1Recipient, amount) {
    const key = wallet.publicKey.toString();
    const balance = await this.getBalance(wallet.publicKey);
    
    if (balance.lt(amount)) {
      throw new Error("Insufficient balance");
    }
    
    // Update balance
    this.balances.set(key, balance.sub(amount));
    
    // Create withdrawal
    const withdrawalId = this.nextWithdrawalId++;
    this.withdrawals.set(withdrawalId, {
      id: withdrawalId,
      l2Sender: wallet.publicKey.toString(),
      l1Recipient,
      amount,
      completed: false
    });
    
    return withdrawalId;
  }
  
  // Mock method to simulate waiting for withdrawal finalization
  async waitForWithdrawalFinalization(withdrawalId) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return withdrawalId;
  }
}

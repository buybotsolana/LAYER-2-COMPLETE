// src/integration/withdrawal_flow_test.js
const { ethers } = require('ethers');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { expect } = require('chai');

describe('Withdrawal Flow Integration Test', function() {
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
    
    // Deploy contracts
    const DepositBridge = await ethers.getContractFactory("L1ToL2DepositBridge");
    const WithdrawalBridge = await ethers.getContractFactory("L2ToL1WithdrawalBridge");
    [user] = await ethers.getSigners();
    
    depositBridge = await DepositBridge.deploy();
    await depositBridge.deployed();
    
    withdrawalBridge = await WithdrawalBridge.deploy();
    await withdrawalBridge.deployed();
    
    // Setup L2 wallet
    l2Wallet = Keypair.generate();
    
    // Fund L2 wallet with a deposit
    const depositAmount = ethers.utils.parseEther("5.0");
    await depositBridge.connect(user).deposit(
      Buffer.from(l2Wallet.publicKey.toBytes()),
      { value: depositAmount }
    );
    
    // Wait for deposit to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));
  });
  
  it('should process a withdrawal from L2 to L1', async function() {
    // Initial balances
    const initialL1Balance = await ethProvider.getBalance(user.address);
    const initialL2Balance = await l2Client.getBalance(l2Wallet.publicKey);
    
    // Execute withdrawal
    const withdrawalAmount = ethers.utils.parseEther("1.0");
    const withdrawalTx = await l2Client.withdraw(
      l2Wallet,
      user.address,
      withdrawalAmount
    );
    
    // Wait for withdrawal to be finalized (this would take 7 days in production)
    // For testing, we'll simulate a faster finalization
    const withdrawalId = await l2Client.waitForWithdrawalFinalization(withdrawalTx);
    
    // Complete withdrawal on L1
    await withdrawalBridge.connect(user).completeWithdrawal(withdrawalId);
    
    // Verify balances
    const finalL1Balance = await ethProvider.getBalance(user.address);
    const finalL2Balance = await l2Client.getBalance(l2Wallet.publicKey);
    
    expect(finalL1Balance.sub(initialL1Balance).eq(withdrawalAmount)).to.be.true;
    expect(initialL2Balance.sub(finalL2Balance).eq(withdrawalAmount)).to.be.true;
  });
  
  it('should handle multiple withdrawals correctly', async function() {
    // Create multiple L2 wallets
    const wallets = [
      Keypair.generate(),
      Keypair.generate(),
      Keypair.generate()
    ];
    
    // Fund each wallet with a deposit
    const depositAmount = ethers.utils.parseEther("2.0");
    
    for (const wallet of wallets) {
      await depositBridge.connect(user).deposit(
        Buffer.from(wallet.publicKey.toBytes()),
        { value: depositAmount }
      );
    }
    
    // Wait for deposits to be processed
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Initial balances
    const initialL1Balance = await ethProvider.getBalance(user.address);
    const initialL2Balances = await Promise.all(
      wallets.map(wallet => l2Client.getBalance(wallet.publicKey))
    );
    
    // Execute withdrawals
    const withdrawalAmount = ethers.utils.parseEther("1.0");
    const withdrawalIds = [];
    
    for (const wallet of wallets) {
      const withdrawalTx = await l2Client.withdraw(
        wallet,
        user.address,
        withdrawalAmount
      );
      
      const withdrawalId = await l2Client.waitForWithdrawalFinalization(withdrawalTx);
      withdrawalIds.push(withdrawalId);
    }
    
    // Complete all withdrawals on L1
    for (const withdrawalId of withdrawalIds) {
      await withdrawalBridge.connect(user).completeWithdrawal(withdrawalId);
    }
    
    // Verify balances
    const finalL1Balance = await ethProvider.getBalance(user.address);
    const finalL2Balances = await Promise.all(
      wallets.map(wallet => l2Client.getBalance(wallet.publicKey))
    );
    
    expect(finalL1Balance.sub(initialL1Balance).eq(withdrawalAmount.mul(wallets.length))).to.be.true;
    
    for (let i = 0; i < wallets.length; i++) {
      expect(initialL2Balances[i].sub(finalL2Balances[i]).eq(withdrawalAmount)).to.be.true;
    }
  });
  
  it('should handle ERC20 token withdrawals', async function() {
    // Deploy ERC20 token
    const Token = await ethers.getContractFactory("TestToken");
    const token = await Token.deploy("Test Token", "TST", 18);
    await token.deployed();
    
    // Setup L2 wallet
    const l2TokenWallet = Keypair.generate();
    
    // Mint tokens to user
    await token.mint(user.address, ethers.utils.parseEther("100.0"));
    
    // Approve token transfer
    const depositAmount = ethers.utils.parseEther("10.0");
    await token.connect(user).approve(depositBridge.address, depositAmount);
    
    // Execute deposit to fund L2 wallet
    await depositBridge.connect(user).depositERC20(
      token.address,
      depositAmount,
      Buffer.from(l2TokenWallet.publicKey.toBytes())
    );
    
    // Wait for deposit to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Initial balances
    const initialL1Balance = await token.balanceOf(user.address);
    const initialL2Balance = await l2Client.getTokenBalance(l2TokenWallet.publicKey, token.address);
    
    // Execute withdrawal
    const withdrawalAmount = ethers.utils.parseEther("5.0");
    const withdrawalTx = await l2Client.withdrawToken(
      l2TokenWallet,
      user.address,
      token.address,
      withdrawalAmount
    );
    
    // Wait for withdrawal to be finalized
    const withdrawalId = await l2Client.waitForWithdrawalFinalization(withdrawalTx);
    
    // Complete withdrawal on L1
    await withdrawalBridge.connect(user).completeTokenWithdrawal(withdrawalId);
    
    // Verify balances
    const finalL1Balance = await token.balanceOf(user.address);
    const finalL2Balance = await l2Client.getTokenBalance(l2TokenWallet.publicKey, token.address);
    
    expect(finalL1Balance.sub(initialL1Balance).eq(withdrawalAmount)).to.be.true;
    expect(initialL2Balance.sub(finalL2Balance).eq(withdrawalAmount)).to.be.true;
  });
  
  it('should reject invalid withdrawals', async function() {
    // Try to withdraw more than balance
    const excessiveAmount = ethers.utils.parseEther("10.0"); // More than the wallet has
    
    await expect(
      l2Client.withdraw(l2Wallet, user.address, excessiveAmount)
    ).to.be.rejectedWith("Insufficient balance");
    
    // Try to complete a non-existent withdrawal
    await expect(
      withdrawalBridge.connect(user).completeWithdrawal(999999)
    ).to.be.revertedWith("Withdrawal does not exist");
    
    // Try to complete an already completed withdrawal
    const withdrawalAmount = ethers.utils.parseEther("1.0");
    const withdrawalTx = await l2Client.withdraw(
      l2Wallet,
      user.address,
      withdrawalAmount
    );
    
    const withdrawalId = await l2Client.waitForWithdrawalFinalization(withdrawalTx);
    await withdrawalBridge.connect(user).completeWithdrawal(withdrawalId);
    
    await expect(
      withdrawalBridge.connect(user).completeWithdrawal(withdrawalId)
    ).to.be.revertedWith("Withdrawal already completed");
  });
});

// Mock L2Client class for testing
class L2Client {
  constructor(url) {
    this.url = url;
    this.balances = new Map();
    this.tokenBalances = new Map();
    this.withdrawals = new Map();
    this.nextWithdrawalId = 1;
  }
  
  async getBalance(publicKey) {
    const key = publicKey.toString();
    return this.balances.get(key) || ethers.BigNumber.from(0);
  }
  
  async getTokenBalance(publicKey, tokenAddress) {
    const key = `${publicKey.toString()}-${tokenAddress}`;
    return this.tokenBalances.get(key) || ethers.BigNumber.from(0);
  }
  
  async withdraw(wallet, l1Recipient, amount) {
    const key = wallet.publicKey.toString();
    const balance = await this.getBalance(key);
    
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
      token: null,
      completed: false
    });
    
    return { withdrawalId };
  }
  
  async withdrawToken(wallet, l1Recipient, tokenAddress, amount) {
    const key = `${wallet.publicKey.toString()}-${tokenAddress}`;
    const balance = await this.getTokenBalance(wallet.publicKey, tokenAddress);
    
    if (balance.lt(amount)) {
      throw new Error("Insufficient token balance");
    }
    
    // Update balance
    this.tokenBalances.set(key, balance.sub(amount));
    
    // Create withdrawal
    const withdrawalId = this.nextWithdrawalId++;
    this.withdrawals.set(withdrawalId, {
      id: withdrawalId,
      l2Sender: wallet.publicKey.toString(),
      l1Recipient,
      amount,
      token: tokenAddress,
      completed: false
    });
    
    return { withdrawalId };
  }
  
  // Mock method to simulate waiting for withdrawal finalization
  async waitForWithdrawalFinalization(withdrawalTx) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return withdrawalTx.withdrawalId;
  }
}

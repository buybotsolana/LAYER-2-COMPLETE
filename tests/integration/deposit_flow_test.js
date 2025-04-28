// src/integration/deposit_flow_test.js
const { ethers } = require('ethers');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { expect } = require('chai');

describe('Deposit Flow Integration Test', function() {
  let ethProvider;
  let solConnection;
  let depositBridge;
  let l2Client;
  let user;
  
  before(async function() {
    // Setup connections
    ethProvider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
    solConnection = new Connection("http://localhost:8899", "confirmed");
    l2Client = new L2Client("http://localhost:3000");
    
    // Deploy contracts
    const DepositBridge = await ethers.getContractFactory("L1ToL2DepositBridge");
    [user] = await ethers.getSigners();
    depositBridge = await DepositBridge.deploy();
    await depositBridge.deployed();
    
    // Setup L2 recipient
    const l2Recipient = new PublicKey("..."); // Test public key
  });
  
  it('should process a deposit from L1 to L2', async function() {
    // Initial balances
    const initialL1Balance = await ethProvider.getBalance(user.address);
    const initialL2Balance = await l2Client.getBalance(l2Recipient);
    
    // Execute deposit
    const depositAmount = ethers.utils.parseEther("1.0");
    await depositBridge.connect(user).deposit(l2Recipient.toBuffer(), { value: depositAmount });
    
    // Wait for sequencer to process
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify balances
    const finalL1Balance = await ethProvider.getBalance(user.address);
    const finalL2Balance = await l2Client.getBalance(l2Recipient);
    
    expect(initialL1Balance.sub(finalL1Balance).gt(depositAmount)).to.be.true; // Account for gas
    expect(finalL2Balance.sub(initialL2Balance).eq(depositAmount)).to.be.true;
  });
  
  it('should handle multiple deposits correctly', async function() {
    // Create multiple recipients
    const recipients = [
      new PublicKey("..."), // Test public key 1
      new PublicKey("..."), // Test public key 2
      new PublicKey("...")  // Test public key 3
    ];
    
    // Initial balances
    const initialL1Balance = await ethProvider.getBalance(user.address);
    const initialL2Balances = await Promise.all(
      recipients.map(recipient => l2Client.getBalance(recipient))
    );
    
    // Execute deposits
    const depositAmount = ethers.utils.parseEther("0.5");
    
    for (let i = 0; i < recipients.length; i++) {
      await depositBridge.connect(user).deposit(recipients[i].toBuffer(), { value: depositAmount });
    }
    
    // Wait for sequencer to process all deposits
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Verify balances
    const finalL1Balance = await ethProvider.getBalance(user.address);
    const finalL2Balances = await Promise.all(
      recipients.map(recipient => l2Client.getBalance(recipient))
    );
    
    expect(initialL1Balance.sub(finalL1Balance).gt(depositAmount.mul(recipients.length))).to.be.true; // Account for gas
    
    for (let i = 0; i < recipients.length; i++) {
      expect(finalL2Balances[i].sub(initialL2Balances[i]).eq(depositAmount)).to.be.true;
    }
  });
  
  it('should handle ERC20 token deposits', async function() {
    // Deploy ERC20 token
    const Token = await ethers.getContractFactory("TestToken");
    const token = await Token.deploy("Test Token", "TST", 18);
    await token.deployed();
    
    // Mint tokens to user
    await token.mint(user.address, ethers.utils.parseEther("100.0"));
    
    // Setup L2 recipient
    const l2Recipient = new PublicKey("..."); // Test public key
    
    // Initial balances
    const initialL1Balance = await token.balanceOf(user.address);
    const initialL2Balance = await l2Client.getTokenBalance(l2Recipient, token.address);
    
    // Approve token transfer
    const depositAmount = ethers.utils.parseEther("10.0");
    await token.connect(user).approve(depositBridge.address, depositAmount);
    
    // Execute deposit
    await depositBridge.connect(user).depositERC20(
      token.address,
      depositAmount,
      l2Recipient.toBuffer()
    );
    
    // Wait for sequencer to process
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify balances
    const finalL1Balance = await token.balanceOf(user.address);
    const finalL2Balance = await l2Client.getTokenBalance(l2Recipient, token.address);
    
    expect(initialL1Balance.sub(finalL1Balance).eq(depositAmount)).to.be.true;
    expect(finalL2Balance.sub(initialL2Balance).eq(depositAmount)).to.be.true;
  });
  
  it('should reject invalid deposits', async function() {
    // Try to deposit 0 ETH
    const l2Recipient = new PublicKey("..."); // Test public key
    
    await expect(
      depositBridge.connect(user).deposit(l2Recipient.toBuffer(), { value: 0 })
    ).to.be.revertedWith("Deposit amount must be greater than 0");
    
    // Try to deposit to invalid recipient (zero address)
    const invalidRecipient = Buffer.alloc(32, 0);
    
    await expect(
      depositBridge.connect(user).deposit(invalidRecipient, { value: ethers.utils.parseEther("1.0") })
    ).to.be.revertedWith("Invalid recipient");
  });
});

// Mock L2Client class for testing
class L2Client {
  constructor(url) {
    this.url = url;
    this.balances = new Map();
    this.tokenBalances = new Map();
  }
  
  async getBalance(publicKey) {
    const key = publicKey.toString();
    return this.balances.get(key) || ethers.BigNumber.from(0);
  }
  
  async getTokenBalance(publicKey, tokenAddress) {
    const key = `${publicKey.toString()}-${tokenAddress}`;
    return this.tokenBalances.get(key) || ethers.BigNumber.from(0);
  }
  
  // Mock method to simulate waiting for deposit
  async waitForDeposit(txHash) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return true;
  }
}

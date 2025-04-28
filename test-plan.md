# Piano di Test per Layer-2 su Solana

Questo documento descrive il piano di test completo per il Layer-2 su Solana, coprendo test unitari, test di integrazione, test end-to-end e test di performance.

## Obiettivi

Gli obiettivi principali di questo piano di test sono:

1. Verificare la correttezza funzionale di tutti i componenti del sistema
2. Garantire l'interoperabilità tra i diversi moduli
3. Validare la sicurezza del sistema contro vari scenari di attacco
4. Misurare e ottimizzare le performance del sistema
5. Assicurare la stabilità del sistema sotto carico

## Strategia di Test

La strategia di test segue un approccio a più livelli:

1. **Test Unitari**: Testare singoli componenti in isolamento
2. **Test di Integrazione**: Testare l'interazione tra componenti correlati
3. **Test End-to-End**: Testare flussi completi attraverso l'intero sistema
4. **Test di Performance**: Misurare throughput, latenza e utilizzo delle risorse
5. **Test di Sicurezza**: Verificare la resistenza a vari attacchi

## Test Unitari

### Componenti Rust

Per i componenti Rust, utilizziamo il framework di test integrato di Rust.

#### Merkle Tree

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_merkle_tree_creation() {
        let leaves = vec![
            [1u8; 32],
            [2u8; 32],
            [3u8; 32],
            [4u8; 32],
        ];
        
        let tree = MerkleTree::new(&leaves);
        assert_eq!(tree.height(), 2);
        assert_eq!(tree.root().len(), 32);
    }
    
    #[test]
    fn test_merkle_proof_verification() {
        let leaves = vec![
            [1u8; 32],
            [2u8; 32],
            [3u8; 32],
            [4u8; 32],
        ];
        
        let tree = MerkleTree::new(&leaves);
        let proof = tree.generate_proof(1); // Proof for leaf [2u8; 32]
        
        assert!(tree.verify_proof(&leaves[1], &proof));
        assert!(!tree.verify_proof(&leaves[0], &proof));
    }
    
    #[test]
    fn test_empty_tree() {
        let leaves: Vec<[u8; 32]> = vec![];
        
        let tree = MerkleTree::new(&leaves);
        assert_eq!(tree.height(), 0);
        assert_eq!(tree.root(), [0u8; 32]);
    }
}
```

#### State Transition

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_valid_state_transition() {
        let initial_state = State::new();
        let tx = Transaction::new_transfer(
            &Keypair::new(),
            &Pubkey::new_unique(),
            100,
        );
        
        let result = apply_transaction(&initial_state, &tx);
        assert!(result.is_ok());
        
        let new_state = result.unwrap();
        assert_ne!(initial_state.root(), new_state.root());
    }
    
    #[test]
    fn test_invalid_state_transition() {
        let initial_state = State::new();
        let keypair = Keypair::new();
        
        // Create a transaction that tries to spend more than available
        let tx = Transaction::new_transfer(
            &keypair,
            &Pubkey::new_unique(),
            1000000, // More than available
        );
        
        let result = apply_transaction(&initial_state, &tx);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TransactionError::InsufficientFunds);
    }
}
```

#### Fraud Proof

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fraud_proof_generation() {
        let initial_state = State::new();
        
        // Create a valid transaction
        let keypair = Keypair::new();
        let recipient = Pubkey::new_unique();
        let tx = Transaction::new_transfer(&keypair, &recipient, 100);
        
        // Apply it correctly
        let correct_state = apply_transaction(&initial_state, &tx).unwrap();
        
        // Create an incorrect state transition
        let incorrect_state = State::with_root([0xFF; 32]);
        
        // Generate fraud proof
        let proof = generate_fraud_proof(
            &initial_state,
            &tx,
            &incorrect_state,
        );
        
        assert!(proof.is_valid());
        assert_eq!(proof.correct_state_root(), correct_state.root());
        assert_ne!(proof.claimed_state_root(), correct_state.root());
    }
    
    #[test]
    fn test_fraud_proof_verification() {
        let initial_state = State::new();
        
        // Create a valid transaction
        let keypair = Keypair::new();
        let recipient = Pubkey::new_unique();
        let tx = Transaction::new_transfer(&keypair, &recipient, 100);
        
        // Apply it correctly
        let correct_state = apply_transaction(&initial_state, &tx).unwrap();
        
        // Create an incorrect state transition
        let incorrect_state = State::with_root([0xFF; 32]);
        
        // Generate fraud proof
        let proof = generate_fraud_proof(
            &initial_state,
            &tx,
            &incorrect_state,
        );
        
        // Verify the proof
        assert!(verify_fraud_proof(&proof, &initial_state, &tx, &incorrect_state));
        
        // Verify with wrong inputs
        assert!(!verify_fraud_proof(&proof, &correct_state, &tx, &incorrect_state));
    }
}
```

### Contratti Solidity

Per i contratti Solidity, utilizziamo Hardhat con Chai e Waffle.

#### DisputeGame

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DisputeGame", function () {
  let disputeGame;
  let stateCommitmentChain;
  let owner;
  let challenger;
  let defender;
  
  beforeEach(async function () {
    [owner, challenger, defender] = await ethers.getSigners();
    
    const StateCommitmentChain = await ethers.getContractFactory("StateCommitmentChain");
    stateCommitmentChain = await StateCommitmentChain.deploy();
    await stateCommitmentChain.deployed();
    
    const DisputeGame = await ethers.getContractFactory("DisputeGame");
    disputeGame = await DisputeGame.deploy(stateCommitmentChain.address);
    await disputeGame.deployed();
    
    // Set up roles
    await disputeGame.setDefender(defender.address);
    
    // Register a block
    const blockNumber = 123;
    const prevStateRoot = ethers.utils.formatBytes32String("prevStateRoot");
    const stateRoot = ethers.utils.formatBytes32String("stateRoot");
    
    await stateCommitmentChain.appendStateBatch(
      [stateRoot],
      [blockNumber],
      prevStateRoot
    );
  });
  
  it("should initialize a challenge correctly", async function () {
    const blockNumber = 123;
    const prevStateRoot = ethers.utils.formatBytes32String("prevStateRoot");
    const claimedStateRoot = ethers.utils.formatBytes32String("stateRoot");
    const correctStateRoot = ethers.utils.formatBytes32String("correctStateRoot");
    const initialProof = ethers.utils.formatBytes32String("initialProof");
    
    await expect(
      disputeGame.connect(challenger).initiateChallenge(
        blockNumber,
        prevStateRoot,
        claimedStateRoot,
        correctStateRoot,
        initialProof,
        { value: ethers.utils.parseEther("1.0") }
      )
    )
      .to.emit(disputeGame, "ChallengeInitiated")
      .withArgs(1, blockNumber, challenger.address, defender.address);
    
    const challenge = await disputeGame.getChallenge(1);
    expect(challenge.blockNumber).to.equal(blockNumber);
    expect(challenge.challenger).to.equal(challenger.address);
    expect(challenge.defender).to.equal(defender.address);
    expect(challenge.status).to.equal(1); // In Progress
  });
  
  it("should handle bisection correctly", async function () {
    // Initialize a challenge
    const blockNumber = 123;
    const prevStateRoot = ethers.utils.formatBytes32String("prevStateRoot");
    const claimedStateRoot = ethers.utils.formatBytes32String("stateRoot");
    const correctStateRoot = ethers.utils.formatBytes32String("correctStateRoot");
    const initialProof = ethers.utils.formatBytes32String("initialProof");
    
    await disputeGame.connect(challenger).initiateChallenge(
      blockNumber,
      prevStateRoot,
      claimedStateRoot,
      correctStateRoot,
      initialProof,
      { value: ethers.utils.parseEther("1.0") }
    );
    
    // Respond with bisection
    const midIndex = 50;
    const midStateRoot = ethers.utils.formatBytes32String("midStateRoot");
    const bisectionProof = ethers.utils.formatBytes32String("bisectionProof");
    
    await expect(
      disputeGame.connect(defender).respondBisection(
        1, // Challenge ID
        midIndex,
        midStateRoot,
        bisectionProof
      )
    )
      .to.emit(disputeGame, "BisectionResponse")
      .withArgs(1, midIndex, midStateRoot);
    
    // Select bisection half
    await expect(
      disputeGame.connect(challenger).selectBisectionHalf(
        1, // Challenge ID
        0 // First half
      )
    )
      .to.emit(disputeGame, "BisectionHalfSelected")
      .withArgs(1, 0);
    
    const challenge = await disputeGame.getChallenge(1);
    expect(challenge.endIndex).to.equal(midIndex);
  });
  
  it("should resolve a challenge correctly", async function () {
    // Initialize a challenge
    const blockNumber = 123;
    const prevStateRoot = ethers.utils.formatBytes32String("prevStateRoot");
    const claimedStateRoot = ethers.utils.formatBytes32String("stateRoot");
    const correctStateRoot = ethers.utils.formatBytes32String("correctStateRoot");
    const initialProof = ethers.utils.formatBytes32String("initialProof");
    
    await disputeGame.connect(challenger).initiateChallenge(
      blockNumber,
      prevStateRoot,
      claimedStateRoot,
      correctStateRoot,
      initialProof,
      { value: ethers.utils.parseEther("1.0") }
    );
    
    // Respond with bisection to reduce to a single step
    const midIndex = 1;
    const midStateRoot = ethers.utils.formatBytes32String("midStateRoot");
    const bisectionProof = ethers.utils.formatBytes32String("bisectionProof");
    
    await disputeGame.connect(defender).respondBisection(
      1, // Challenge ID
      midIndex,
      midStateRoot,
      bisectionProof
    );
    
    await disputeGame.connect(challenger).selectBisectionHalf(
      1, // Challenge ID
      0 // First half
    );
    
    // Prove fraud
    const finalProof = ethers.utils.formatBytes32String("finalProof");
    
    await expect(
      disputeGame.connect(challenger).proveFraud(
        1, // Challenge ID
        finalProof
      )
    )
      .to.emit(disputeGame, "ChallengeResolved")
      .withArgs(1, 2); // 2 = Success
    
    const challenge = await disputeGame.getChallenge(1);
    expect(challenge.status).to.equal(2); // Success
    
    // Check that the block was invalidated
    const blockStatus = await stateCommitmentChain.getBlockStatus(blockNumber);
    expect(blockStatus).to.equal(4); // Invalidated
  });
});
```

#### L1ToL2DepositBridge

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("L1ToL2DepositBridge", function () {
  let depositBridge;
  let mockERC20;
  let owner;
  let user;
  
  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MTK");
    await mockERC20.deployed();
    
    // Mint some tokens to the user
    await mockERC20.mint(user.address, ethers.utils.parseEther("1000"));
    
    const L1ToL2DepositBridge = await ethers.getContractFactory("L1ToL2DepositBridge");
    depositBridge = await L1ToL2DepositBridge.deploy();
    await depositBridge.deployed();
  });
  
  it("should deposit ETH correctly", async function () {
    const l2Recipient = ethers.utils.randomBytes(32);
    const depositAmount = ethers.utils.parseEther("1.0");
    
    await expect(
      depositBridge.connect(user).deposit(l2Recipient, {
        value: depositAmount
      })
    )
      .to.emit(depositBridge, "DepositInitiated")
      .withArgs(
        user.address,
        ethers.constants.AddressZero, // ETH
        depositAmount,
        l2Recipient
      );
    
    // Check bridge balance
    expect(await ethers.provider.getBalance(depositBridge.address))
      .to.equal(depositAmount);
  });
  
  it("should deposit ERC20 correctly", async function () {
    const l2Recipient = ethers.utils.randomBytes(32);
    const depositAmount = ethers.utils.parseEther("10");
    
    // Approve tokens
    await mockERC20.connect(user).approve(depositBridge.address, depositAmount);
    
    await expect(
      depositBridge.connect(user).depositERC20(
        mockERC20.address,
        depositAmount,
        l2Recipient
      )
    )
      .to.emit(depositBridge, "DepositInitiated")
      .withArgs(
        user.address,
        mockERC20.address,
        depositAmount,
        l2Recipient
      );
    
    // Check bridge balance
    expect(await mockERC20.balanceOf(depositBridge.address))
      .to.equal(depositAmount);
    
    // Check user balance
    expect(await mockERC20.balanceOf(user.address))
      .to.equal(ethers.utils.parseEther("990"));
  });
  
  it("should fail when depositing more ERC20 than approved", async function () {
    const l2Recipient = ethers.utils.randomBytes(32);
    const depositAmount = ethers.utils.parseEther("10");
    
    // Approve less than deposit amount
    await mockERC20.connect(user).approve(depositBridge.address, depositAmount.div(2));
    
    await expect(
      depositBridge.connect(user).depositERC20(
        mockERC20.address,
        depositAmount,
        l2Recipient
      )
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
  });
  
  it("should fail when depositing more ERC20 than balance", async function () {
    const l2Recipient = ethers.utils.randomBytes(32);
    const depositAmount = ethers.utils.parseEther("2000"); // More than user has
    
    // Approve tokens
    await mockERC20.connect(user).approve(depositBridge.address, depositAmount);
    
    await expect(
      depositBridge.connect(user).depositERC20(
        mockERC20.address,
        depositAmount,
        l2Recipient
      )
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  });
});
```

## Test di Integrazione

I test di integrazione verificano l'interazione tra componenti correlati.

### Deposito e Prelievo

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { L2Client } = require("../sdk");
const { Keypair } = require("@solana/web3.js");

describe("Deposit and Withdrawal Flow", function () {
  let depositBridge;
  let withdrawalBridge;
  let stateCommitmentChain;
  let mockERC20;
  let owner;
  let user;
  let l2Client;
  let l2Keypair;
  
  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    
    // Deploy L1 contracts
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MTK");
    await mockERC20.deployed();
    
    const StateCommitmentChain = await ethers.getContractFactory("StateCommitmentChain");
    stateCommitmentChain = await StateCommitmentChain.deploy();
    await stateCommitmentChain.deployed();
    
    const L1ToL2DepositBridge = await ethers.getContractFactory("L1ToL2DepositBridge");
    depositBridge = await L1ToL2DepositBridge.deploy();
    await depositBridge.deployed();
    
    const L2ToL1WithdrawalBridge = await ethers.getContractFactory("L2ToL1WithdrawalBridge");
    withdrawalBridge = await L2ToL1WithdrawalBridge.deploy(stateCommitmentChain.address);
    await withdrawalBridge.deployed();
    
    // Mint some tokens to the user
    await mockERC20.mint(user.address, ethers.utils.parseEther("1000"));
    
    // Set up L2 client
    l2Client = new L2Client("http://localhost:8080");
    l2Keypair = Keypair.generate();
    
    // Fund the L2 account
    await l2Client.fundAccount(l2Keypair.publicKey, ethers.utils.parseEther("10"));
  });
  
  it("should complete a full deposit and withdrawal cycle for ETH", async function () {
    // Step 1: Deposit ETH from L1 to L2
    const depositAmount = ethers.utils.parseEther("1.0");
    const l2RecipientBuffer = Buffer.from(l2Keypair.publicKey.toBytes());
    
    await depositBridge.connect(user).deposit(l2RecipientBuffer, {
      value: depositAmount
    });
    
    // Wait for deposit to be processed on L2
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check L2 balance
    const l2Balance = await l2Client.getBalance(l2Keypair.publicKey);
    expect(l2Balance.toString()).to.equal(depositAmount.add(ethers.utils.parseEther("10")).toString());
    
    // Step 2: Initiate withdrawal from L2 to L1
    const withdrawalAmount = ethers.utils.parseEther("0.5");
    const withdrawalId = await l2Client.initiateWithdrawal(
      l2Keypair,
      user.address,
      withdrawalAmount
    );
    
    // Step 3: Submit state root to L1
    const blockNumber = await l2Client.getLatestBlockNumber();
    const stateRoot = await l2Client.getStateRoot(blockNumber);
    
    await stateCommitmentChain.appendStateBatch(
      [stateRoot],
      [blockNumber],
      ethers.utils.formatBytes32String("prevStateRoot")
    );
    
    // Step 4: Wait for challenge period
    // In test, we can reduce this to a few seconds
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine");
    
    // Step 5: Complete withdrawal on L1
    const withdrawalProof = await l2Client.generateWithdrawalProof(withdrawalId);
    
    const userBalanceBefore = await ethers.provider.getBalance(user.address);
    
    await withdrawalBridge.connect(user).completeWithdrawal(
      withdrawalId,
      withdrawalProof
    );
    
    const userBalanceAfter = await ethers.provider.getBalance(user.address);
    
    // Account for gas costs
    expect(userBalanceAfter.sub(userBalanceBefore))
      .to.be.closeTo(withdrawalAmount, ethers.utils.parseEther("0.01"));
  });
  
  it("should complete a full deposit and withdrawal cycle for ERC20", async function () {
    // Step 1: Deposit ERC20 from L1 to L2
    const depositAmount = ethers.utils.parseEther("10");
    const l2RecipientBuffer = Buffer.from(l2Keypair.publicKey.toBytes());
    
    // Approve tokens
    await mockERC20.connect(user).approve(depositBridge.address, depositAmount);
    
    await depositBridge.connect(user).depositERC20(
      mockERC20.address,
      depositAmount,
      l2RecipientBuffer
    );
    
    // Wait for deposit to be processed on L2
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check L2 token balance
    const l2TokenBalance = await l2Client.getTokenBalance(l2Keypair.publicKey, "MTK");
    expect(l2TokenBalance.toString()).to.equal(depositAmount.toString());
    
    // Step 2: Initiate token withdrawal from L2 to L1
    const withdrawalAmount = ethers.utils.parseEther("5");
    const withdrawalId = await l2Client.initiateTokenWithdrawal(
      l2Keypair,
      user.address,
      "MTK",
      withdrawalAmount
    );
    
    // Step 3: Submit state root to L1
    const blockNumber = await l2Client.getLatestBlockNumber();
    const stateRoot = await l2Client.getStateRoot(blockNumber);
    
    await stateCommitmentChain.appendStateBatch(
      [stateRoot],
      [blockNumber],
      ethers.utils.formatBytes32String("prevStateRoot")
    );
    
    // Step 4: Wait for challenge period
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine");
    
    // Step 5: Complete withdrawal on L1
    const withdrawalProof = await l2Client.generateWithdrawalProof(withdrawalId);
    
    const userTokenBalanceBefore = await mockERC20.balanceOf(user.address);
    
    await withdrawalBridge.connect(user).completeWithdrawal(
      withdrawalId,
      withdrawalProof
    );
    
    const userTokenBalanceAfter = await mockERC20.balanceOf(user.address);
    
    expect(userTokenBalanceAfter.sub(userTokenBalanceBefore))
      .to.equal(withdrawalAmount);
  });
});
```

### Sfida e Finalizzazione

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { L2Client, L2TestClient } = require("../sdk");
const { FraudProofGenerator } = require("../sdk/fraud-proof");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");

describe("Challenge and Finalization Flow", function () {
  let disputeGame;
  let stateCommitmentChain;
  let l2OutputOracle;
  let owner;
  let sequencer;
  let validator;
  let l2Client;
  let l2TestClient;
  let fraudProofGenerator;
  
  beforeEach(async function () {
    [owner, sequencer, validator] = await ethers.getSigners();
    
    // Deploy L1 contracts
    const StateCommitmentChain = await ethers.getContractFactory("StateCommitmentChain");
    stateCommitmentChain = await StateCommitmentChain.deploy();
    await stateCommitmentChain.deployed();
    
    const L2OutputOracle = await ethers.getContractFactory("L2OutputOracle");
    l2OutputOracle = await L2OutputOracle.deploy(stateCommitmentChain.address);
    await l2OutputOracle.deployed();
    
    const DisputeGame = await ethers.getContractFactory("DisputeGame");
    disputeGame = await DisputeGame.deploy(stateCommitmentChain.address);
    await disputeGame.deployed();
    
    // Set up roles
    await stateCommitmentChain.setSequencer(sequencer.address);
    await disputeGame.setDefender(sequencer.address);
    
    // Set up L2 clients
    l2Client = new L2Client("http://localhost:8080");
    l2TestClient = new L2TestClient("http://localhost:8080");
    
    // Set up fraud proof generator
    fraudProofGenerator = new FraudProofGenerator(l2Client);
  });
  
  it("should finalize a valid block after challenge period", async function () {
    // Step 1: Create a valid block
    const sender = Keypair.generate();
    const recipient = Keypair.generate();
    
    // Fund the sender
    await l2Client.fundAccount(sender.publicKey, ethers.utils.parseEther("10"));
    
    // Create a valid transaction
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: ethers.utils.parseEther("1").toNumber(),
      })
    );
    
    const signature = await l2Client.sendTransaction(tx, sender);
    await l2Client.confirmTransaction(signature);
    
    // Step 2: Get the block and state root
    const blockNumber = await l2Client.getLatestBlockNumber();
    const stateRoot = await l2Client.getStateRoot(blockNumber);
    const prevStateRoot = await l2Client.getStateRoot(blockNumber - 1);
    
    // Step 3: Submit state root to L1
    await stateCommitmentChain.connect(sequencer).appendStateBatch(
      [stateRoot],
      [blockNumber],
      prevStateRoot
    );
    
    // Step 4: Wait for challenge period
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine");
    
    // Step 5: Check finalization status
    const blockStatus = await stateCommitmentChain.getBlockStatus(blockNumber);
    expect(blockStatus).to.equal(3); // Finalized
    
    // Step 6: Verify L2 output oracle
    const latestBlockNumber = await l2OutputOracle.getLatestBlockNumber();
    expect(latestBlockNumber).to.equal(blockNumber);
    
    const l2Output = await l2OutputOracle.getL2Output(blockNumber);
    expect(l2Output).to.equal(stateRoot);
  });
  
  it("should successfully challenge an invalid block", async function () {
    // Step 1: Create an invalid block
    const sender = Keypair.generate();
    const recipient = Keypair.generate();
    
    // Fund the sender with less than will be sent
    await l2Client.fundAccount(sender.publicKey, ethers.utils.parseEther("0.5"));
    
    // Create an invalid transaction (sending more than balance)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: ethers.utils.parseEther("1").toNumber(),
      })
    );
    
    // Bypass validation and force inclusion
    const signature = await l2TestClient.sendInvalidTransaction(tx, sender);
    
    // Step 2: Get the block and state root
    const blockNumber = await l2Client.getLatestBlockNumber();
    const invalidStateRoot = await l2TestClient.getStateRoot(blockNumber);
    const prevStateRoot = await l2Client.getStateRoot(blockNumber - 1);
    
    // Step 3: Submit invalid state root to L1
    await stateCommitmentChain.connect(sequencer).appendStateBatch(
      [invalidStateRoot],
      [blockNumber],
      prevStateRoot
    );
    
    // Step 4: Generate correct state root
    const correctStateRoot = await fraudProofGenerator.computeCorrectStateRoot(
      blockNumber,
      prevStateRoot
    );
    
    // Step 5: Generate initial proof
    const initialProof = await fraudProofGenerator.generateInitialProof(
      blockNumber,
      prevStateRoot,
      invalidStateRoot,
      correctStateRoot
    );
    
    // Step 6: Initiate challenge
    await disputeGame.connect(validator).initiateChallenge(
      blockNumber,
      prevStateRoot,
      invalidStateRoot,
      correctStateRoot,
      initialProof,
      { value: ethers.utils.parseEther("1.0") }
    );
    
    // Step 7: Play bisection game
    // For simplicity, we'll simulate a single round
    const midIndex = 1; // Assuming only one transaction
    const midStateRoot = await fraudProofGenerator.computeIntermediateStateRoot(
      blockNumber,
      prevStateRoot,
      0,
      midIndex
    );
    
    const bisectionProof = await fraudProofGenerator.generateBisectionProof(
      1, // Challenge ID
      blockNumber,
      0,
      midIndex,
      2 // Assuming 2 steps total
    );
    
    await disputeGame.connect(sequencer).respondBisection(
      1, // Challenge ID
      midIndex,
      midStateRoot,
      bisectionProof.proof
    );
    
    await disputeGame.connect(validator).selectBisectionHalf(
      1, // Challenge ID
      0 // First half
    );
    
    // Step 8: Prove fraud
    const finalProof = await fraudProofGenerator.generateFinalProof(
      1, // Challenge ID
      blockNumber,
      0 // Transaction index
    );
    
    await disputeGame.connect(validator).proveFraud(
      1, // Challenge ID
      finalProof
    );
    
    // Step 9: Verify block was invalidated
    const blockStatus = await stateCommitmentChain.getBlockStatus(blockNumber);
    expect(blockStatus).to.equal(4); // Invalidated
    
    // Step 10: Verify L2 output oracle
    const latestBlockNumber = await l2OutputOracle.getLatestBlockNumber();
    expect(latestBlockNumber).to.equal(blockNumber - 1);
  });
});
```

## Test End-to-End

I test end-to-end verificano flussi completi attraverso l'intero sistema.

### Deposito, Transazione, Prelievo

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { L2Client } = require("../sdk");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");

describe("End-to-End Flow", function () {
  let depositBridge;
  let withdrawalBridge;
  let stateCommitmentChain;
  let mockERC20;
  let owner;
  let user;
  let l2Client;
  let l2Keypair;
  
  before(async function () {
    // This test requires a running local testnet
    // Check if the testnet is running
    l2Client = new L2Client("http://localhost:8080");
    try {
      await l2Client.getStatus();
    } catch (error) {
      console.error("Local testnet not running. Please start it before running this test.");
      process.exit(1);
    }
    
    [owner, user] = await ethers.getSigners();
    
    // Deploy L1 contracts
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MTK");
    await mockERC20.deployed();
    
    const StateCommitmentChain = await ethers.getContractFactory("StateCommitmentChain");
    stateCommitmentChain = await StateCommitmentChain.deploy();
    await stateCommitmentChain.deployed();
    
    const L1ToL2DepositBridge = await ethers.getContractFactory("L1ToL2DepositBridge");
    depositBridge = await L1ToL2DepositBridge.deploy();
    await depositBridge.deployed();
    
    const L2ToL1WithdrawalBridge = await ethers.getContractFactory("L2ToL1WithdrawalBridge");
    withdrawalBridge = await L2ToL1WithdrawalBridge.deploy(stateCommitmentChain.address);
    await withdrawalBridge.deployed();
    
    // Mint some tokens to the user
    await mockERC20.mint(user.address, ethers.utils.parseEther("1000"));
    
    // Generate L2 keypair
    l2Keypair = Keypair.generate();
  });
  
  it("should complete a full end-to-end flow", async function () {
    this.timeout(60000); // 60 seconds
    
    // Step 1: Deposit ETH from L1 to L2
    console.log("Step 1: Depositing ETH from L1 to L2");
    const depositAmount = ethers.utils.parseEther("1.0");
    const l2RecipientBuffer = Buffer.from(l2Keypair.publicKey.toBytes());
    
    await depositBridge.connect(user).deposit(l2RecipientBuffer, {
      value: depositAmount
    });
    
    // Wait for deposit to be processed on L2
    console.log("Waiting for deposit to be processed on L2...");
    let l2Balance;
    let attempts = 0;
    while (attempts < 30) {
      try {
        l2Balance = await l2Client.getBalance(l2Keypair.publicKey);
        if (l2Balance.gt(0)) break;
      } catch (error) {
        console.log("Waiting for L2 balance...");
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    expect(l2Balance.toString()).to.equal(depositAmount.toString());
    console.log("Deposit confirmed on L2");
    
    // Step 2: Execute a transaction on L2
    console.log("Step 2: Executing a transaction on L2");
    const recipient = Keypair.generate();
    const transferAmount = ethers.utils.parseEther("0.3");
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: l2Keypair.publicKey,
        toPubkey: recipient.publicKey,
        lamports: transferAmount.toNumber(),
      })
    );
    
    const signature = await l2Client.sendTransaction(tx, l2Keypair);
    await l2Client.confirmTransaction(signature);
    
    // Verify transaction
    const recipientBalance = await l2Client.getBalance(recipient.publicKey);
    expect(recipientBalance.toString()).to.equal(transferAmount.toString());
    
    const newSenderBalance = await l2Client.getBalance(l2Keypair.publicKey);
    expect(newSenderBalance.toString()).to.equal(
      depositAmount.sub(transferAmount).toString()
    );
    
    console.log("Transaction confirmed on L2");
    
    // Step 3: Initiate withdrawal from L2 to L1
    console.log("Step 3: Initiating withdrawal from L2 to L1");
    const withdrawalAmount = ethers.utils.parseEther("0.5");
    const withdrawalId = await l2Client.initiateWithdrawal(
      l2Keypair,
      user.address,
      withdrawalAmount
    );
    
    console.log("Withdrawal initiated with ID:", withdrawalId);
    
    // Step 4: Submit state root to L1
    console.log("Step 4: Submitting state root to L1");
    const blockNumber = await l2Client.getLatestBlockNumber();
    const stateRoot = await l2Client.getStateRoot(blockNumber);
    const prevStateRoot = await l2Client.getStateRoot(blockNumber - 1);
    
    await stateCommitmentChain.appendStateBatch(
      [stateRoot],
      [blockNumber],
      prevStateRoot
    );
    
    // Step 5: Wait for challenge period
    console.log("Step 5: Waiting for challenge period (simulated)");
    // In test, we can reduce this to a few seconds
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine");
    
    // Step 6: Complete withdrawal on L1
    console.log("Step 6: Completing withdrawal on L1");
    const withdrawalProof = await l2Client.generateWithdrawalProof(withdrawalId);
    
    const userBalanceBefore = await ethers.provider.getBalance(user.address);
    
    await withdrawalBridge.connect(user).completeWithdrawal(
      withdrawalId,
      withdrawalProof
    );
    
    const userBalanceAfter = await ethers.provider.getBalance(user.address);
    
    // Account for gas costs
    expect(userBalanceAfter.sub(userBalanceBefore))
      .to.be.closeTo(withdrawalAmount, ethers.utils.parseEther("0.01"));
    
    console.log("Withdrawal completed on L1");
    
    // Step 7: Verify final L2 balance
    console.log("Step 7: Verifying final L2 balance");
    const finalL2Balance = await l2Client.getBalance(l2Keypair.publicKey);
    expect(finalL2Balance.toString()).to.equal(
      depositAmount.sub(transferAmount).sub(withdrawalAmount).toString()
    );
    
    console.log("End-to-end flow completed successfully");
  });
});
```

## Test di Performance

I test di performance misurano throughput, latenza e utilizzo delle risorse.

### Benchmark di Throughput

```javascript
const { L2Client } = require("../sdk");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");
const fs = require("fs");

async function runThroughputBenchmark() {
  const l2Client = new L2Client("http://localhost:8080");
  
  // Parameters
  const numTransactions = 1000;
  const batchSize = 100;
  const transferAmount = 1000000; // 0.001 SOL in lamports
  
  // Create keypairs
  console.log("Generating keypairs...");
  const senders = Array(10).fill(0).map(() => Keypair.generate());
  const recipients = Array(10).fill(0).map(() => Keypair.generate());
  
  // Fund senders
  console.log("Funding sender accounts...");
  for (const sender of senders) {
    await l2Client.fundAccount(sender.publicKey, 1000000000); // 1 SOL
  }
  
  // Prepare transactions
  console.log("Preparing transactions...");
  const transactions = [];
  
  for (let i = 0; i < numTransactions; i++) {
    const sender = senders[i % senders.length];
    const recipient = recipients[i % recipients.length];
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: transferAmount,
      })
    );
    
    transactions.push({
      tx,
      sender
    });
  }
  
  // Run benchmark
  console.log(`Starting throughput benchmark with ${numTransactions} transactions...`);
  const results = {
    totalTransactions: numTransactions,
    batchSize,
    startTime: Date.now(),
    endTime: 0,
    duration: 0,
    tps: 0,
    batches: []
  };
  
  for (let i = 0; i < numTransactions; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);
    const batchResult = {
      batchNumber: i / batchSize + 1,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      signatures: []
    };
    
    console.log(`Sending batch ${batchResult.batchNumber}/${Math.ceil(numTransactions / batchSize)}...`);
    
    // Send transactions in parallel
    const promises = batch.map(async ({ tx, sender }) => {
      try {
        const signature = await l2Client.sendTransaction(tx, sender);
        return signature;
      } catch (error) {
        console.error("Error sending transaction:", error.message);
        return null;
      }
    });
    
    const signatures = await Promise.all(promises);
    batchResult.signatures = signatures.filter(Boolean);
    
    // Wait for confirmations
    console.log(`Waiting for confirmations...`);
    const confirmPromises = batchResult.signatures.map(signature => 
      l2Client.confirmTransaction(signature).catch(() => false)
    );
    
    await Promise.all(confirmPromises);
    
    batchResult.endTime = Date.now();
    batchResult.duration = batchResult.endTime - batchResult.startTime;
    
    results.batches.push(batchResult);
    
    console.log(`Batch ${batchResult.batchNumber} completed in ${batchResult.duration}ms`);
  }
  
  // Calculate results
  results.endTime = Date.now();
  results.duration = results.endTime - results.startTime;
  results.tps = (numTransactions * 1000) / results.duration;
  
  console.log("\nBenchmark Results:");
  console.log(`Total Transactions: ${results.totalTransactions}`);
  console.log(`Total Duration: ${results.duration}ms`);
  console.log(`Transactions Per Second (TPS): ${results.tps.toFixed(2)}`);
  
  // Save results to file
  fs.writeFileSync(
    `throughput_benchmark_${new Date().toISOString().replace(/:/g, '-')}.json`,
    JSON.stringify(results, null, 2)
  );
  
  return results;
}

// Run the benchmark
runThroughputBenchmark().catch(console.error);
```

### Benchmark di Latenza

```javascript
const { L2Client } = require("../sdk");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");
const fs = require("fs");

async function runLatencyBenchmark() {
  const l2Client = new L2Client("http://localhost:8080");
  
  // Parameters
  const numTransactions = 100;
  const transferAmount = 1000000; // 0.001 SOL in lamports
  
  // Create keypairs
  console.log("Generating keypairs...");
  const sender = Keypair.generate();
  const recipient = Keypair.generate();
  
  // Fund sender
  console.log("Funding sender account...");
  await l2Client.fundAccount(sender.publicKey, 1000000000); // 1 SOL
  
  // Run benchmark
  console.log(`Starting latency benchmark with ${numTransactions} transactions...`);
  const results = {
    totalTransactions: numTransactions,
    transactions: []
  };
  
  for (let i = 0; i < numTransactions; i++) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: transferAmount,
      })
    );
    
    const txResult = {
      transactionNumber: i + 1,
      sendStartTime: Date.now(),
      sendEndTime: 0,
      sendLatency: 0,
      confirmStartTime: 0,
      confirmEndTime: 0,
      confirmLatency: 0,
      totalLatency: 0,
      signature: null
    };
    
    try {
      // Send transaction
      txResult.signature = await l2Client.sendTransaction(tx, sender);
      txResult.sendEndTime = Date.now();
      txResult.sendLatency = txResult.sendEndTime - txResult.sendStartTime;
      
      // Confirm transaction
      txResult.confirmStartTime = Date.now();
      await l2Client.confirmTransaction(txResult.signature);
      txResult.confirmEndTime = Date.now();
      txResult.confirmLatency = txResult.confirmEndTime - txResult.confirmStartTime;
      
      txResult.totalLatency = txResult.sendLatency + txResult.confirmLatency;
      
      console.log(`Transaction ${txResult.transactionNumber}: Total Latency = ${txResult.totalLatency}ms (Send: ${txResult.sendLatency}ms, Confirm: ${txResult.confirmLatency}ms)`);
    } catch (error) {
      console.error(`Error in transaction ${txResult.transactionNumber}:`, error.message);
      txResult.error = error.message;
    }
    
    results.transactions.push(txResult);
    
    // Small delay between transactions
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Calculate statistics
  const successfulTxs = results.transactions.filter(tx => !tx.error);
  
  const stats = {
    totalTransactions: numTransactions,
    successfulTransactions: successfulTxs.length,
    failedTransactions: numTransactions - successfulTxs.length,
    sendLatency: {
      min: Math.min(...successfulTxs.map(tx => tx.sendLatency)),
      max: Math.max(...successfulTxs.map(tx => tx.sendLatency)),
      avg: successfulTxs.reduce((sum, tx) => sum + tx.sendLatency, 0) / successfulTxs.length
    },
    confirmLatency: {
      min: Math.min(...successfulTxs.map(tx => tx.confirmLatency)),
      max: Math.max(...successfulTxs.map(tx => tx.confirmLatency)),
      avg: successfulTxs.reduce((sum, tx) => sum + tx.confirmLatency, 0) / successfulTxs.length
    },
    totalLatency: {
      min: Math.min(...successfulTxs.map(tx => tx.totalLatency)),
      max: Math.max(...successfulTxs.map(tx => tx.totalLatency)),
      avg: successfulTxs.reduce((sum, tx) => sum + tx.totalLatency, 0) / successfulTxs.length
    }
  };
  
  results.stats = stats;
  
  console.log("\nLatency Benchmark Results:");
  console.log(`Successful Transactions: ${stats.successfulTransactions}/${numTransactions}`);
  console.log(`Send Latency: Min=${stats.sendLatency.min}ms, Max=${stats.sendLatency.max}ms, Avg=${stats.sendLatency.avg.toFixed(2)}ms`);
  console.log(`Confirm Latency: Min=${stats.confirmLatency.min}ms, Max=${stats.confirmLatency.max}ms, Avg=${stats.confirmLatency.avg.toFixed(2)}ms`);
  console.log(`Total Latency: Min=${stats.totalLatency.min}ms, Max=${stats.totalLatency.max}ms, Avg=${stats.totalLatency.avg.toFixed(2)}ms`);
  
  // Save results to file
  fs.writeFileSync(
    `latency_benchmark_${new Date().toISOString().replace(/:/g, '-')}.json`,
    JSON.stringify(results, null, 2)
  );
  
  return results;
}

// Run the benchmark
runLatencyBenchmark().catch(console.error);
```

### Test di Stress

```javascript
const { L2Client } = require("../sdk");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");

async function runStressTest() {
  const l2Client = new L2Client("http://localhost:8080");
  
  // Parameters
  const duration = 5 * 60 * 1000; // 5 minutes
  const maxConcurrentTransactions = 100;
  const transferAmount = 1000000; // 0.001 SOL in lamports
  
  // Create keypairs
  console.log("Generating keypairs...");
  const numKeypairs = 20;
  const senders = Array(numKeypairs).fill(0).map(() => Keypair.generate());
  const recipients = Array(numKeypairs).fill(0).map(() => Keypair.generate());
  
  // Fund senders
  console.log("Funding sender accounts...");
  for (const sender of senders) {
    await l2Client.fundAccount(sender.publicKey, 10000000000); // 10 SOL
  }
  
  // Run stress test
  console.log(`Starting stress test for ${duration / 60000} minutes...`);
  const results = {
    startTime: Date.now(),
    endTime: 0,
    duration: 0,
    totalTransactions: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
    tps: 0,
    systemMetrics: []
  };
  
  // Start system metrics collection
  const metricsInterval = setInterval(() => {
    const metrics = {
      timestamp: Date.now(),
      cpu: os.loadavg(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      }
    };
    
    results.systemMetrics.push(metrics);
  }, 5000);
  
  // Function to send a single transaction
  async function sendTransaction() {
    const senderIndex = Math.floor(Math.random() * senders.length);
    const recipientIndex = Math.floor(Math.random() * recipients.length);
    
    const sender = senders[senderIndex];
    const recipient = recipients[recipientIndex];
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: transferAmount,
      })
    );
    
    try {
      const signature = await l2Client.sendTransaction(tx, sender);
      await l2Client.confirmTransaction(signature);
      results.successfulTransactions++;
      return true;
    } catch (error) {
      results.failedTransactions++;
      return false;
    } finally {
      results.totalTransactions++;
    }
  }
  
  // Start sending transactions
  const endTime = Date.now() + duration;
  const inFlightTransactions = new Set();
  
  while (Date.now() < endTime) {
    // Maintain maxConcurrentTransactions in flight
    while (inFlightTransactions.size < maxConcurrentTransactions && Date.now() < endTime) {
      const promise = sendTransaction().finally(() => {
        inFlightTransactions.delete(promise);
      });
      
      inFlightTransactions.add(promise);
    }
    
    // Wait for some transactions to complete
    if (inFlightTransactions.size >= maxConcurrentTransactions) {
      await Promise.race(inFlightTransactions);
    }
    
    // Log progress every 10 seconds
    if (results.totalTransactions % 1000 === 0) {
      const elapsedTime = Date.now() - results.startTime;
      const currentTps = results.totalTransactions / (elapsedTime / 1000);
      console.log(`Transactions: ${results.totalTransactions}, TPS: ${currentTps.toFixed(2)}, Success Rate: ${(results.successfulTransactions / results.totalTransactions * 100).toFixed(2)}%`);
    }
  }
  
  // Wait for remaining transactions to complete
  if (inFlightTransactions.size > 0) {
    console.log(`Waiting for ${inFlightTransactions.size} in-flight transactions to complete...`);
    await Promise.all(inFlightTransactions);
  }
  
  // Stop metrics collection
  clearInterval(metricsInterval);
  
  // Calculate results
  results.endTime = Date.now();
  results.duration = results.endTime - results.startTime;
  results.tps = (results.totalTransactions * 1000) / results.duration;
  
  console.log("\nStress Test Results:");
  console.log(`Duration: ${results.duration / 1000} seconds`);
  console.log(`Total Transactions: ${results.totalTransactions}`);
  console.log(`Successful Transactions: ${results.successfulTransactions}`);
  console.log(`Failed Transactions: ${results.failedTransactions}`);
  console.log(`Success Rate: ${(results.successfulTransactions / results.totalTransactions * 100).toFixed(2)}%`);
  console.log(`Transactions Per Second (TPS): ${results.tps.toFixed(2)}`);
  
  // Save results to file
  fs.writeFileSync(
    `stress_test_${new Date().toISOString().replace(/:/g, '-')}.json`,
    JSON.stringify(results, null, 2)
  );
  
  return results;
}

// Run the stress test
runStressTest().catch(console.error);
```

## Test di Sicurezza

I test di sicurezza verificano la resistenza a vari attacchi.

### Test di Double Spend

```javascript
const { expect } = require("chai");
const { L2Client, L2TestClient } = require("../sdk");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");
const { ethers } = require("hardhat");

describe("Double Spend Attack", function () {
  let l2Client;
  let l2TestClient;
  let sender;
  let recipient1;
  let recipient2;
  
  before(async function () {
    // This test requires a running local testnet
    l2Client = new L2Client("http://localhost:8080");
    l2TestClient = new L2TestClient("http://localhost:8080");
    
    // Create keypairs
    sender = Keypair.generate();
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();
    
    // Fund sender
    await l2Client.fundAccount(sender.publicKey, ethers.utils.parseEther("1"));
  });
  
  it("should prevent double spend attacks", async function () {
    this.timeout(30000);
    
    // Get initial balance
    const initialBalance = await l2Client.getBalance(sender.publicKey);
    console.log("Initial balance:", ethers.utils.formatEther(initialBalance));
    
    // Create two transactions spending the same funds
    const amount = initialBalance;
    
    const tx1 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient1.publicKey,
        lamports: amount.toNumber(),
      })
    );
    
    const tx2 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient2.publicKey,
        lamports: amount.toNumber(),
      })
    );
    
    // Send first transaction normally
    console.log("Sending first transaction...");
    const signature1 = await l2Client.sendTransaction(tx1, sender);
    await l2Client.confirmTransaction(signature1);
    
    // Verify first transaction succeeded
    const recipient1Balance = await l2Client.getBalance(recipient1.publicKey);
    expect(recipient1Balance.toString()).to.equal(amount.toString());
    
    const senderBalanceAfterTx1 = await l2Client.getBalance(sender.publicKey);
    expect(senderBalanceAfterTx1.toString()).to.equal("0");
    
    // Try to send second transaction (should fail)
    console.log("Attempting double spend...");
    try {
      await l2Client.sendTransaction(tx2, sender);
      // If we get here, the test failed
      expect.fail("Double spend was not prevented");
    } catch (error) {
      // Expected error
      expect(error.message).to.include("insufficient funds");
    }
    
    // Try to bypass validation using test client
    console.log("Attempting to bypass validation...");
    try {
      const signature2 = await l2TestClient.sendInvalidTransaction(tx2, sender);
      
      // Wait for transaction to be processed
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if transaction was included
      const txInfo = await l2TestClient.getTransaction(signature2);
      
      if (txInfo && txInfo.confirmationStatus === "confirmed") {
        // If transaction was confirmed, check if it was actually executed
        const recipient2Balance = await l2Client.getBalance(recipient2.publicKey);
        
        // If balance is zero, the transaction was included but not executed (good)
        expect(recipient2Balance.toString()).to.equal("0");
      }
    } catch (error) {
      // Also acceptable if transaction is rejected entirely
      console.log("Transaction rejected:", error.message);
    }
    
    // Final verification
    const finalRecipient1Balance = await l2Client.getBalance(recipient1.publicKey);
    const finalRecipient2Balance = await l2Client.getBalance(recipient2.publicKey);
    const finalSenderBalance = await l2Client.getBalance(sender.publicKey);
    
    expect(finalRecipient1Balance.toString()).to.equal(amount.toString());
    expect(finalRecipient2Balance.toString()).to.equal("0");
    expect(finalSenderBalance.toString()).to.equal("0");
    
    console.log("Double spend prevention verified");
  });
});
```

### Test di Censorship Resistance

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { L2Client } = require("../sdk");
const { Keypair, Transaction, SystemProgram } = require("@solana/web3.js");

describe("Censorship Resistance", function () {
  let stateCommitmentChain;
  let forceInclusionContract;
  let owner;
  let user;
  let sequencer;
  let l2Client;
  let userL2Keypair;
  
  before(async function () {
    [owner, user, sequencer] = await ethers.getSigners();
    
    // Deploy L1 contracts
    const StateCommitmentChain = await ethers.getContractFactory("StateCommitmentChain");
    stateCommitmentChain = await StateCommitmentChain.deploy();
    await stateCommitmentChain.deployed();
    
    const ForceInclusion = await ethers.getContractFactory("ForceInclusion");
    forceInclusionContract = await ForceInclusion.deploy(stateCommitmentChain.address);
    await forceInclusionContract.deployed();
    
    // Set up roles
    await stateCommitmentChain.setSequencer(sequencer.address);
    
    // Set up L2 client
    l2Client = new L2Client("http://localhost:8080");
    
    // Create L2 keypair
    userL2Keypair = Keypair.generate();
    
    // Fund L2 account
    await l2Client.fundAccount(userL2Keypair.publicKey, ethers.utils.parseEther("1"));
  });
  
  it("should allow force-inclusion of censored transactions", async function () {
    this.timeout(60000);
    
    // Step 1: Create a transaction
    const recipient = Keypair.generate();
    const amount = ethers.utils.parseEther("0.1");
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userL2Keypair.publicKey,
        toPubkey: recipient.publicKey,
        lamports: amount.toNumber(),
      })
    );
    
    // Step 2: Sign the transaction
    const serializedTx = tx.serializeMessage();
    const signature = userL2Keypair.secretKey.slice(0, 64);
    const signedTx = {
      message: Buffer.from(serializedTx).toString("hex"),
      signature: Buffer.from(signature).toString("hex")
    };
    
    // Step 3: Submit transaction for force inclusion
    console.log("Submitting transaction for force inclusion...");
    await forceInclusionContract.connect(user).submitTransaction(
      signedTx.message,
      signedTx.signature,
      { value: ethers.utils.parseEther("0.01") } // Fee
    );
    
    // Step 4: Wait for the transaction to be included
    console.log("Waiting for transaction to be included...");
    
    // In a real scenario, we would wait for the sequencer to include the transaction
    // For testing, we'll simulate this by waiting and then checking the recipient's balance
    
    let recipientBalance;
    let attempts = 0;
    while (attempts < 30) {
      try {
        recipientBalance = await l2Client.getBalance(recipient.publicKey);
        if (recipientBalance.gt(0)) break;
      } catch (error) {
        console.log("Waiting for transaction to be included...");
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    // Step 5: Verify the transaction was included
    expect(recipientBalance.toString()).to.equal(amount.toString());
    
    console.log("Force inclusion verified");
  });
});
```

## Automazione CI/CD

### GitHub Actions Workflow

```yaml
name: Layer-2 on Solana CI/CD

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Set up Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'
    
    - name: Set up Rust
      uses: actions-rs/toolchain@v1
      with:
        toolchain: stable
        override: true
    
    - name: Install Solana CLI
      run: |
        sh -c "$(curl -sSfL https://release.solana.com/v1.10.0/install)"
        echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH
    
    - name: Install dependencies
      run: |
        npm install
        cd ethereum
        npm install
        cd ..
    
    - name: Build Rust components
      run: cargo build --release
    
    - name: Compile Solidity contracts
      run: |
        cd ethereum
        npx hardhat compile
        cd ..
    
    - name: Run Rust tests
      run: cargo test --release
    
    - name: Run Solidity tests
      run: |
        cd ethereum
        npx hardhat test
        cd ..
    
    - name: Start local testnet
      run: |
        ./scripts/setup-local-testnet.sh &
        sleep 30
    
    - name: Run integration tests
      run: |
        cd integration
        npm test
        cd ..
    
    - name: Run E2E tests
      run: |
        cd e2e
        npm test
        cd ..
    
    - name: Run performance tests
      run: |
        cd performance
        npm test
        cd ..
    
    - name: Generate coverage report
      run: |
        cargo tarpaulin --out Xml
        cd ethereum
        npx hardhat coverage
        cd ..
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v2
      with:
        files: ./coverage.xml,./ethereum/coverage.json
    
    - name: Build documentation
      run: |
        cargo doc --no-deps
        cd docs
        npm install
        npm run build
        cd ..
    
    - name: Deploy documentation
      if: github.ref == 'refs/heads/main'
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./docs/build
```

## Conclusione

Questo piano di test completo copre tutti gli aspetti del Layer-2 su Solana, garantendo che il sistema sia corretto, sicuro, performante e stabile. I test sono organizzati in livelli, dal più granulare (test unitari) al più completo (test end-to-end), e includono test di performance e sicurezza.

L'implementazione di questi test garantirà che il sistema soddisfi i requisiti funzionali e non funzionali, e che sia pronto per la produzione.

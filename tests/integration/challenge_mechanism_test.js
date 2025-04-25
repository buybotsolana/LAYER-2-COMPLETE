// src/integration/challenge_mechanism_test.js
const { ethers } = require('ethers');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { expect } = require('chai');

describe('Challenge Mechanism Integration Test', function() {
  let ethProvider;
  let solConnection;
  let disputeGame;
  let stateCommitmentChain;
  let l2Client;
  let sequencer;
  let challenger;
  
  before(async function() {
    // Setup connections
    ethProvider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
    solConnection = new Connection("http://localhost:8899", "confirmed");
    l2Client = new L2Client("http://localhost:3000");
    
    // Deploy contracts
    const DisputeGame = await ethers.getContractFactory("DisputeGame");
    const StateCommitmentChain = await ethers.getContractFactory("StateCommitmentChain");
    
    [sequencer, challenger] = await ethers.getSigners();
    
    disputeGame = await DisputeGame.deploy();
    await disputeGame.deployed();
    
    stateCommitmentChain = await StateCommitmentChain.deploy(disputeGame.address);
    await stateCommitmentChain.deployed();
    
    // Configure dispute game
    await disputeGame.setStateCommitmentChain(stateCommitmentChain.address);
  });
  
  it('should detect and challenge an invalid state transition', async function() {
    // Create valid state roots
    const preStateRoot = ethers.utils.hexZeroPad("0x01", 32);
    const validPostStateRoot = ethers.utils.hexZeroPad("0x02", 32);
    
    // Create an invalid state root
    const invalidPostStateRoot = ethers.utils.hexZeroPad("0x03", 32);
    
    // Sequencer submits an invalid state transition
    await stateCommitmentChain.connect(sequencer).appendStateBatch(
      [invalidPostStateRoot],
      [100] // Block numbers
    );
    
    // Initial status
    const initialStatus = await stateCommitmentChain.getStateRootStatus(invalidPostStateRoot);
    expect(initialStatus).to.equal(1); // 1 = Submitted
    
    // Challenger initiates a dispute
    await disputeGame.connect(challenger).initiateChallenge(
      preStateRoot,
      invalidPostStateRoot,
      validPostStateRoot,
      100 // Block number
    );
    
    // Verify the dispute was created
    const disputeId = 1; // First dispute
    const dispute = await disputeGame.getDispute(disputeId);
    
    expect(dispute.challenger).to.equal(challenger.address);
    expect(dispute.preStateRoot).to.equal(preStateRoot);
    expect(dispute.claimedPostStateRoot).to.equal(invalidPostStateRoot);
    expect(dispute.expectedPostStateRoot).to.equal(validPostStateRoot);
    expect(dispute.resolved).to.equal(false);
    
    // Simulate the bisection game
    // In a real implementation, this would involve multiple steps of bisection
    // For simplicity, we'll just resolve the dispute directly
    
    // Resolve the dispute (invalidate the sequencer's state root)
    await disputeGame.resolveDispute(disputeId, true); // true = challenger wins
    
    // Verify the state root status was updated
    const finalStatus = await stateCommitmentChain.getStateRootStatus(invalidPostStateRoot);
    expect(finalStatus).to.equal(2); // 2 = Invalid
  });
  
  it('should handle multiple challenges correctly', async function() {
    // Create multiple state roots
    const preStateRoot = ethers.utils.hexZeroPad("0x04", 32);
    const validPostStateRoot1 = ethers.utils.hexZeroPad("0x05", 32);
    const validPostStateRoot2 = ethers.utils.hexZeroPad("0x06", 32);
    
    // Create invalid state roots
    const invalidPostStateRoot1 = ethers.utils.hexZeroPad("0x07", 32);
    const invalidPostStateRoot2 = ethers.utils.hexZeroPad("0x08", 32);
    
    // Sequencer submits invalid state transitions
    await stateCommitmentChain.connect(sequencer).appendStateBatch(
      [invalidPostStateRoot1, invalidPostStateRoot2],
      [101, 102] // Block numbers
    );
    
    // Challenger initiates disputes
    await disputeGame.connect(challenger).initiateChallenge(
      preStateRoot,
      invalidPostStateRoot1,
      validPostStateRoot1,
      101 // Block number
    );
    
    await disputeGame.connect(challenger).initiateChallenge(
      validPostStateRoot1,
      invalidPostStateRoot2,
      validPostStateRoot2,
      102 // Block number
    );
    
    // Verify the disputes were created
    const dispute1 = await disputeGame.getDispute(2); // Second dispute
    const dispute2 = await disputeGame.getDispute(3); // Third dispute
    
    expect(dispute1.claimedPostStateRoot).to.equal(invalidPostStateRoot1);
    expect(dispute2.claimedPostStateRoot).to.equal(invalidPostStateRoot2);
    
    // Resolve the disputes
    await disputeGame.resolveDispute(2, true); // true = challenger wins
    await disputeGame.resolveDispute(3, true); // true = challenger wins
    
    // Verify the state root statuses were updated
    const status1 = await stateCommitmentChain.getStateRootStatus(invalidPostStateRoot1);
    const status2 = await stateCommitmentChain.getStateRootStatus(invalidPostStateRoot2);
    
    expect(status1).to.equal(2); // 2 = Invalid
    expect(status2).to.equal(2); // 2 = Invalid
  });
  
  it('should handle a valid state transition correctly', async function() {
    // Create valid state roots
    const preStateRoot = ethers.utils.hexZeroPad("0x09", 32);
    const validPostStateRoot = ethers.utils.hexZeroPad("0x0A", 32);
    
    // Sequencer submits a valid state transition
    await stateCommitmentChain.connect(sequencer).appendStateBatch(
      [validPostStateRoot],
      [103] // Block numbers
    );
    
    // Initial status
    const initialStatus = await stateCommitmentChain.getStateRootStatus(validPostStateRoot);
    expect(initialStatus).to.equal(1); // 1 = Submitted
    
    // Challenger incorrectly initiates a dispute
    const incorrectExpectedRoot = ethers.utils.hexZeroPad("0x0B", 32);
    
    await disputeGame.connect(challenger).initiateChallenge(
      preStateRoot,
      validPostStateRoot,
      incorrectExpectedRoot,
      103 // Block number
    );
    
    // Verify the dispute was created
    const disputeId = 4; // Fourth dispute
    const dispute = await disputeGame.getDispute(disputeId);
    
    expect(dispute.challenger).to.equal(challenger.address);
    expect(dispute.preStateRoot).to.equal(preStateRoot);
    expect(dispute.claimedPostStateRoot).to.equal(validPostStateRoot);
    expect(dispute.expectedPostStateRoot).to.equal(incorrectExpectedRoot);
    
    // Resolve the dispute (validate the sequencer's state root)
    await disputeGame.resolveDispute(disputeId, false); // false = sequencer wins
    
    // Verify the state root status was not changed
    const finalStatus = await stateCommitmentChain.getStateRootStatus(validPostStateRoot);
    expect(finalStatus).to.equal(1); // 1 = Submitted
    
    // Advance time to finalize the state root
    // In a real implementation, this would involve waiting for the challenge period
    // For simplicity, we'll just call a function to finalize
    await stateCommitmentChain.finalizeStateRoot(validPostStateRoot);
    
    // Verify the state root status was updated
    const finalizedStatus = await stateCommitmentChain.getStateRootStatus(validPostStateRoot);
    expect(finalizedStatus).to.equal(3); // 3 = Finalized
  });
  
  it('should handle the bisection game correctly', async function() {
    // Create state roots
    const preStateRoot = ethers.utils.hexZeroPad("0x0C", 32);
    const midStateRoot1 = ethers.utils.hexZeroPad("0x0D", 32);
    const midStateRoot2 = ethers.utils.hexZeroPad("0x0E", 32);
    const invalidPostStateRoot = ethers.utils.hexZeroPad("0x0F", 32);
    const validPostStateRoot = ethers.utils.hexZeroPad("0x10", 32);
    
    // Sequencer submits an invalid state transition
    await stateCommitmentChain.connect(sequencer).appendStateBatch(
      [invalidPostStateRoot],
      [104] // Block numbers
    );
    
    // Challenger initiates a dispute
    await disputeGame.connect(challenger).initiateChallenge(
      preStateRoot,
      invalidPostStateRoot,
      validPostStateRoot,
      104 // Block number
    );
    
    const disputeId = 5; // Fifth dispute
    
    // First bisection step
    await disputeGame.connect(sequencer).bisect(
      disputeId,
      [midStateRoot1, midStateRoot2],
      0 // Segment to defend (first half)
    );
    
    // Challenger selects the first segment
    await disputeGame.connect(challenger).selectSegment(
      disputeId,
      0 // Segment to challenge (first half)
    );
    
    // Second bisection step (would continue until single-step execution)
    // In a real implementation, this would involve more steps
    // For simplicity, we'll just resolve the dispute
    
    // Resolve the dispute (invalidate the sequencer's state root)
    await disputeGame.resolveDispute(disputeId, true); // true = challenger wins
    
    // Verify the state root status was updated
    const finalStatus = await stateCommitmentChain.getStateRootStatus(invalidPostStateRoot);
    expect(finalStatus).to.equal(2); // 2 = Invalid
  });
});

// Mock L2Client class for testing
class L2Client {
  constructor(url) {
    this.url = url;
  }
  
  // Mock methods as needed
}

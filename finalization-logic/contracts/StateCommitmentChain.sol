// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title DisputeGameInterface
 * @dev Interface for interacting with the DisputeGame contract
 */
interface DisputeGameInterface {
    enum ChallengeState {
        NonExistent,
        InProgress,
        ResolvedForChallenger,
        ResolvedForSequencer,
        Expired
    }
    
    function getChallengeState(bytes32 _challengeId) external view returns (ChallengeState);
    function createChallenge(
        address _sequencer,
        uint256 _blockNumber,
        bytes32 _contestedStateRoot,
        bytes32 _proposedStateRoot,
        uint8 _challengeType,
        bytes32 _transactionHash
    ) external payable returns (bytes32);
}

/**
 * @title FraudProofSystemInterface
 * @dev Interface for interacting with the FraudProofSystem contract
 */
interface FraudProofSystemInterface {
    enum FraudProofState {
        NonExistent,
        InVerification,
        Confirmed,
        Rejected,
        Expired
    }
    
    function getProofState(bytes32 _proofId) external view returns (FraudProofState);
    function submitFraudProof(
        uint8 _proofType,
        bytes32 _blockHash,
        uint256 _blockNumber,
        bytes32 _preStateRoot,
        bytes32 _postStateRoot,
        bytes32 _expectedPostStateRoot,
        bytes32 _transactionHash,
        bytes calldata _executionTrace
    ) external returns (bytes32);
}

/**
 * @title StateCommitmentChain
 * @dev Contract for committing Layer-2 state roots to Ethereum
 * This contract manages the queue of state roots and their finalization status.
 */
contract StateCommitmentChain is Ownable, ReentrancyGuard, Pausable {
    // Structure to store state commitment information
    struct StateCommitment {
        bytes32 stateRoot;
        bytes32 blockHash;
        uint256 blockNumber;
        uint256 timestamp;
        address submitter;
        bool finalized;
        uint256 finalizationTime;
    }
    
    // Array of state commitments
    StateCommitment[] public stateCommitments;
    
    // Mapping of block number to state commitment index
    mapping(uint256 => uint256) public blockNumberToIndex;
    
    // Mapping of block hash to state commitment index
    mapping(bytes32 => uint256) public blockHashToIndex;
    
    // Address of the BlockFinalization contract
    address public blockFinalizationAddress;
    
    // Events
    event StateCommitmentSubmitted(
        uint256 indexed index,
        bytes32 stateRoot,
        bytes32 blockHash,
        uint256 blockNumber,
        address submitter
    );
    
    event StateCommitmentFinalized(
        uint256 indexed index,
        bytes32 stateRoot,
        bytes32 blockHash,
        uint256 blockNumber,
        uint256 finalizationTime
    );
    
    event BlockFinalizationAddressUpdated(address blockFinalizationAddress);

    /**
     * @dev Contract constructor
     */
    constructor() {
        // Initialize with a dummy state commitment at index 0
        stateCommitments.push(StateCommitment({
            stateRoot: bytes32(0),
            blockHash: bytes32(0),
            blockNumber: 0,
            timestamp: block.timestamp,
            submitter: address(0),
            finalized: true,
            finalizationTime: block.timestamp
        }));
    }

    /**
     * @dev Sets the address of the BlockFinalization contract
     * @param _blockFinalizationAddress Address of the BlockFinalization contract
     */
    function setBlockFinalizationAddress(address _blockFinalizationAddress) external onlyOwner {
        require(_blockFinalizationAddress != address(0), "Invalid BlockFinalization address");
        blockFinalizationAddress = _blockFinalizationAddress;
        emit BlockFinalizationAddressUpdated(_blockFinalizationAddress);
    }

    /**
     * @dev Submits a new state commitment
     * @param _stateRoot State root hash
     * @param _blockHash Block hash
     * @param _blockNumber Block number
     * @return Index of the state commitment
     */
    function submitStateCommitment(
        bytes32 _stateRoot,
        bytes32 _blockHash,
        uint256 _blockNumber
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_stateRoot != bytes32(0), "Invalid state root");
        require(_blockHash != bytes32(0), "Invalid block hash");
        require(_blockNumber > 0, "Invalid block number");
        
        // Verify that the block number isn't already committed
        require(blockNumberToIndex[_blockNumber] == 0, "Block number already committed");
        
        // Verify that the block hash isn't already committed
        require(blockHashToIndex[_blockHash] == 0, "Block hash already committed");
        
        // Verify that the caller is authorized to submit state commitments
        require(isAuthorizedSubmitter(msg.sender), "Not authorized to submit state commitments");
        
        // Create the new state commitment
        StateCommitment memory newCommitment = StateCommitment({
            stateRoot: _stateRoot,
            blockHash: _blockHash,
            blockNumber: _blockNumber,
            timestamp: block.timestamp,
            submitter: msg.sender,
            finalized: false,
            finalizationTime: 0
        });
        
        // Add the state commitment to the array
        stateCommitments.push(newCommitment);
        uint256 index = stateCommitments.length - 1;
        
        // Update the mappings
        blockNumberToIndex[_blockNumber] = index;
        blockHashToIndex[_blockHash] = index;
        
        // Emit the event
        emit StateCommitmentSubmitted(
            index,
            _stateRoot,
            _blockHash,
            _blockNumber,
            msg.sender
        );
        
        // If the BlockFinalization contract is set, propose the block there
        if (blockFinalizationAddress != address(0)) {
            // In a real implementation, we would call the BlockFinalization contract
            // to propose the block
        }
        
        return index;
    }

    /**
     * @dev Finalizes a state commitment
     * @param _index Index of the state commitment to finalize
     */
    function finalizeStateCommitment(uint256 _index) external nonReentrant whenNotPaused {
        require(_index > 0 && _index < stateCommitments.length, "Invalid index");
        require(!stateCommitments[_index].finalized, "State commitment already finalized");
        
        // Verify that the caller is authorized to finalize state commitments
        require(isAuthorizedFinalizer(msg.sender), "Not authorized to finalize state commitments");
        
        // If the BlockFinalization contract is set, verify that the block is finalized there
        if (blockFinalizationAddress != address(0)) {
            // In a real implementation, we would call the BlockFinalization contract
            // to verify that the block is finalized
        }
        
        // Update the state commitment
        stateCommitments[_index].finalized = true;
        stateCommitments[_index].finalizationTime = block.timestamp;
        
        // Emit the event
        emit StateCommitmentFinalized(
            _index,
            stateCommitments[_index].stateRoot,
            stateCommitments[_index].blockHash,
            stateCommitments[_index].blockNumber,
            block.timestamp
        );
    }

    /**
     * @dev Gets the state commitment at the given index
     * @param _index Index of the state commitment
     * @return stateRoot State root hash
     * @return blockHash Block hash
     * @return blockNumber Block number
     * @return timestamp Timestamp of the state commitment
     * @return submitter Address of the submitter
     * @return finalized Whether the state commitment is finalized
     * @return finalizationTime Timestamp of finalization
     */
    function getStateCommitment(uint256 _index) external view returns (
        bytes32 stateRoot,
        bytes32 blockHash,
        uint256 blockNumber,
        uint256 timestamp,
        address submitter,
        bool finalized,
        uint256 finalizationTime
    ) {
        require(_index < stateCommitments.length, "Invalid index");
        
        StateCommitment storage commitment = stateCommitments[_index];
        return (
            commitment.stateRoot,
            commitment.blockHash,
            commitment.blockNumber,
            commitment.timestamp,
            commitment.submitter,
            commitment.finalized,
            commitment.finalizationTime
        );
    }

    /**
     * @dev Gets the state commitment for a block number
     * @param _blockNumber Block number
     * @return Index of the state commitment
     */
    function getStateCommitmentIndexByBlockNumber(uint256 _blockNumber) external view returns (uint256) {
        uint256 index = blockNumberToIndex[_blockNumber];
        require(index > 0, "Block number not committed");
        return index;
    }

    /**
     * @dev Gets the state commitment for a block hash
     * @param _blockHash Block hash
     * @return Index of the state commitment
     */
    function getStateCommitmentIndexByBlockHash(bytes32 _blockHash) external view returns (uint256) {
        uint256 index = blockHashToIndex[_blockHash];
        require(index > 0, "Block hash not committed");
        return index;
    }

    /**
     * @dev Gets the total number of state commitments
     * @return Total number of state commitments
     */
    function getStateCommitmentCount() external view returns (uint256) {
        return stateCommitments.length;
    }

    /**
     * @dev Checks if an address is authorized to submit state commitments
     * @param _submitter Address of the submitter
     * @return true if the submitter is authorized, false otherwise
     */
    function isAuthorizedSubmitter(address _submitter) public view returns (bool) {
        // Example implementation: only the owner is authorized
        // In a real implementation, a mapping or a role could be used
        return _submitter == owner();
    }

    /**
     * @dev Checks if an address is authorized to finalize state commitments
     * @param _finalizer Address of the finalizer
     * @return true if the finalizer is authorized, false otherwise
     */
    function isAuthorizedFinalizer(address _finalizer) public view returns (bool) {
        // Example implementation: only the owner or the BlockFinalization contract is authorized
        // In a real implementation, a mapping or a role could be used
        return _finalizer == owner() || _finalizer == blockFinalizationAddress;
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}

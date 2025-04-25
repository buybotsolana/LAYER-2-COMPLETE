// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title BlockFinalization
 * @dev Contract for the finalization of Layer-2 blocks on Solana
 * This contract manages the process of finalizing L2 blocks on Layer-1,
 * ensuring that blocks become final and trustworthy after a challenge period.
 */
contract BlockFinalization is Ownable, ReentrancyGuard, Pausable {
    // Enumeration for block state
    enum BlockState {
        NonExistent,
        Proposed,
        Challenged,
        Finalized,
        Invalidated
    }

    // Structure to store block information
    struct Block {
        bytes32 blockHash;
        bytes32 stateRoot;
        bytes32 parentBlockHash;
        uint256 blockNumber;
        uint256 timestamp;
        address proposer;
        uint256 proposalTime;
        uint256 finalizationTime;
        BlockState state;
        bytes32 challengeId;
        uint256 transactionCount;
        bytes32 transactionsRoot;
    }

    // Mapping of blocks by hash
    mapping(bytes32 => Block) public blocks;
    
    // Mapping of blocks by number
    mapping(uint256 => bytes32) public blocksByNumber;
    
    // Array of block hashes
    bytes32[] public blockHashes;
    
    // Challenge period (in seconds)
    uint256 public challengePeriod = 7 days;
    
    // Hash of the last finalized block
    bytes32 public lastFinalizedBlockHash;
    
    // Number of the last finalized block
    uint256 public lastFinalizedBlockNumber;
    
    // Address of the DisputeGame contract
    address public disputeGameAddress;
    
    // Address of the FraudProofSystem contract
    address public fraudProofSystemAddress;

    // Events
    event BlockProposed(
        bytes32 indexed blockHash,
        uint256 indexed blockNumber,
        bytes32 stateRoot,
        address proposer,
        uint256 proposalTime,
        uint256 expectedFinalizationTime
    );
    
    event BlockChallenged(
        bytes32 indexed blockHash,
        uint256 indexed blockNumber,
        bytes32 challengeId,
        address challenger
    );
    
    event BlockFinalized(
        bytes32 indexed blockHash,
        uint256 indexed blockNumber,
        bytes32 stateRoot,
        uint256 finalizationTime
    );
    
    event BlockInvalidated(
        bytes32 indexed blockHash,
        uint256 indexed blockNumber,
        bytes32 challengeId
    );
    
    event ChallengePeriodUpdated(uint256 newChallengePeriod);
    event ContractAddressesUpdated(address disputeGame, address fraudProofSystem);

    /**
     * @dev Contract constructor
     * @param _disputeGameAddress Address of the DisputeGame contract
     * @param _fraudProofSystemAddress Address of the FraudProofSystem contract
     */
    constructor(address _disputeGameAddress, address _fraudProofSystemAddress) {
        require(_disputeGameAddress != address(0), "Invalid DisputeGame address");
        require(_fraudProofSystemAddress != address(0), "Invalid FraudProofSystem address");
        
        disputeGameAddress = _disputeGameAddress;
        fraudProofSystemAddress = _fraudProofSystemAddress;
    }

    /**
     * @dev Modifies the challenge period
     * @param _challengePeriod New challenge period in seconds
     */
    function setChallengePeriod(uint256 _challengePeriod) external onlyOwner {
        require(_challengePeriod >= 1 days, "Challenge period too short");
        challengePeriod = _challengePeriod;
        emit ChallengePeriodUpdated(_challengePeriod);
    }

    /**
     * @dev Updates the contract addresses
     * @param _disputeGameAddress New address of the DisputeGame contract
     * @param _fraudProofSystemAddress New address of the FraudProofSystem contract
     */
    function updateContractAddresses(address _disputeGameAddress, address _fraudProofSystemAddress) external onlyOwner {
        require(_disputeGameAddress != address(0), "Invalid DisputeGame address");
        require(_fraudProofSystemAddress != address(0), "Invalid FraudProofSystem address");
        
        disputeGameAddress = _disputeGameAddress;
        fraudProofSystemAddress = _fraudProofSystemAddress;
        
        emit ContractAddressesUpdated(_disputeGameAddress, _fraudProofSystemAddress);
    }

    /**
     * @dev Proposes a new block for finalization
     * @param _blockHash Block hash
     * @param _stateRoot State root hash
     * @param _parentBlockHash Parent block hash
     * @param _blockNumber Block number
     * @param _transactionCount Number of transactions in the block
     * @param _transactionsRoot Hash of the transactions root
     * @return Expected finalization timestamp
     */
    function proposeBlock(
        bytes32 _blockHash,
        bytes32 _stateRoot,
        bytes32 _parentBlockHash,
        uint256 _blockNumber,
        uint256 _transactionCount,
        bytes32 _transactionsRoot
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_blockHash != bytes32(0), "Invalid block hash");
        require(_stateRoot != bytes32(0), "Invalid state root");
        require(_blockNumber > 0, "Invalid block number");
        
        // Verify that the block doesn't already exist
        require(blocks[_blockHash].blockHash == bytes32(0), "Block already exists");
        
        // Verify that the block number isn't already assigned
        require(blocksByNumber[_blockNumber] == bytes32(0), "Block number already assigned");
        
        // If it's not the first block, verify that the parent block exists and is finalized
        if (_blockNumber > 1) {
            require(_parentBlockHash != bytes32(0), "Invalid parent block hash");
            require(blocks[_parentBlockHash].state == BlockState.Finalized, "Parent block not finalized");
            require(blocks[_parentBlockHash].blockNumber == _blockNumber - 1, "Invalid parent block number");
        }
        
        // Verify that the caller is authorized to propose blocks
        require(isAuthorizedProposer(msg.sender), "Not authorized to propose blocks");
        
        // Calculate the expected finalization timestamp
        uint256 expectedFinalizationTime = block.timestamp + challengePeriod;
        
        // Create the new block
        Block storage newBlock = blocks[_blockHash];
        newBlock.blockHash = _blockHash;
        newBlock.stateRoot = _stateRoot;
        newBlock.parentBlockHash = _parentBlockHash;
        newBlock.blockNumber = _blockNumber;
        newBlock.timestamp = block.timestamp;
        newBlock.proposer = msg.sender;
        newBlock.proposalTime = block.timestamp;
        newBlock.state = BlockState.Proposed;
        newBlock.transactionCount = _transactionCount;
        newBlock.transactionsRoot = _transactionsRoot;
        
        // Update the mappings
        blocksByNumber[_blockNumber] = _blockHash;
        blockHashes.push(_blockHash);
        
        // Emit the event
        emit BlockProposed(
            _blockHash,
            _blockNumber,
            _stateRoot,
            msg.sender,
            block.timestamp,
            expectedFinalizationTime
        );
        
        return expectedFinalizationTime;
    }

    /**
     * @dev Challenges a proposed block
     * @param _blockHash Hash of the block to challenge
     * @param _challengeId ID of the challenge in the DisputeGame
     */
    function challengeBlock(
        bytes32 _blockHash,
        bytes32 _challengeId
    ) external nonReentrant whenNotPaused {
        Block storage block_ = blocks[_blockHash];
        
        // Verify that the block exists and is in proposed state
        require(block_.blockHash != bytes32(0), "Block does not exist");
        require(block_.state == BlockState.Proposed, "Block not in proposed state");
        require(block.timestamp < block_.proposalTime + challengePeriod, "Challenge period expired");
        
        // Verify that the challenge exists in the DisputeGame
        require(isValidChallenge(_challengeId), "Invalid challenge");
        
        // Update the block state
        block_.state = BlockState.Challenged;
        block_.challengeId = _challengeId;
        
        // Emit the event
        emit BlockChallenged(
            _blockHash,
            block_.blockNumber,
            _challengeId,
            msg.sender
        );
    }

    /**
     * @dev Finalizes a block after the challenge period
     * @param _blockHash Hash of the block to finalize
     */
    function finalizeBlock(bytes32 _blockHash) external nonReentrant whenNotPaused {
        Block storage block_ = blocks[_blockHash];
        
        // Verify that the block exists and is in proposed state
        require(block_.blockHash != bytes32(0), "Block does not exist");
        require(block_.state == BlockState.Proposed, "Block not in proposed state");
        require(block.timestamp >= block_.proposalTime + challengePeriod, "Challenge period not expired");
        
        // Update the block state
        block_.state = BlockState.Finalized;
        block_.finalizationTime = block.timestamp;
        
        // Update the last finalized block
        lastFinalizedBlockHash = _blockHash;
        lastFinalizedBlockNumber = block_.blockNumber;
        
        // Emit the event
        emit BlockFinalized(
            _blockHash,
            block_.blockNumber,
            block_.stateRoot,
            block.timestamp
        );
    }

    /**
     * @dev Resolves a challenged block based on the challenge result
     * @param _blockHash Hash of the challenged block
     */
    function resolveChallenge(bytes32 _blockHash) external nonReentrant whenNotPaused {
        Block storage block_ = blocks[_blockHash];
        
        // Verify that the block exists and is in challenged state
        require(block_.blockHash != bytes32(0), "Block does not exist");
        require(block_.state == BlockState.Challenged, "Block not challenged");
        require(block_.challengeId != bytes32(0), "No challenge associated");
        
        // Get the challenge result from the DisputeGame
        bool challengeSucceeded = getChallengeResult(block_.challengeId);
        
        // Update the block state based on the challenge result
        if (challengeSucceeded) {
            // The challenge was successful, the block is invalidated
            block_.state = BlockState.Invalidated;
            
            // Emit the event
            emit BlockInvalidated(
                _blockHash,
                block_.blockNumber,
                block_.challengeId
            );
        } else {
            // The challenge failed, the block is finalized
            block_.state = BlockState.Finalized;
            block_.finalizationTime = block.timestamp;
            
            // Update the last finalized block
            lastFinalizedBlockHash = _blockHash;
            lastFinalizedBlockNumber = block_.blockNumber;
            
            // Emit the event
            emit BlockFinalized(
                _blockHash,
                block_.blockNumber,
                block_.stateRoot,
                block.timestamp
            );
        }
    }

    /**
     * @dev Checks if an address is authorized to propose blocks
     * @param _proposer Address of the proposer
     * @return true if the proposer is authorized, false otherwise
     */
    function isAuthorizedProposer(address _proposer) public view returns (bool) {
        // Example implementation: only the owner is authorized
        // In a real implementation, a mapping or a role could be used
        return _proposer == owner();
    }

    /**
     * @dev Checks if a challenge is valid
     * @param _challengeId ID of the challenge
     * @return true if the challenge is valid, false otherwise
     */
    function isValidChallenge(bytes32 _challengeId) public view returns (bool) {
        // In a real implementation, we would call the DisputeGame contract
        // to verify that the challenge exists and is valid
        // For now, we assume all challenges are valid for simplicity
        return _challengeId != bytes32(0);
    }

    /**
     * @dev Gets the result of a challenge
     * @param _challengeId ID of the challenge
     * @return true if the challenge was successful, false otherwise
     */
    function getChallengeResult(bytes32 _challengeId) public view returns (bool) {
        // In a real implementation, we would call the DisputeGame contract
        // to get the challenge result
        // For now, we return a default value for simplicity
        return false;
    }

    /**
     * @dev Gets the state of a block
     * @param _blockHash Hash of the block
     * @return State of the block
     */
    function getBlockState(bytes32 _blockHash) external view returns (BlockState) {
        return blocks[_blockHash].state;
    }

    /**
     * @dev Gets the details of a block
     * @param _blockHash Hash of the block
     * @return blockNumber Block number
     * @return stateRoot State root hash
     * @return proposer Address of the proposer
     * @return proposalTime Proposal timestamp
     * @return state Block state
     */
    function getBlockDetails(bytes32 _blockHash) external view returns (
        uint256 blockNumber,
        bytes32 stateRoot,
        address proposer,
        uint256 proposalTime,
        BlockState state
    ) {
        Block storage block_ = blocks[_blockHash];
        return (
            block_.blockNumber,
            block_.stateRoot,
            block_.proposer,
            block_.proposalTime,
            block_.state
        );
    }

    /**
     * @dev Gets the total number of blocks
     * @return Total number of blocks
     */
    function getBlockCount() external view returns (uint256) {
        return blockHashes.length;
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

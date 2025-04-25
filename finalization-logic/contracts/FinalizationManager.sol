// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title BlockFinalizationInterface
 * @dev Interface for interacting with the BlockFinalization contract
 */
interface BlockFinalizationInterface {
    enum BlockState {
        NonExistent,
        Proposed,
        Challenged,
        Finalized,
        Invalidated
    }
    
    function getBlockState(bytes32 _blockHash) external view returns (BlockState);
    function getBlockDetails(bytes32 _blockHash) external view returns (
        uint256 blockNumber,
        bytes32 stateRoot,
        address proposer,
        uint256 proposalTime,
        BlockState state
    );
}

/**
 * @title L2OutputOracleInterface
 * @dev Interface for interacting with the L2OutputOracle contract
 */
interface L2OutputOracleInterface {
    function getL2Output(uint256 _index) external view returns (
        bytes32 outputRoot,
        bytes32 stateRoot,
        bytes32 blockHash,
        uint256 l2BlockNumber,
        uint256 timestamp,
        address submitter,
        bool finalized,
        uint256 finalizationTime
    );
    
    function getL2OutputIndexByBlockNumber(uint256 _l2BlockNumber) external view returns (uint256);
    function getLatestFinalizedL2Output() external view returns (uint256);
}

/**
 * @title FinalizationManager
 * @dev Contract for managing the finalization process across multiple contracts
 * This contract coordinates the finalization of blocks, state commitments, and outputs.
 */
contract FinalizationManager is Ownable, ReentrancyGuard, Pausable {
    // Address of the BlockFinalization contract
    address public blockFinalizationAddress;
    
    // Address of the StateCommitmentChain contract
    address public stateCommitmentChainAddress;
    
    // Address of the L2OutputOracle contract
    address public l2OutputOracleAddress;
    
    // Events
    event ContractAddressesUpdated(
        address blockFinalization,
        address stateCommitmentChain,
        address l2OutputOracle
    );
    
    event FinalizationProcessStarted(
        bytes32 blockHash,
        uint256 blockNumber,
        bytes32 stateRoot
    );
    
    event FinalizationProcessCompleted(
        bytes32 blockHash,
        uint256 blockNumber,
        bytes32 stateRoot,
        uint256 finalizationTime
    );

    /**
     * @dev Contract constructor
     */
    constructor() {}

    /**
     * @dev Sets the contract addresses
     * @param _blockFinalizationAddress Address of the BlockFinalization contract
     * @param _stateCommitmentChainAddress Address of the StateCommitmentChain contract
     * @param _l2OutputOracleAddress Address of the L2OutputOracle contract
     */
    function setContractAddresses(
        address _blockFinalizationAddress,
        address _stateCommitmentChainAddress,
        address _l2OutputOracleAddress
    ) external onlyOwner {
        require(_blockFinalizationAddress != address(0), "Invalid BlockFinalization address");
        require(_stateCommitmentChainAddress != address(0), "Invalid StateCommitmentChain address");
        require(_l2OutputOracleAddress != address(0), "Invalid L2OutputOracle address");
        
        blockFinalizationAddress = _blockFinalizationAddress;
        stateCommitmentChainAddress = _stateCommitmentChainAddress;
        l2OutputOracleAddress = _l2OutputOracleAddress;
        
        emit ContractAddressesUpdated(
            _blockFinalizationAddress,
            _stateCommitmentChainAddress,
            _l2OutputOracleAddress
        );
    }

    /**
     * @dev Starts the finalization process for a block
     * @param _blockHash Hash of the block to finalize
     * @param _blockNumber Block number
     * @param _stateRoot State root hash
     * @param _outputRoot Output root hash
     */
    function startFinalizationProcess(
        bytes32 _blockHash,
        uint256 _blockNumber,
        bytes32 _stateRoot,
        bytes32 _outputRoot
    ) external nonReentrant whenNotPaused {
        require(_blockHash != bytes32(0), "Invalid block hash");
        require(_blockNumber > 0, "Invalid block number");
        require(_stateRoot != bytes32(0), "Invalid state root");
        require(_outputRoot != bytes32(0), "Invalid output root");
        
        // Verify that the caller is authorized
        require(isAuthorizedFinalizer(msg.sender), "Not authorized to start finalization");
        
        // In a real implementation, we would call the respective contracts
        // to start the finalization process
        
        emit FinalizationProcessStarted(
            _blockHash,
            _blockNumber,
            _stateRoot
        );
    }

    /**
     * @dev Completes the finalization process for a block
     * @param _blockHash Hash of the block to finalize
     */
    function completeFinalizationProcess(bytes32 _blockHash) external nonReentrant whenNotPaused {
        require(_blockHash != bytes32(0), "Invalid block hash");
        
        // Verify that the caller is authorized
        require(isAuthorizedFinalizer(msg.sender), "Not authorized to complete finalization");
        
        // In a real implementation, we would call the respective contracts
        // to complete the finalization process
        
        // For now, we just emit the event with placeholder values
        emit FinalizationProcessCompleted(
            _blockHash,
            0, // Block number (placeholder)
            bytes32(0), // State root (placeholder)
            block.timestamp
        );
    }

    /**
     * @dev Checks the finalization status of a block
     * @param _blockHash Hash of the block
     * @return isFinalized Whether the block is finalized
     * @return finalizationTime Timestamp of finalization (0 if not finalized)
     */
    function checkFinalizationStatus(bytes32 _blockHash) external view returns (
        bool isFinalized,
        uint256 finalizationTime
    ) {
        require(_blockHash != bytes32(0), "Invalid block hash");
        
        // In a real implementation, we would call the respective contracts
        // to check the finalization status
        
        // For now, we return placeholder values
        return (false, 0);
    }

    /**
     * @dev Checks if an address is authorized to start or complete finalization
     * @param _finalizer Address of the finalizer
     * @return true if the finalizer is authorized, false otherwise
     */
    function isAuthorizedFinalizer(address _finalizer) public view returns (bool) {
        // Example implementation: only the owner is authorized
        // In a real implementation, a mapping or a role could be used
        return _finalizer == owner();
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

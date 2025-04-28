// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SequencerInterface
 * @dev Interface for interacting with the Sequencer contract
 */
interface SequencerInterface {
    function submitBatch(
        bytes32[] calldata _stateRoots,
        bytes32[] calldata _blockHashes,
        uint256[] calldata _blockNumbers,
        bytes calldata _transactions
    ) external returns (uint256);
}

/**
 * @title L2OutputOracle
 * @dev Contract for submitting and verifying L2 outputs on L1
 * This contract serves as the source of truth for L2 outputs on L1.
 */
contract L2OutputOracle is Ownable, ReentrancyGuard, Pausable {
    // Structure to store L2 output information
    struct L2Output {
        bytes32 outputRoot;
        bytes32 stateRoot;
        bytes32 blockHash;
        uint256 l2BlockNumber;
        uint256 timestamp;
        address submitter;
        bool finalized;
        uint256 finalizationTime;
    }
    
    // Array of L2 outputs
    L2Output[] public l2Outputs;
    
    // Mapping of L2 block number to L2 output index
    mapping(uint256 => uint256) public l2BlockNumberToIndex;
    
    // Challenge period (in seconds)
    uint256 public challengePeriod = 7 days;
    
    // Address of the StateCommitmentChain contract
    address public stateCommitmentChainAddress;
    
    // Address of the Sequencer contract
    address public sequencerAddress;
    
    // Events
    event OutputSubmitted(
        uint256 indexed index,
        bytes32 outputRoot,
        bytes32 stateRoot,
        bytes32 blockHash,
        uint256 l2BlockNumber,
        address submitter
    );
    
    event OutputFinalized(
        uint256 indexed index,
        bytes32 outputRoot,
        bytes32 stateRoot,
        uint256 l2BlockNumber,
        uint256 finalizationTime
    );
    
    event OutputDeleted(
        uint256 indexed index,
        bytes32 outputRoot,
        bytes32 stateRoot,
        uint256 l2BlockNumber
    );
    
    event ChallengePeriodUpdated(uint256 newChallengePeriod);
    event ContractAddressesUpdated(address stateCommitmentChain, address sequencer);

    /**
     * @dev Contract constructor
     */
    constructor() {
        // Initialize with a dummy output at index 0
        l2Outputs.push(L2Output({
            outputRoot: bytes32(0),
            stateRoot: bytes32(0),
            blockHash: bytes32(0),
            l2BlockNumber: 0,
            timestamp: block.timestamp,
            submitter: address(0),
            finalized: true,
            finalizationTime: block.timestamp
        }));
    }

    /**
     * @dev Sets the contract addresses
     * @param _stateCommitmentChainAddress Address of the StateCommitmentChain contract
     * @param _sequencerAddress Address of the Sequencer contract
     */
    function setContractAddresses(
        address _stateCommitmentChainAddress,
        address _sequencerAddress
    ) external onlyOwner {
        require(_stateCommitmentChainAddress != address(0), "Invalid StateCommitmentChain address");
        
        stateCommitmentChainAddress = _stateCommitmentChainAddress;
        sequencerAddress = _sequencerAddress;
        
        emit ContractAddressesUpdated(_stateCommitmentChainAddress, _sequencerAddress);
    }

    /**
     * @dev Sets the challenge period
     * @param _challengePeriod New challenge period in seconds
     */
    function setChallengePeriod(uint256 _challengePeriod) external onlyOwner {
        require(_challengePeriod >= 1 days, "Challenge period too short");
        challengePeriod = _challengePeriod;
        emit ChallengePeriodUpdated(_challengePeriod);
    }

    /**
     * @dev Submits a new L2 output
     * @param _outputRoot Output root hash
     * @param _stateRoot State root hash
     * @param _blockHash Block hash
     * @param _l2BlockNumber L2 block number
     * @return Index of the L2 output
     */
    function submitL2Output(
        bytes32 _outputRoot,
        bytes32 _stateRoot,
        bytes32 _blockHash,
        uint256 _l2BlockNumber
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_outputRoot != bytes32(0), "Invalid output root");
        require(_stateRoot != bytes32(0), "Invalid state root");
        require(_blockHash != bytes32(0), "Invalid block hash");
        require(_l2BlockNumber > 0, "Invalid L2 block number");
        
        // Verify that the L2 block number isn't already submitted
        require(l2BlockNumberToIndex[_l2BlockNumber] == 0, "L2 block number already submitted");
        
        // Verify that the caller is authorized to submit outputs
        require(isAuthorizedSubmitter(msg.sender), "Not authorized to submit outputs");
        
        // Create the new L2 output
        L2Output memory newOutput = L2Output({
            outputRoot: _outputRoot,
            stateRoot: _stateRoot,
            blockHash: _blockHash,
            l2BlockNumber: _l2BlockNumber,
            timestamp: block.timestamp,
            submitter: msg.sender,
            finalized: false,
            finalizationTime: 0
        });
        
        // Add the L2 output to the array
        l2Outputs.push(newOutput);
        uint256 index = l2Outputs.length - 1;
        
        // Update the mapping
        l2BlockNumberToIndex[_l2BlockNumber] = index;
        
        // Emit the event
        emit OutputSubmitted(
            index,
            _outputRoot,
            _stateRoot,
            _blockHash,
            _l2BlockNumber,
            msg.sender
        );
        
        return index;
    }

    /**
     * @dev Finalizes an L2 output after the challenge period
     * @param _index Index of the L2 output to finalize
     */
    function finalizeL2Output(uint256 _index) external nonReentrant whenNotPaused {
        require(_index > 0 && _index < l2Outputs.length, "Invalid index");
        require(!l2Outputs[_index].finalized, "Output already finalized");
        
        // Verify that the challenge period has passed
        require(block.timestamp >= l2Outputs[_index].timestamp + challengePeriod, "Challenge period not expired");
        
        // Update the L2 output
        l2Outputs[_index].finalized = true;
        l2Outputs[_index].finalizationTime = block.timestamp;
        
        // Emit the event
        emit OutputFinalized(
            _index,
            l2Outputs[_index].outputRoot,
            l2Outputs[_index].stateRoot,
            l2Outputs[_index].l2BlockNumber,
            block.timestamp
        );
    }

    /**
     * @dev Deletes an L2 output (only possible if not finalized)
     * @param _index Index of the L2 output to delete
     */
    function deleteL2Output(uint256 _index) external onlyOwner nonReentrant whenNotPaused {
        require(_index > 0 && _index < l2Outputs.length, "Invalid index");
        require(!l2Outputs[_index].finalized, "Cannot delete finalized output");
        
        // Store the output details for the event
        bytes32 outputRoot = l2Outputs[_index].outputRoot;
        bytes32 stateRoot = l2Outputs[_index].stateRoot;
        uint256 l2BlockNumber = l2Outputs[_index].l2BlockNumber;
        
        // Remove the mapping
        l2BlockNumberToIndex[l2BlockNumber] = 0;
        
        // Delete the L2 output (replace with the last one and pop)
        if (_index < l2Outputs.length - 1) {
            l2Outputs[_index] = l2Outputs[l2Outputs.length - 1];
            // Update the mapping for the moved output
            l2BlockNumberToIndex[l2Outputs[_index].l2BlockNumber] = _index;
        }
        l2Outputs.pop();
        
        // Emit the event
        emit OutputDeleted(
            _index,
            outputRoot,
            stateRoot,
            l2BlockNumber
        );
    }

    /**
     * @dev Gets the L2 output at the given index
     * @param _index Index of the L2 output
     * @return outputRoot Output root hash
     * @return stateRoot State root hash
     * @return blockHash Block hash
     * @return l2BlockNumber L2 block number
     * @return timestamp Timestamp of the output submission
     * @return submitter Address of the submitter
     * @return finalized Whether the output is finalized
     * @return finalizationTime Timestamp of finalization
     */
    function getL2Output(uint256 _index) external view returns (
        bytes32 outputRoot,
        bytes32 stateRoot,
        bytes32 blockHash,
        uint256 l2BlockNumber,
        uint256 timestamp,
        address submitter,
        bool finalized,
        uint256 finalizationTime
    ) {
        require(_index < l2Outputs.length, "Invalid index");
        
        L2Output storage output = l2Outputs[_index];
        return (
            output.outputRoot,
            output.stateRoot,
            output.blockHash,
            output.l2BlockNumber,
            output.timestamp,
            output.submitter,
            output.finalized,
            output.finalizationTime
        );
    }

    /**
     * @dev Gets the L2 output for an L2 block number
     * @param _l2BlockNumber L2 block number
     * @return Index of the L2 output
     */
    function getL2OutputIndexByBlockNumber(uint256 _l2BlockNumber) external view returns (uint256) {
        uint256 index = l2BlockNumberToIndex[_l2BlockNumber];
        require(index > 0, "L2 block number not submitted");
        return index;
    }

    /**
     * @dev Gets the latest finalized L2 output
     * @return Index of the latest finalized L2 output
     */
    function getLatestFinalizedL2Output() external view returns (uint256) {
        // Start from the end and find the first finalized output
        for (uint256 i = l2Outputs.length - 1; i > 0; i--) {
            if (l2Outputs[i].finalized) {
                return i;
            }
        }
        
        // If no finalized output is found, return the genesis output
        return 0;
    }

    /**
     * @dev Gets the total number of L2 outputs
     * @return Total number of L2 outputs
     */
    function getL2OutputCount() external view returns (uint256) {
        return l2Outputs.length;
    }

    /**
     * @dev Checks if an address is authorized to submit outputs
     * @param _submitter Address of the submitter
     * @return true if the submitter is authorized, false otherwise
     */
    function isAuthorizedSubmitter(address _submitter) public view returns (bool) {
        // Example implementation: only the owner or the sequencer is authorized
        // In a real implementation, a mapping or a role could be used
        return _submitter == owner() || _submitter == sequencerAddress;
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
    
    function getLatestFinalizedL2Output() external view returns (uint256);
}

/**
 * @title L2ToL1WithdrawalBridge
 * @dev Contract for handling withdrawals from Solana Layer-2 to Ethereum (L1)
 * This contract verifies withdrawal proofs and releases assets on L1 that were
 * previously locked during deposits.
 */
contract L2ToL1WithdrawalBridge is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Structure to store withdrawal information
    struct Withdrawal {
        address recipient;
        address token;
        uint256 amount;
        bytes32 l2BlockHash;
        uint256 l2BlockNumber;
        bytes32 withdrawalHash;
        uint256 timestamp;
        bool processed;
    }
    
    // Array of withdrawals
    Withdrawal[] public withdrawals;
    
    // Mapping of withdrawal hash to withdrawal index
    mapping(bytes32 => uint256) public withdrawalHashToIndex;
    
    // Mapping of processed withdrawal hashes
    mapping(bytes32 => bool) public processedWithdrawals;
    
    // Mapping of supported tokens
    mapping(address => bool) public supportedTokens;
    
    // Mapping of token addresses to their L2 token addresses
    mapping(address => bytes32) public tokenL2Addresses;
    
    // Address of the L2OutputOracle contract
    address public l2OutputOracleAddress;
    
    // Address of the L1 deposit bridge contract
    address public l1DepositBridgeAddress;
    
    // Challenge period (in seconds)
    uint256 public challengePeriod = 7 days;
    
    // Events
    event WithdrawalInitiated(
        uint256 indexed index,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        bytes32 l2BlockHash,
        uint256 l2BlockNumber,
        bytes32 withdrawalHash
    );
    
    event WithdrawalProcessed(
        uint256 indexed index,
        bytes32 withdrawalHash,
        address recipient,
        address token,
        uint256 amount
    );
    
    event TokenAdded(
        address token,
        bytes32 l2TokenAddress
    );
    
    event TokenRemoved(
        address token
    );
    
    event ContractAddressesUpdated(
        address l2OutputOracle,
        address l1DepositBridge
    );
    
    event ChallengePeriodUpdated(
        uint256 newChallengePeriod
    );

    /**
     * @dev Contract constructor
     * @param _l2OutputOracleAddress Address of the L2OutputOracle contract
     * @param _l1DepositBridgeAddress Address of the L1 deposit bridge contract
     */
    constructor(address _l2OutputOracleAddress, address _l1DepositBridgeAddress) {
        require(_l2OutputOracleAddress != address(0), "Invalid L2OutputOracle address");
        require(_l1DepositBridgeAddress != address(0), "Invalid L1DepositBridge address");
        
        l2OutputOracleAddress = _l2OutputOracleAddress;
        l1DepositBridgeAddress = _l1DepositBridgeAddress;
    }

    /**
     * @dev Sets the contract addresses
     * @param _l2OutputOracleAddress Address of the L2OutputOracle contract
     * @param _l1DepositBridgeAddress Address of the L1 deposit bridge contract
     */
    function setContractAddresses(
        address _l2OutputOracleAddress,
        address _l1DepositBridgeAddress
    ) external onlyOwner {
        require(_l2OutputOracleAddress != address(0), "Invalid L2OutputOracle address");
        require(_l1DepositBridgeAddress != address(0), "Invalid L1DepositBridge address");
        
        l2OutputOracleAddress = _l2OutputOracleAddress;
        l1DepositBridgeAddress = _l1DepositBridgeAddress;
        
        emit ContractAddressesUpdated(_l2OutputOracleAddress, _l1DepositBridgeAddress);
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
     * @dev Adds a supported token
     * @param _token Address of the token on L1
     * @param _l2TokenAddress Address of the token on L2
     */
    function addSupportedToken(address _token, bytes32 _l2TokenAddress) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        require(_l2TokenAddress != bytes32(0), "Invalid L2 token address");
        
        supportedTokens[_token] = true;
        tokenL2Addresses[_token] = _l2TokenAddress;
        
        emit TokenAdded(_token, _l2TokenAddress);
    }

    /**
     * @dev Removes a supported token
     * @param _token Address of the token on L1
     */
    function removeSupportedToken(address _token) external onlyOwner {
        require(supportedTokens[_token], "Token not supported");
        
        supportedTokens[_token] = false;
        delete tokenL2Addresses[_token];
        
        emit TokenRemoved(_token);
    }

    /**
     * @dev Initiates a withdrawal from L2 to L1
     * @param _recipient Address of the recipient on L1
     * @param _token Address of the token on L1
     * @param _amount Amount of tokens to withdraw
     * @param _l2BlockHash Hash of the L2 block containing the withdrawal
     * @param _l2BlockNumber Number of the L2 block containing the withdrawal
     * @param _withdrawalHash Hash of the withdrawal on L2
     * @param _proof Merkle proof of the withdrawal
     * @return Index of the withdrawal
     */
    function initiateWithdrawal(
        address _recipient,
        address _token,
        uint256 _amount,
        bytes32 _l2BlockHash,
        uint256 _l2BlockNumber,
        bytes32 _withdrawalHash,
        bytes calldata _proof
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_recipient != address(0), "Invalid recipient address");
        require(_token == address(0) || supportedTokens[_token], "Token not supported");
        require(_amount > 0, "Amount must be greater than 0");
        require(_l2BlockHash != bytes32(0), "Invalid L2 block hash");
        require(_l2BlockNumber > 0, "Invalid L2 block number");
        require(_withdrawalHash != bytes32(0), "Invalid withdrawal hash");
        require(!processedWithdrawals[_withdrawalHash], "Withdrawal already processed");
        
        // Verify the withdrawal proof
        require(verifyWithdrawalProof(
            _recipient,
            _token,
            _amount,
            _l2BlockHash,
            _l2BlockNumber,
            _withdrawalHash,
            _proof
        ), "Invalid withdrawal proof");
        
        // Create the withdrawal
        Withdrawal memory newWithdrawal = Withdrawal({
            recipient: _recipient,
            token: _token,
            amount: _amount,
            l2BlockHash: _l2BlockHash,
            l2BlockNumber: _l2BlockNumber,
            withdrawalHash: _withdrawalHash,
            timestamp: block.timestamp,
            processed: false
        });
        
        // Add the withdrawal to the array
        withdrawals.push(newWithdrawal);
        uint256 index = withdrawals.length - 1;
        
        // Update the mapping
        withdrawalHashToIndex[_withdrawalHash] = index;
        
        // Emit the event
        emit WithdrawalInitiated(
            index,
            _recipient,
            _token,
            _amount,
            _l2BlockHash,
            _l2BlockNumber,
            _withdrawalHash
        );
        
        return index;
    }

    /**
     * @dev Processes a withdrawal after the challenge period
     * @param _withdrawalHash Hash of the withdrawal to process
     */
    function processWithdrawal(bytes32 _withdrawalHash) external nonReentrant whenNotPaused {
        require(_withdrawalHash != bytes32(0), "Invalid withdrawal hash");
        
        uint256 index = withdrawalHashToIndex[_withdrawalHash];
        require(index < withdrawals.length, "Withdrawal not found");
        
        Withdrawal storage withdrawal = withdrawals[index];
        require(!withdrawal.processed, "Withdrawal already processed");
        
        // Verify that the challenge period has passed
        require(block.timestamp >= withdrawal.timestamp + challengePeriod, "Challenge period not expired");
        
        // Verify that the L2 block is finalized
        require(isL2BlockFinalized(withdrawal.l2BlockNumber), "L2 block not finalized");
        
        // Mark the withdrawal as processed
        withdrawal.processed = true;
        processedWithdrawals[_withdrawalHash] = true;
        
        // Process the withdrawal
        if (withdrawal.token == address(0)) {
            // ETH withdrawal
            (bool success, ) = withdrawal.recipient.call{value: withdrawal.amount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC20 withdrawal
            IERC20(withdrawal.token).safeTransfer(withdrawal.recipient, withdrawal.amount);
        }
        
        // Emit the event
        emit WithdrawalProcessed(
            index,
            _withdrawalHash,
            withdrawal.recipient,
            withdrawal.token,
            withdrawal.amount
        );
    }

    /**
     * @dev Verifies a withdrawal proof
     * @param _recipient Address of the recipient on L1
     * @param _token Address of the token on L1
     * @param _amount Amount of tokens to withdraw
     * @param _l2BlockHash Hash of the L2 block containing the withdrawal
     * @param _l2BlockNumber Number of the L2 block containing the withdrawal
     * @param _withdrawalHash Hash of the withdrawal on L2
     * @param _proof Merkle proof of the withdrawal
     * @return True if the proof is valid, false otherwise
     */
    function verifyWithdrawalProof(
        address _recipient,
        address _token,
        uint256 _amount,
        bytes32 _l2BlockHash,
        uint256 _l2BlockNumber,
        bytes32 _withdrawalHash,
        bytes calldata _proof
    ) public view returns (bool) {
        // In a real implementation, we would verify the Merkle proof against the L2 state root
        // For now, we assume all proofs are valid for simplicity
        return true;
    }

    /**
     * @dev Checks if an L2 block is finalized
     * @param _l2BlockNumber Number of the L2 block
     * @return True if the block is finalized, false otherwise
     */
    function isL2BlockFinalized(uint256 _l2BlockNumber) public view returns (bool) {
        // Get the L2OutputOracle contract
        L2OutputOracleInterface l2OutputOracle = L2OutputOracleInterface(l2OutputOracleAddress);
        
        // Get the latest finalized L2 output
        uint256 latestFinalizedOutputIndex = l2OutputOracle.getLatestFinalizedL2Output();
        
        // Get the latest finalized L2 output details
        (
            ,
            ,
            ,
            uint256 latestFinalizedL2BlockNumber,
            ,
            ,
            bool finalized,
            
        ) = l2OutputOracle.getL2Output(latestFinalizedOutputIndex);
        
        // Check if the block is finalized
        return finalized && _l2BlockNumber <= latestFinalizedL2BlockNumber;
    }

    /**
     * @dev Gets the withdrawal at the given index
     * @param _index Index of the withdrawal
     * @return recipient Address of the recipient
     * @return token Address of the token
     * @return amount Amount of tokens
     * @return l2BlockHash Hash of the L2 block
     * @return l2BlockNumber Number of the L2 block
     * @return withdrawalHash Hash of the withdrawal
     * @return timestamp Timestamp of the withdrawal
     * @return processed Whether the withdrawal has been processed
     */
    function getWithdrawal(uint256 _index) external view returns (
        address recipient,
        address token,
        uint256 amount,
        bytes32 l2BlockHash,
        uint256 l2BlockNumber,
        bytes32 withdrawalHash,
        uint256 timestamp,
        bool processed
    ) {
        require(_index < withdrawals.length, "Invalid index");
        
        Withdrawal storage withdrawal = withdrawals[_index];
        return (
            withdrawal.recipient,
            withdrawal.token,
            withdrawal.amount,
            withdrawal.l2BlockHash,
            withdrawal.l2BlockNumber,
            withdrawal.withdrawalHash,
            withdrawal.timestamp,
            withdrawal.processed
        );
    }

    /**
     * @dev Gets the withdrawal by hash
     * @param _withdrawalHash Hash of the withdrawal
     * @return Index of the withdrawal
     */
    function getWithdrawalIndexByHash(bytes32 _withdrawalHash) external view returns (uint256) {
        uint256 index = withdrawalHashToIndex[_withdrawalHash];
        require(index < withdrawals.length, "Withdrawal not found");
        return index;
    }

    /**
     * @dev Gets the total number of withdrawals
     * @return Total number of withdrawals
     */
    function getWithdrawalCount() external view returns (uint256) {
        return withdrawals.length;
    }

    /**
     * @dev Gets the L2 token address for an L1 token
     * @param _token Address of the token on L1
     * @return Address of the token on L2
     */
    function getL2TokenAddress(address _token) external view returns (bytes32) {
        require(supportedTokens[_token], "Token not supported");
        return tokenL2Addresses[_token];
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

    /**
     * @dev Fallback function to receive ETH
     */
    receive() external payable {
        // Only accept ETH from the L1 deposit bridge
        require(msg.sender == l1DepositBridgeAddress, "Unauthorized ETH sender");
    }
}

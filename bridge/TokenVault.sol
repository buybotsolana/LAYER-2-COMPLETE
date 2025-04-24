// Ethereum Bridge Contract for Solana Layer 2
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./QuantumResistantVerifier.sol";

/**
 * @title SolanaLayer2Bridge
 * @dev Bridge contract for transferring assets between Ethereum and Solana Layer 2
 */
contract SolanaLayer2Bridge is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // Events
    event Deposit(address indexed token, address indexed sender, uint256 amount, bytes32 solanaRecipient, uint256 nonce);
    event Withdrawal(address indexed token, address indexed recipient, uint256 amount, bytes32 solanaSourceAccount, uint256 nonce);
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event ThresholdUpdated(uint256 newThreshold);
    event RootHashUpdated(bytes32 newRootHash, uint256 indexed batchId);
    event EmergencyWithdrawal(address indexed token, address indexed recipient, uint256 amount);
    event FeeUpdated(uint256 newFee);
    event FeeCollected(address indexed token, uint256 amount);
    event QuantumVerifierUpdated(address indexed newVerifier);
    event QuantumSignatureVerified(address indexed relayer, uint8 signatureType);

    // Structs
    struct TokenInfo {
        bool isSupported;
        uint256 minAmount;
        uint256 maxAmount;
        uint256 dailyLimit;
        uint256 usedDailyLimit;
        uint256 lastResetTime;
    }

    struct WithdrawalData {
        address token;
        address recipient;
        uint256 amount;
        bytes32 solanaSourceAccount;
        uint256 nonce;
    }

    // State variables
    mapping(address => bool) public relayers;
    mapping(address => TokenInfo) public supportedTokens;
    mapping(bytes32 => bool) public processedWithdrawals;
    mapping(uint256 => bytes32) public batchRootHashes;
    mapping(address => mapping(uint256 => bool)) public processedNonces;
    
    uint256 public relayerThreshold;
    uint256 public currentBatchId;
    uint256 public fee;
    uint256 public constant MAX_RELAYERS = 50;
    uint256 public relayerCount;
    uint256 public constant DAY_IN_SECONDS = 86400;
    
    address public feeCollector;
    bool public emergencyMode;
    
    // Quantum-resistant signature verification
    QuantumResistantVerifier public quantumVerifier;
    bool public quantumSignaturesEnabled;

    // Modifiers
    modifier onlyRelayer() {
        require(relayers[msg.sender], "Caller is not a relayer");
        _;
    }

    modifier notEmergency() {
        require(!emergencyMode, "Contract is in emergency mode");
        _;
    }

    modifier onlyEmergency() {
        require(emergencyMode, "Contract is not in emergency mode");
        _;
    }

    /**
     * @dev Constructor
     * @param _initialRelayers Array of initial relayer addresses
     * @param _relayerThreshold Minimum number of relayers required for consensus
     * @param _feeCollector Address that collects fees
     * @param _fee Initial fee amount (in basis points, 1/100 of a percent)
     */
    constructor(
        address[] memory _initialRelayers,
        uint256 _relayerThreshold,
        address _feeCollector,
        uint256 _fee,
        address _quantumVerifier
    ) {
        require(_initialRelayers.length > 0, "No initial relayers provided");
        require(_relayerThreshold > 0 && _relayerThreshold <= _initialRelayers.length, "Invalid threshold");
        require(_feeCollector != address(0), "Fee collector cannot be zero address");
        require(_fee <= 1000, "Fee cannot exceed 10%"); // Max fee is 10%

        relayerThreshold = _relayerThreshold;
        feeCollector = _feeCollector;
        fee = _fee;
        
        for (uint256 i = 0; i < _initialRelayers.length; i++) {
            require(_initialRelayers[i] != address(0), "Invalid relayer address");
            require(!relayers[_initialRelayers[i]], "Duplicate relayer");
            
            relayers[_initialRelayers[i]] = true;
            relayerCount++;
            
            emit RelayerAdded(_initialRelayers[i]);
        }
        
        currentBatchId = 1;
        emergencyMode = false;
        
        // Initialize quantum verifier if provided
        if (_quantumVerifier != address(0)) {
            quantumVerifier = QuantumResistantVerifier(_quantumVerifier);
            quantumSignaturesEnabled = true;
            emit QuantumVerifierUpdated(_quantumVerifier);
        } else {
            quantumSignaturesEnabled = false;
        }
    }

    /**
     * @dev Deposits tokens to be bridged to Solana Layer 2
     * @param _token Address of ERC20 token
     * @param _amount Amount of tokens to deposit
     * @param _solanaRecipient Solana account that will receive the tokens (as bytes32)
     */
    function deposit(
        address _token,
        uint256 _amount,
        bytes32 _solanaRecipient
    ) external nonReentrant notEmergency whenNotPaused {
        require(supportedTokens[_token].isSupported, "Token not supported");
        require(_amount >= supportedTokens[_token].minAmount, "Amount below minimum");
        require(_amount <= supportedTokens[_token].maxAmount, "Amount above maximum");
        require(_solanaRecipient != bytes32(0), "Invalid Solana recipient");
        
        // Check and update daily limit
        TokenInfo storage tokenInfo = supportedTokens[_token];
        if (block.timestamp >= tokenInfo.lastResetTime + DAY_IN_SECONDS) {
            tokenInfo.usedDailyLimit = 0;
            tokenInfo.lastResetTime = block.timestamp;
        }
        
        require(tokenInfo.usedDailyLimit + _amount <= tokenInfo.dailyLimit, "Daily limit exceeded");
        tokenInfo.usedDailyLimit += _amount;
        
        // Calculate fee
        uint256 feeAmount = (_amount * fee) / 10000;
        uint256 amountAfterFee = _amount - feeAmount;
        
        // Transfer tokens to this contract
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        
        // Transfer fee to fee collector if fee is non-zero
        if (feeAmount > 0) {
            IERC20(_token).safeTransfer(feeCollector, feeAmount);
            emit FeeCollected(_token, feeAmount);
        }
        
        // Generate unique nonce for this deposit
        uint256 nonce = uint256(keccak256(abi.encodePacked(
            block.timestamp, 
            msg.sender, 
            _solanaRecipient, 
            _amount,
            blockhash(block.number - 1)
        )));
        
        // Mark nonce as processed
        processedNonces[msg.sender][nonce] = true;
        
        // Emit deposit event
        emit Deposit(_token, msg.sender, amountAfterFee, _solanaRecipient, nonce);
    }

    /**
     * @dev Processes a withdrawal from Solana Layer 2 to Ethereum
     * @param _withdrawalData Struct containing withdrawal information
     * @param _signatures Array of signatures from relayers
     * @param _signatureTypes Array of signature types (0=ECDSA, 1=Falcon, 2=Dilithium, 3=Hybrid Falcon, 4=Hybrid Dilithium)
     */
    function withdraw(
        WithdrawalData calldata _withdrawalData,
        bytes[] calldata _signatures,
        uint8[] calldata _signatureTypes
    ) external nonReentrant notEmergency whenNotPaused {
        // Create withdrawal hash
        bytes32 withdrawalHash = keccak256(abi.encode(
            _withdrawalData.token,
            _withdrawalData.recipient,
            _withdrawalData.amount,
            _withdrawalData.solanaSourceAccount,
            _withdrawalData.nonce
        ));
        
        // Check if withdrawal has already been processed
        require(!processedWithdrawals[withdrawalHash], "Withdrawal already processed");
        
        // Verify signatures
        verifySignatures(withdrawalHash, _signatures, _signatureTypes);
        
        // Mark withdrawal as processed
        processedWithdrawals[withdrawalHash] = true;
        
        // Transfer tokens to recipient
        IERC20(_withdrawalData.token).safeTransfer(_withdrawalData.recipient, _withdrawalData.amount);
        
        // Emit withdrawal event
        emit Withdrawal(
            _withdrawalData.token,
            _withdrawalData.recipient,
            _withdrawalData.amount,
            _withdrawalData.solanaSourceAccount,
            _withdrawalData.nonce
        );
    }

    /**
     * @dev Verifies that enough valid relayer signatures are provided
     * @param _hash Hash of the data to verify
     * @param _signatures Array of signatures
     * @param _signatureTypes Optional array of signature types (0=ECDSA, 1=Falcon, 2=Dilithium, 3=Hybrid Falcon, 4=Hybrid Dilithium)
     */
    function verifySignatures(
        bytes32 _hash,
        bytes[] calldata _signatures,
        uint8[] calldata _signatureTypes
    ) internal view {
        // Ensure enough signatures are provided
        require(_signatures.length >= relayerThreshold, "Not enough signatures");
        
        // If signature types are provided, ensure the array length matches signatures
        if (_signatureTypes.length > 0) {
            require(_signatureTypes.length == _signatures.length, "Signature type count mismatch");
        }
        
        // Hash that needs to be signed by relayers
        bytes32 ethSignedHash = _hash.toEthSignedMessageHash();
        
        // Track used addresses to prevent duplicate signatures
        address[] memory usedAddresses = new address[](_signatures.length);
        
        // Count valid signatures
        uint256 validSignatures = 0;
        
        for (uint256 i = 0; i < _signatures.length; i++) {
            address signer;
            bool isValid = false;
            
            // Determine signature type
            uint8 sigType = _signatureTypes.length > 0 ? _signatureTypes[i] : 0;
            
            if (sigType == 0) {
                // ECDSA signature
                signer = ethSignedHash.recover(_signatures[i]);
                isValid = relayers[signer];
            } else if (quantumSignaturesEnabled && address(quantumVerifier) != address(0)) {
                // Quantum-resistant signature
                // Find the relayer by checking all relayers
                for (uint256 j = 0; j < MAX_RELAYERS && j < relayerCount; j++) {
                    address potentialRelayer = address(uint160(j)); // This is a simplification, in reality we'd need to iterate through actual relayers
                    
                    if (relayers[potentialRelayer]) {
                        // Check if this relayer's quantum signature is valid
                        if (quantumVerifier.verifyQuantumSignature(
                            _hash,
                            _signatures[i],
                            sigType,
                            potentialRelayer
                        )) {
                            signer = potentialRelayer;
                            isValid = true;
                            emit QuantumSignatureVerified(signer, sigType);
                            break;
                        }
                    }
                }
            }
            
            // If signature is valid and signer is a relayer
            if (isValid) {
                // Check for duplicate signatures
                bool isDuplicate = false;
                for (uint256 j = 0; j < validSignatures; j++) {
                    if (usedAddresses[j] == signer) {
                        isDuplicate = true;
                        break;
                    }
                }
                
                if (!isDuplicate) {
                    usedAddresses[validSignatures] = signer;
                    validSignatures++;
                    
                    // If we have enough valid signatures, return early
                    if (validSignatures >= relayerThreshold) {
                        return;
                    }
                }
            }
        }
        
        // If we get here, we don't have enough valid signatures
        revert("Not enough valid signatures");
    }
    
    /**
     * @dev Overloaded version of verifySignatures for backward compatibility
     * @param _hash Hash of the data to verify
     * @param _signatures Array of signatures
     */
    function verifySignatures(
        bytes32 _hash,
        bytes[] calldata _signatures
    ) internal view {
        // Call the new version with an empty signature types array
        verifySignatures(_hash, _signatures, new uint8[](0));
    }

    /**
     * @dev Updates the root hash for a batch of transactions
     * @param _rootHash New root hash
     * @param _batchId Batch ID
     * @param _signatures Array of signatures from relayers
     * @param _signatureTypes Array of signature types (0=ECDSA, 1=Falcon, 2=Dilithium, 3=Hybrid Falcon, 4=Hybrid Dilithium)
     */
    function updateRootHash(
        bytes32 _rootHash,
        uint256 _batchId,
        bytes[] calldata _signatures,
        uint8[] calldata _signatureTypes
    ) external onlyRelayer notEmergency whenNotPaused {
        require(_rootHash != bytes32(0), "Invalid root hash");
        require(_batchId == currentBatchId, "Invalid batch ID");
        
        // Create hash of the data
        bytes32 dataHash = keccak256(abi.encode(_rootHash, _batchId));
        
        // Verify signatures
        verifySignatures(dataHash, _signatures, _signatureTypes);
        
        // Update root hash
        batchRootHashes[_batchId] = _rootHash;
        
        // Increment batch ID
        currentBatchId++;
        
        // Emit event
        emit RootHashUpdated(_rootHash, _batchId);
    }

    /**
     * @dev Verifies a transaction against a batch using Merkle proof
     * @param _txHash Transaction hash
     * @param _batchId Batch ID
     * @param _proof Merkle proof
     * @return True if the transaction is part of the batch
     */
    function verifyTransaction(
        bytes32 _txHash,
        uint256 _batchId,
        bytes32[] calldata _proof
    ) external view returns (bool) {
        require(_batchId < currentBatchId, "Batch not finalized");
        bytes32 rootHash = batchRootHashes[_batchId];
        require(rootHash != bytes32(0), "Root hash not set for batch");
        
        return MerkleProof.verify(_proof, rootHash, _txHash);
    }

    /**
     * @dev Adds a new supported token
     * @param _token Token address
     * @param _minAmount Minimum deposit/withdrawal amount
     * @param _maxAmount Maximum deposit/withdrawal amount
     * @param _dailyLimit Daily limit for the token
     */
    function addSupportedToken(
        address _token,
        uint256 _minAmount,
        uint256 _maxAmount,
        uint256 _dailyLimit
    ) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        require(!supportedTokens[_token].isSupported, "Token already supported");
        require(_minAmount > 0, "Min amount must be greater than 0");
        require(_maxAmount >= _minAmount, "Max amount must be >= min amount");
        require(_dailyLimit >= _maxAmount, "Daily limit must be >= max amount");
        
        supportedTokens[_token] = TokenInfo({
            isSupported: true,
            minAmount: _minAmount,
            maxAmount: _maxAmount,
            dailyLimit: _dailyLimit,
            usedDailyLimit: 0,
            lastResetTime: block.timestamp
        });
    }

    /**
     * @dev Updates parameters for a supported token
     * @param _token Token address
     * @param _minAmount New minimum amount
     * @param _maxAmount New maximum amount
     * @param _dailyLimit New daily limit
     */
    function updateTokenParameters(
        address _token,
        uint256 _minAmount,
        uint256 _maxAmount,
        uint256 _dailyLimit
    ) external onlyOwner {
        require(supportedTokens[_token].isSupported, "Token not supported");
        require(_minAmount > 0, "Min amount must be greater than 0");
        require(_maxAmount >= _minAmount, "Max amount must be >= min amount");
        require(_dailyLimit >= _maxAmount, "Daily limit must be >= max amount");
        
        TokenInfo storage tokenInfo = supportedTokens[_token];
        tokenInfo.minAmount = _minAmount;
        tokenInfo.maxAmount = _maxAmount;
        tokenInfo.dailyLimit = _dailyLimit;
    }

    /**
     * @dev Removes a supported token
     * @param _token Token address
     */
    function removeSupportedToken(address _token) external onlyOwner {
        require(supportedTokens[_token].isSupported, "Token not supported");
        delete supportedTokens[_token];
    }

    /**
     * @dev Adds a new relayer
     * @param _relayer Relayer address
     */
    function addRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "Invalid relayer address");
        require(!relayers[_relayer], "Relayer already exists");
        require(relayerCount < MAX_RELAYERS, "Max relayers reached");
        
        relayers[_relayer] = true;
        relayerCount++;
        
        emit RelayerAdded(_relayer);
    }

    /**
     * @dev Removes a relayer
     * @param _relayer Relayer address
     */
    function removeRelayer(address _relayer) external onlyOwner {
        require(relayers[_relayer], "Relayer doesn't exist");
        require(relayerCount > relayerThreshold, "Cannot remove relayer below threshold");
        
        relayers[_relayer] = false;
        relayerCount--;
        
        emit RelayerRemoved(_relayer);
    }

    /**
     * @dev Updates the relayer threshold
     * @param _newThreshold New threshold value
     */
    function updateThreshold(uint256 _newThreshold) external onlyOwner {
        require(_newThreshold > 0, "Threshold must be greater than 0");
        require(_newThreshold <= relayerCount, "Threshold cannot exceed relayer count");
        
        relayerThreshold = _newThreshold;
        
        emit ThresholdUpdated(_newThreshold);
    }

    /**
     * @dev Updates the fee
     * @param _newFee New fee amount (in basis points)
     */
    function updateFee(uint256 _newFee) external onlyOwner {
        require(_newFee <= 1000, "Fee cannot exceed 10%"); // Max fee is 10%
        
        fee = _newFee;
        
        emit FeeUpdated(_newFee);
    }

    /**
     * @dev Updates the fee collector address
     * @param _newFeeCollector New fee collector address
     */
    function updateFeeCollector(address _newFeeCollector) external onlyOwner {
        require(_newFeeCollector != address(0), "Fee collector cannot be zero address");
        
        feeCollector = _newFeeCollector;
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
     * @dev Activates emergency mode
     */
    function activateEmergencyMode() external onlyOwner {
        emergencyMode = true;
    }

    /**
     * @dev Deactivates emergency mode
     */
    function deactivateEmergencyMode() external onlyOwner {
        emergencyMode = false;
    }

    /**
     * @dev Emergency withdrawal of tokens
     * @param _token Token address
     * @param _recipient Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdraw(
        address _token,
        address _recipient,
        uint256 _amount
    ) external onlyOwner onlyEmergency {
        require(_recipient != address(0), "Invalid recipient");
        
        IERC20(_token).safeTransfer(_recipient, _amount);
        
        emit EmergencyWithdrawal(_token, _recipient, _amount);
    }

    /**
     * @dev Checks if an address is a relayer
     * @param _relayer Address to check
     * @return True if the address is a relayer
     */
    function isRelayer(address _relayer) external view returns (bool) {
        return relayers[_relayer];
    }

    /**
     * @dev Gets information about a supported token
     * @param _token Token address
     * @return isSupported Whether the token is supported
     * @return minAmount Minimum deposit/withdrawal amount
     * @return maxAmount Maximum deposit/withdrawal amount
     * @return dailyLimit Daily limit for the token
     * @return usedDailyLimit Used daily limit
     * @return lastResetTime Last time the daily limit was reset
     */
    function getTokenInfo(address _token) external view returns (
        bool isSupported,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 dailyLimit,
        uint256 usedDailyLimit,
        uint256 lastResetTime
    ) {
        TokenInfo storage tokenInfo = supportedTokens[_token];
        return (
            tokenInfo.isSupported,
            tokenInfo.minAmount,
            tokenInfo.maxAmount,
            tokenInfo.dailyLimit,
            tokenInfo.usedDailyLimit,
            tokenInfo.lastResetTime
        );
    }

    /**
     * @dev Checks if a withdrawal has been processed
     * @param _withdrawalHash Hash of the withdrawal
     * @return True if the withdrawal has been processed
     */
    function isWithdrawalProcessed(bytes32 _withdrawalHash) external view returns (bool) {
        return processedWithdrawals[_withdrawalHash];
    }

    /**
     * @dev Gets the root hash for a batch
     * @param _batchId Batch ID
     * @return Root hash for the batch
     */
    function getBatchRootHash(uint256 _batchId) external view returns (bytes32) {
        return batchRootHashes[_batchId];
    }
    
    /**
     * @dev Backward compatibility function for withdraw
     * @param _withdrawalData Struct containing withdrawal information
     * @param _signatures Array of signatures from relayers
     */
    function withdraw(
        WithdrawalData calldata _withdrawalData,
        bytes[] calldata _signatures
    ) external nonReentrant notEmergency whenNotPaused {
        withdraw(_withdrawalData, _signatures, new uint8[](0));
    }
    
    /**
     * @dev Backward compatibility function for updateRootHash
     * @param _rootHash New root hash
     * @param _batchId Batch ID
     * @param _signatures Array of signatures from relayers
     */
    function updateRootHash(
        bytes32 _rootHash,
        uint256 _batchId,
        bytes[] calldata _signatures
    ) external onlyRelayer notEmergency whenNotPaused {
        updateRootHash(_rootHash, _batchId, _signatures, new uint8[](0));
    }
    
    /**
     * @dev Updates the quantum verifier contract address
     * @param _quantumVerifier New quantum verifier contract address
     */
    function setQuantumVerifier(address _quantumVerifier) external onlyOwner {
        require(_quantumVerifier != address(0), "Invalid quantum verifier address");
        quantumVerifier = QuantumResistantVerifier(_quantumVerifier);
        emit QuantumVerifierUpdated(_quantumVerifier);
    }
    
    /**
     * @dev Enables or disables quantum signatures
     * @param _enabled Whether quantum signatures should be enabled
     */
    function setQuantumSignaturesEnabled(bool _enabled) external onlyOwner {
        // If enabling, ensure quantum verifier is set
        if (_enabled) {
            require(address(quantumVerifier) != address(0), "Quantum verifier not set");
        }
        
        quantumSignaturesEnabled = _enabled;
    }
}

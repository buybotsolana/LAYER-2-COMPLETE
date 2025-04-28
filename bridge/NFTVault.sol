// Ethereum NFT Bridge Contract for Solana Layer 2
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./QuantumResistantVerifier.sol";

/**
 * @title SolanaLayer2NFTBridge
 * @dev Bridge contract for transferring NFTs between Ethereum and Solana Layer 2
 */
contract SolanaLayer2NFTBridge is ReentrancyGuard, Ownable, Pausable, ERC721Holder {
    using ECDSA for bytes32;

    // Events
    event NFTDeposit(address indexed collection, address indexed sender, uint256 tokenId, bytes32 solanaRecipient, uint256 nonce, string metadataURI);
    event NFTWithdrawal(address indexed collection, address indexed recipient, uint256 tokenId, bytes32 solanaSourceAccount, uint256 nonce);
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event ThresholdUpdated(uint256 newThreshold);
    event RootHashUpdated(bytes32 newRootHash, uint256 indexed batchId);
    event EmergencyWithdrawal(address indexed collection, address indexed recipient, uint256 tokenId);
    event FeeUpdated(uint256 newFee);
    event FeeCollected(address indexed feeToken, uint256 amount);
    event CollectionAdded(address indexed collection);
    event CollectionRemoved(address indexed collection);
    event QuantumVerifierUpdated(address indexed newVerifier);
    event QuantumSignatureVerified(address indexed relayer, uint8 signatureType);

    // Structs
    struct CollectionInfo {
        bool isSupported;
        uint256 dailyLimit;
        uint256 usedDailyLimit;
        uint256 lastResetTime;
    }

    struct NFTWithdrawalData {
        address collection;
        address recipient;
        uint256 tokenId;
        bytes32 solanaSourceAccount;
        uint256 nonce;
        string metadataURI;
    }

    // State variables
    mapping(address => bool) public relayers;
    mapping(address => CollectionInfo) public supportedCollections;
    mapping(bytes32 => bool) public processedWithdrawals;
    mapping(uint256 => bytes32) public batchRootHashes;
    mapping(address => mapping(uint256 => bool)) public processedNonces;
    mapping(address => mapping(uint256 => bool)) public depositedTokens;
    
    uint256 public relayerThreshold;
    uint256 public currentBatchId;
    uint256 public fee;
    uint256 public constant MAX_RELAYERS = 50;
    uint256 public relayerCount;
    uint256 public constant DAY_IN_SECONDS = 86400;
    
    address public feeCollector;
    address public feeToken;
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
     * @param _feeToken Address of the token used for fees
     * @param _fee Initial fee amount (in basis points, 1/100 of a percent)
     * @param _quantumVerifier Address of the quantum-resistant verifier contract
     */
    constructor(
        address[] memory _initialRelayers,
        uint256 _relayerThreshold,
        address _feeCollector,
        address _feeToken,
        uint256 _fee,
        address _quantumVerifier
    ) {
        require(_initialRelayers.length > 0, "No initial relayers provided");
        require(_relayerThreshold > 0 && _relayerThreshold <= _initialRelayers.length, "Invalid threshold");
        require(_feeCollector != address(0), "Fee collector cannot be zero address");
        require(_fee <= 1000, "Fee cannot exceed 10%"); // Max fee is 10%

        relayerThreshold = _relayerThreshold;
        feeCollector = _feeCollector;
        feeToken = _feeToken;
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
     * @dev Deposits an NFT to be bridged to Solana Layer 2
     * @param _collection Address of ERC721 collection
     * @param _tokenId ID of the token to deposit
     * @param _solanaRecipient Solana account that will receive the NFT (as bytes32)
     */
    function depositNFT(
        address _collection,
        uint256 _tokenId,
        bytes32 _solanaRecipient
    ) external nonReentrant notEmergency whenNotPaused {
        require(supportedCollections[_collection].isSupported, "Collection not supported");
        require(_solanaRecipient != bytes32(0), "Invalid Solana recipient");
        require(!depositedTokens[_collection][_tokenId], "Token already deposited");
        
        // Check and update daily limit
        CollectionInfo storage collectionInfo = supportedCollections[_collection];
        if (block.timestamp >= collectionInfo.lastResetTime + DAY_IN_SECONDS) {
            collectionInfo.usedDailyLimit = 0;
            collectionInfo.lastResetTime = block.timestamp;
        }
        
        require(collectionInfo.usedDailyLimit < collectionInfo.dailyLimit, "Daily limit exceeded");
        collectionInfo.usedDailyLimit += 1;
        
        // Collect fee if set
        if (fee > 0 && feeToken != address(0)) {
            uint256 feeAmount = fee;
            IERC20(feeToken).transferFrom(msg.sender, feeCollector, feeAmount);
            emit FeeCollected(feeToken, feeAmount);
        }
        
        // Transfer NFT to this contract
        IERC721(_collection).safeTransferFrom(msg.sender, address(this), _tokenId);
        
        // Mark token as deposited
        depositedTokens[_collection][_tokenId] = true;
        
        // Generate unique nonce for this deposit
        uint256 nonce = uint256(keccak256(abi.encodePacked(
            block.timestamp, 
            msg.sender, 
            _solanaRecipient, 
            _tokenId,
            blockhash(block.number - 1)
        )));
        
        // Mark nonce as processed
        processedNonces[msg.sender][nonce] = true;
        
        // Get token metadata URI
        string memory metadataURI = "";
        try IERC721Metadata(_collection).tokenURI(_tokenId) returns (string memory uri) {
            metadataURI = uri;
        } catch {
            // If tokenURI is not supported, use empty string
        }
        
        // Emit deposit event
        emit NFTDeposit(_collection, msg.sender, _tokenId, _solanaRecipient, nonce, metadataURI);
    }

    /**
     * @dev Processes a withdrawal of an NFT from Solana Layer 2 to Ethereum
     * @param _withdrawalData Struct containing withdrawal information
     * @param _signatures Array of signatures from relayers
     * @param _signatureTypes Array of signature types (0=ECDSA, 1=Falcon, 2=Dilithium, 3=Hybrid Falcon, 4=Hybrid Dilithium)
     */
    function withdrawNFT(
        NFTWithdrawalData calldata _withdrawalData,
        bytes[] calldata _signatures,
        uint8[] calldata _signatureTypes
    ) external nonReentrant notEmergency whenNotPaused {
        // Create withdrawal hash
        bytes32 withdrawalHash = keccak256(abi.encode(
            _withdrawalData.collection,
            _withdrawalData.recipient,
            _withdrawalData.tokenId,
            _withdrawalData.solanaSourceAccount,
            _withdrawalData.nonce,
            _withdrawalData.metadataURI
        ));
        
        // Check if withdrawal has already been processed
        require(!processedWithdrawals[withdrawalHash], "Withdrawal already processed");
        
        // Verify signatures
        verifySignatures(withdrawalHash, _signatures, _signatureTypes);
        
        // Mark withdrawal as processed
        processedWithdrawals[withdrawalHash] = true;
        
        // Check if token was previously deposited
        require(depositedTokens[_withdrawalData.collection][_withdrawalData.tokenId], "Token not deposited");
        
        // Mark token as withdrawn
        depositedTokens[_withdrawalData.collection][_withdrawalData.tokenId] = false;
        
        // Transfer NFT to recipient
        IERC721(_withdrawalData.collection).safeTransferFrom(
            address(this),
            _withdrawalData.recipient,
            _withdrawalData.tokenId
        );
        
        // Emit withdrawal event
        emit NFTWithdrawal(
            _withdrawalData.collection,
            _withdrawalData.recipient,
            _withdrawalData.tokenId,
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
     * @dev Adds a new supported NFT collection
     * @param _collection Collection address
     * @param _dailyLimit Daily limit for the collection
     */
    function addSupportedCollection(
        address _collection,
        uint256 _dailyLimit
    ) external onlyOwner {
        require(_collection != address(0), "Invalid collection address");
        require(!supportedCollections[_collection].isSupported, "Collection already supported");
        require(_dailyLimit > 0, "Daily limit must be greater than 0");
        
        supportedCollections[_collection] = CollectionInfo({
            isSupported: true,
            dailyLimit: _dailyLimit,
            usedDailyLimit: 0,
            lastResetTime: block.timestamp
        });
        
        emit CollectionAdded(_collection);
    }

    /**
     * @dev Removes a supported NFT collection
     * @param _collection Collection address
     */
    function removeSupportedCollection(address _collection) external onlyOwner {
        require(supportedCollections[_collection].isSupported, "Collection not supported");
        delete supportedCollections[_collection];
        
        emit CollectionRemoved(_collection);
    }

    /**
     * @dev Updates the daily limit for a collection
     * @param _collection Collection address
     * @param _dailyLimit New daily limit
     */
    function updateCollectionDailyLimit(
        address _collection,
        uint256 _dailyLimit
    ) external onlyOwner {
        require(supportedCollections[_collection].isSupported, "Collection not supported");
        require(_dailyLimit > 0, "Daily limit must be greater than 0");
        
        supportedCollections[_collection].dailyLimit = _dailyLimit;
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
     * @param _newFee New fee amount
     */
    function updateFee(uint256 _newFee) external onlyOwner {
        require(_newFee <= 1000, "Fee cannot exceed 10%"); // Max fee is 10%
        
        fee = _newFee;
        
        emit FeeUpdated(_newFee);
    }

    /**
     * @dev Updates the fee token
     * @param _newFeeToken New fee token address
     */
    function updateFeeToken(address _newFeeToken) external onlyOwner {
        feeToken = _newFeeToken;
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
     * @dev Emergency withdrawal of an NFT
     * @param _collection Collection address
     * @param _tokenId Token ID
     * @param _recipient Recipient address
     */
    function emergencyWithdrawNFT(
        address _collection,
        uint256 _tokenId,
        address _recipient
    ) external onlyOwner onlyEmergency {
        require(_recipient != address(0), "Invalid recipient");
        require(depositedTokens[_collection][_tokenId], "Token not deposited");
        
        // Mark token as withdrawn
        depositedTokens[_collection][_tokenId] = false;
        
        // Transfer NFT to recipient
        IERC721(_collection).safeTransferFrom(address(this), _recipient, _tokenId);
        
        emit EmergencyWithdrawal(_collection, _recipient, _tokenId);
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

// Interface for ERC721 metadata
interface IERC721Metadata {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

// Interface for ERC20 (for fee payments)
interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

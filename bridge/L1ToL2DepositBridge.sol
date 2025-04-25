// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title L1ToL2DepositBridge
 * @dev Contract for handling deposits from Ethereum (L1) to Solana Layer-2
 * This contract locks assets on L1 and emits events that are picked up by the L2 system
 * to mint corresponding assets on L2.
 */
contract L1ToL2DepositBridge is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Structure to store deposit information
    struct Deposit {
        address sender;
        address token;
        uint256 amount;
        bytes32 l2Recipient;
        uint256 timestamp;
        bytes32 depositHash;
        bool processed;
    }
    
    // Array of deposits
    Deposit[] public deposits;
    
    // Mapping of deposit hash to deposit index
    mapping(bytes32 => uint256) public depositHashToIndex;
    
    // Mapping of supported tokens
    mapping(address => bool) public supportedTokens;
    
    // Mapping of token addresses to their L2 token addresses
    mapping(address => bytes32) public tokenL2Addresses;
    
    // Address of the L2 bridge contract on Solana
    bytes32 public l2BridgeAddress;
    
    // Events
    event DepositInitiated(
        uint256 indexed index,
        address indexed sender,
        address indexed token,
        uint256 amount,
        bytes32 l2Recipient,
        bytes32 depositHash
    );
    
    event DepositProcessed(
        uint256 indexed index,
        bytes32 depositHash
    );
    
    event TokenAdded(
        address token,
        bytes32 l2TokenAddress
    );
    
    event TokenRemoved(
        address token
    );
    
    event L2BridgeAddressUpdated(
        bytes32 l2BridgeAddress
    );

    /**
     * @dev Contract constructor
     * @param _l2BridgeAddress Address of the L2 bridge contract on Solana
     */
    constructor(bytes32 _l2BridgeAddress) {
        require(_l2BridgeAddress != bytes32(0), "Invalid L2 bridge address");
        l2BridgeAddress = _l2BridgeAddress;
    }

    /**
     * @dev Sets the L2 bridge address
     * @param _l2BridgeAddress Address of the L2 bridge contract on Solana
     */
    function setL2BridgeAddress(bytes32 _l2BridgeAddress) external onlyOwner {
        require(_l2BridgeAddress != bytes32(0), "Invalid L2 bridge address");
        l2BridgeAddress = _l2BridgeAddress;
        emit L2BridgeAddressUpdated(_l2BridgeAddress);
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
     * @dev Deposits ETH to L2
     * @param _l2Recipient Address of the recipient on L2
     * @return Index of the deposit
     */
    function depositETH(bytes32 _l2Recipient) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value > 0, "Amount must be greater than 0");
        require(_l2Recipient != bytes32(0), "Invalid L2 recipient");
        
        // Generate a unique deposit hash
        bytes32 depositHash = keccak256(abi.encodePacked(
            msg.sender,
            address(0), // ETH is represented as address(0)
            msg.value,
            _l2Recipient,
            block.timestamp,
            deposits.length
        ));
        
        // Create the deposit
        Deposit memory newDeposit = Deposit({
            sender: msg.sender,
            token: address(0), // ETH is represented as address(0)
            amount: msg.value,
            l2Recipient: _l2Recipient,
            timestamp: block.timestamp,
            depositHash: depositHash,
            processed: false
        });
        
        // Add the deposit to the array
        deposits.push(newDeposit);
        uint256 index = deposits.length - 1;
        
        // Update the mapping
        depositHashToIndex[depositHash] = index;
        
        // Emit the event
        emit DepositInitiated(
            index,
            msg.sender,
            address(0),
            msg.value,
            _l2Recipient,
            depositHash
        );
        
        return index;
    }

    /**
     * @dev Deposits ERC20 tokens to L2
     * @param _token Address of the token on L1
     * @param _amount Amount of tokens to deposit
     * @param _l2Recipient Address of the recipient on L2
     * @return Index of the deposit
     */
    function depositERC20(
        address _token,
        uint256 _amount,
        bytes32 _l2Recipient
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_token != address(0), "Invalid token address");
        require(supportedTokens[_token], "Token not supported");
        require(_amount > 0, "Amount must be greater than 0");
        require(_l2Recipient != bytes32(0), "Invalid L2 recipient");
        
        // Transfer the tokens from the sender to this contract
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        
        // Generate a unique deposit hash
        bytes32 depositHash = keccak256(abi.encodePacked(
            msg.sender,
            _token,
            _amount,
            _l2Recipient,
            block.timestamp,
            deposits.length
        ));
        
        // Create the deposit
        Deposit memory newDeposit = Deposit({
            sender: msg.sender,
            token: _token,
            amount: _amount,
            l2Recipient: _l2Recipient,
            timestamp: block.timestamp,
            depositHash: depositHash,
            processed: false
        });
        
        // Add the deposit to the array
        deposits.push(newDeposit);
        uint256 index = deposits.length - 1;
        
        // Update the mapping
        depositHashToIndex[depositHash] = index;
        
        // Emit the event
        emit DepositInitiated(
            index,
            msg.sender,
            _token,
            _amount,
            _l2Recipient,
            depositHash
        );
        
        return index;
    }

    /**
     * @dev Marks a deposit as processed (called by the L2 system)
     * @param _depositHash Hash of the deposit
     */
    function markDepositProcessed(bytes32 _depositHash) external onlyOwner nonReentrant {
        require(_depositHash != bytes32(0), "Invalid deposit hash");
        
        uint256 index = depositHashToIndex[_depositHash];
        require(index < deposits.length, "Deposit not found");
        require(!deposits[index].processed, "Deposit already processed");
        
        // Mark the deposit as processed
        deposits[index].processed = true;
        
        // Emit the event
        emit DepositProcessed(index, _depositHash);
    }

    /**
     * @dev Gets the deposit at the given index
     * @param _index Index of the deposit
     * @return sender Address of the sender
     * @return token Address of the token
     * @return amount Amount of tokens
     * @return l2Recipient Address of the recipient on L2
     * @return timestamp Timestamp of the deposit
     * @return depositHash Hash of the deposit
     * @return processed Whether the deposit has been processed
     */
    function getDeposit(uint256 _index) external view returns (
        address sender,
        address token,
        uint256 amount,
        bytes32 l2Recipient,
        uint256 timestamp,
        bytes32 depositHash,
        bool processed
    ) {
        require(_index < deposits.length, "Invalid index");
        
        Deposit storage deposit = deposits[_index];
        return (
            deposit.sender,
            deposit.token,
            deposit.amount,
            deposit.l2Recipient,
            deposit.timestamp,
            deposit.depositHash,
            deposit.processed
        );
    }

    /**
     * @dev Gets the deposit by hash
     * @param _depositHash Hash of the deposit
     * @return Index of the deposit
     */
    function getDepositIndexByHash(bytes32 _depositHash) external view returns (uint256) {
        uint256 index = depositHashToIndex[_depositHash];
        require(index < deposits.length, "Deposit not found");
        return index;
    }

    /**
     * @dev Gets the total number of deposits
     * @return Total number of deposits
     */
    function getDepositCount() external view returns (uint256) {
        return deposits.length;
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
        // Only accept ETH from direct transfers
        require(msg.sender != tx.origin, "Direct ETH transfers not allowed");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title TokenBridge
 * @dev Bridge per trasferire token tra Ethereum e Solana
 * Questo contratto gestisce i depositi di token ERC20 da Ethereum a Solana
 */
contract TokenBridge is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // Struttura per memorizzare le informazioni di un token
    struct TokenInfo {
        bool isSupported;
        uint256 minAmount;
        uint256 maxAmount;
        uint256 dailyLimit;
        uint256 usedDailyLimit;
        uint256 lastResetTime;
        uint256 fee;
        uint256 collectedFees;
    }

    // Struttura per memorizzare le informazioni di un deposito
    struct Deposit {
        address token;
        address sender;
        bytes32 recipient; // Indirizzo Solana
        uint256 amount;
        uint256 timestamp;
        bytes32 transactionHash;
        bool processed;
    }

    // Struttura per memorizzare le informazioni di un prelievo
    struct Withdrawal {
        address token;
        address recipient;
        bytes32 sender; // Indirizzo Solana
        uint256 amount;
        uint256 timestamp;
        bytes32 transactionHash;
        bool processed;
    }

    // Mappatura dei token supportati
    mapping(address => TokenInfo) public supportedTokens;
    
    // Mappatura dei depositi per ID
    mapping(bytes32 => Deposit) public deposits;
    
    // Mappatura dei prelievi per ID
    mapping(bytes32 => Withdrawal) public withdrawals;
    
    // Array degli ID dei depositi
    bytes32[] public depositIds;
    
    // Array degli ID dei prelievi
    bytes32[] public withdrawalIds;
    
    // Contatore dei depositi
    uint256 public depositCount;
    
    // Contatore dei prelievi
    uint256 public withdrawalCount;
    
    // Radice dell'albero di Merkle per i prelievi
    bytes32 public withdrawalMerkleRoot;
    
    // Periodo di reset del limite giornaliero (1 giorno)
    uint256 public constant DAILY_LIMIT_PERIOD = 1 days;
    
    // Periodo di blocco per i prelievi (1 ora)
    uint256 public constant WITHDRAWAL_LOCK_PERIOD = 1 hours;
    
    // Indirizzo del validatore
    address public validator;
    
    // Soglia di conferme per i prelievi
    uint256 public withdrawalThreshold;
    
    // Mappatura delle conferme per i prelievi
    mapping(bytes32 => mapping(address => bool)) public withdrawalConfirmations;
    
    // Array dei validatori
    address[] public validators;
    
    // Mappatura dei validatori
    mapping(address => bool) public isValidator;
    
    // Eventi
    event TokenAdded(address indexed token, uint256 minAmount, uint256 maxAmount, uint256 dailyLimit, uint256 fee);
    event TokenRemoved(address indexed token);
    event TokenUpdated(address indexed token, uint256 minAmount, uint256 maxAmount, uint256 dailyLimit, uint256 fee);
    event Deposited(bytes32 indexed id, address indexed token, address indexed sender, bytes32 recipient, uint256 amount, uint256 fee);
    event WithdrawalInitiated(bytes32 indexed id, address indexed token, address indexed recipient, bytes32 sender, uint256 amount);
    event WithdrawalConfirmed(bytes32 indexed id, address indexed validator);
    event WithdrawalProcessed(bytes32 indexed id, address indexed token, address indexed recipient, uint256 amount);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event WithdrawalThresholdUpdated(uint256 threshold);
    event FeesCollected(address indexed token, address indexed recipient, uint256 amount);
    event MerkleRootUpdated(bytes32 merkleRoot);

    /**
     * @dev Costruttore
     * @param _validator Indirizzo del validatore iniziale
     */
    constructor(address _validator) {
        require(_validator != address(0), "Invalid validator address");
        validator = _validator;
        validators.push(_validator);
        isValidator[_validator] = true;
        withdrawalThreshold = 1; // Inizialmente, solo un validatore è richiesto
    }

    /**
     * @dev Modifica per verificare che il chiamante sia un validatore
     */
    modifier onlyValidator() {
        require(isValidator[msg.sender], "Caller is not a validator");
        _;
    }

    /**
     * @dev Aggiunge un token supportato
     * @param _token Indirizzo del token
     * @param _minAmount Importo minimo per i depositi
     * @param _maxAmount Importo massimo per i depositi
     * @param _dailyLimit Limite giornaliero per i depositi
     * @param _fee Commissione per i depositi (in percentuale, con 2 decimali)
     */
    function addToken(
        address _token,
        uint256 _minAmount,
        uint256 _maxAmount,
        uint256 _dailyLimit,
        uint256 _fee
    ) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        require(!supportedTokens[_token].isSupported, "Token already supported");
        require(_minAmount > 0, "Min amount must be greater than 0");
        require(_maxAmount >= _minAmount, "Max amount must be greater than or equal to min amount");
        require(_dailyLimit >= _maxAmount, "Daily limit must be greater than or equal to max amount");
        require(_fee <= 1000, "Fee must be less than or equal to 10%");

        supportedTokens[_token] = TokenInfo({
            isSupported: true,
            minAmount: _minAmount,
            maxAmount: _maxAmount,
            dailyLimit: _dailyLimit,
            usedDailyLimit: 0,
            lastResetTime: block.timestamp,
            fee: _fee,
            collectedFees: 0
        });

        emit TokenAdded(_token, _minAmount, _maxAmount, _dailyLimit, _fee);
    }

    /**
     * @dev Rimuove un token supportato
     * @param _token Indirizzo del token
     */
    function removeToken(address _token) external onlyOwner {
        require(supportedTokens[_token].isSupported, "Token not supported");

        delete supportedTokens[_token];

        emit TokenRemoved(_token);
    }

    /**
     * @dev Aggiorna le informazioni di un token
     * @param _token Indirizzo del token
     * @param _minAmount Importo minimo per i depositi
     * @param _maxAmount Importo massimo per i depositi
     * @param _dailyLimit Limite giornaliero per i depositi
     * @param _fee Commissione per i depositi (in percentuale, con 2 decimali)
     */
    function updateToken(
        address _token,
        uint256 _minAmount,
        uint256 _maxAmount,
        uint256 _dailyLimit,
        uint256 _fee
    ) external onlyOwner {
        require(supportedTokens[_token].isSupported, "Token not supported");
        require(_minAmount > 0, "Min amount must be greater than 0");
        require(_maxAmount >= _minAmount, "Max amount must be greater than or equal to min amount");
        require(_dailyLimit >= _maxAmount, "Daily limit must be greater than or equal to max amount");
        require(_fee <= 1000, "Fee must be less than or equal to 10%");

        TokenInfo storage tokenInfo = supportedTokens[_token];
        tokenInfo.minAmount = _minAmount;
        tokenInfo.maxAmount = _maxAmount;
        tokenInfo.dailyLimit = _dailyLimit;
        tokenInfo.fee = _fee;

        emit TokenUpdated(_token, _minAmount, _maxAmount, _dailyLimit, _fee);
    }

    /**
     * @dev Deposita token da Ethereum a Solana
     * @param _token Indirizzo del token
     * @param _amount Importo da depositare
     * @param _recipient Indirizzo del destinatario su Solana
     */
    function deposit(
        address _token,
        uint256 _amount,
        bytes32 _recipient
    ) external nonReentrant whenNotPaused {
        require(supportedTokens[_token].isSupported, "Token not supported");
        require(_recipient != bytes32(0), "Invalid recipient");
        
        TokenInfo storage tokenInfo = supportedTokens[_token];
        
        // Verifica i limiti
        require(_amount >= tokenInfo.minAmount, "Amount below minimum");
        require(_amount <= tokenInfo.maxAmount, "Amount above maximum");
        
        // Resetta il limite giornaliero se necessario
        if (block.timestamp >= tokenInfo.lastResetTime + DAILY_LIMIT_PERIOD) {
            tokenInfo.usedDailyLimit = 0;
            tokenInfo.lastResetTime = block.timestamp;
        }
        
        // Verifica il limite giornaliero
        require(tokenInfo.usedDailyLimit + _amount <= tokenInfo.dailyLimit, "Daily limit exceeded");
        
        // Calcola la commissione
        uint256 fee = (_amount * tokenInfo.fee) / 10000;
        uint256 amountAfterFee = _amount - fee;
        
        // Aggiorna il limite giornaliero
        tokenInfo.usedDailyLimit += _amount;
        
        // Aggiorna le commissioni raccolte
        tokenInfo.collectedFees += fee;
        
        // Genera l'ID del deposito
        bytes32 depositId = keccak256(abi.encodePacked(
            _token,
            msg.sender,
            _recipient,
            _amount,
            block.timestamp,
            depositCount
        ));
        
        // Memorizza il deposito
        deposits[depositId] = Deposit({
            token: _token,
            sender: msg.sender,
            recipient: _recipient,
            amount: _amount,
            timestamp: block.timestamp,
            transactionHash: bytes32(0),
            processed: false
        });
        
        // Aggiunge l'ID del deposito all'array
        depositIds.push(depositId);
        
        // Incrementa il contatore dei depositi
        depositCount++;
        
        // Trasferisce i token al contratto
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        
        emit Deposited(depositId, _token, msg.sender, _recipient, _amount, fee);
    }

    /**
     * @dev Inizia un prelievo da Solana a Ethereum
     * @param _token Indirizzo del token
     * @param _recipient Indirizzo del destinatario su Ethereum
     * @param _amount Importo da prelevare
     * @param _sender Indirizzo del mittente su Solana
     * @param _solanaTransactionHash Hash della transazione su Solana
     */
    function initiateWithdrawal(
        address _token,
        address _recipient,
        uint256 _amount,
        bytes32 _sender,
        bytes32 _solanaTransactionHash
    ) external onlyValidator nonReentrant whenNotPaused {
        require(supportedTokens[_token].isSupported, "Token not supported");
        require(_recipient != address(0), "Invalid recipient");
        require(_sender != bytes32(0), "Invalid sender");
        require(_amount > 0, "Amount must be greater than 0");
        
        // Genera l'ID del prelievo
        bytes32 withdrawalId = keccak256(abi.encodePacked(
            _token,
            _recipient,
            _sender,
            _amount,
            block.timestamp,
            withdrawalCount
        ));
        
        // Verifica che il prelievo non esista già
        require(withdrawals[withdrawalId].timestamp == 0, "Withdrawal already exists");
        
        // Memorizza il prelievo
        withdrawals[withdrawalId] = Withdrawal({
            token: _token,
            recipient: _recipient,
            sender: _sender,
            amount: _amount,
            timestamp: block.timestamp,
            transactionHash: _solanaTransactionHash,
            processed: false
        });
        
        // Aggiunge l'ID del prelievo all'array
        withdrawalIds.push(withdrawalId);
        
        // Incrementa il contatore dei prelievi
        withdrawalCount++;
        
        // Aggiunge la conferma del validatore
        withdrawalConfirmations[withdrawalId][msg.sender] = true;
        
        emit WithdrawalInitiated(withdrawalId, _token, _recipient, _sender, _amount);
        emit WithdrawalConfirmed(withdrawalId, msg.sender);
        
        // Processa il prelievo se la soglia è 1
        if (withdrawalThreshold == 1) {
            processWithdrawal(withdrawalId);
        }
    }

    /**
     * @dev Conferma un prelievo
     * @param _withdrawalId ID del prelievo
     */
    function confirmWithdrawal(bytes32 _withdrawalId) external onlyValidator nonReentrant whenNotPaused {
        Withdrawal storage withdrawal = withdrawals[_withdrawalId];
        
        require(withdrawal.timestamp > 0, "Withdrawal does not exist");
        require(!withdrawal.processed, "Withdrawal already processed");
        require(!withdrawalConfirmations[_withdrawalId][msg.sender], "Already confirmed");
        
        // Aggiunge la conferma del validatore
        withdrawalConfirmations[_withdrawalId][msg.sender] = true;
        
        emit WithdrawalConfirmed(_withdrawalId, msg.sender);
        
        // Conta le conferme
        uint256 confirmations = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            if (withdrawalConfirmations[_withdrawalId][validators[i]]) {
                confirmations++;
            }
        }
        
        // Processa il prelievo se la soglia è raggiunta
        if (confirmations >= withdrawalThreshold) {
            processWithdrawal(_withdrawalId);
        }
    }

    /**
     * @dev Processa un prelievo
     * @param _withdrawalId ID del prelievo
     */
    function processWithdrawal(bytes32 _withdrawalId) internal {
        Withdrawal storage withdrawal = withdrawals[_withdrawalId];
        
        require(withdrawal.timestamp > 0, "Withdrawal does not exist");
        require(!withdrawal.processed, "Withdrawal already processed");
        require(block.timestamp >= withdrawal.timestamp + WITHDRAWAL_LOCK_PERIOD, "Withdrawal lock period not elapsed");
        
        // Marca il prelievo come processato
        withdrawal.processed = true;
        
        // Trasferisce i token al destinatario
        IERC20(withdrawal.token).safeTransfer(withdrawal.recipient, withdrawal.amount);
        
        emit WithdrawalProcessed(_withdrawalId, withdrawal.token, withdrawal.recipient, withdrawal.amount);
    }

    /**
     * @dev Aggiunge un validatore
     * @param _validator Indirizzo del validatore
     */
    function addValidator(address _validator) external onlyOwner {
        require(_validator != address(0), "Invalid validator address");
        require(!isValidator[_validator], "Validator already exists");
        
        validators.push(_validator);
        isValidator[_validator] = true;
        
        emit ValidatorAdded(_validator);
        
        // Aggiorna la soglia se necessario
        if (withdrawalThreshold > validators.length) {
            withdrawalThreshold = validators.length;
            emit WithdrawalThresholdUpdated(withdrawalThreshold);
        }
    }

    /**
     * @dev Rimuove un validatore
     * @param _validator Indirizzo del validatore
     */
    function removeValidator(address _validator) external onlyOwner {
        require(isValidator[_validator], "Validator does not exist");
        require(validators.length > 1, "Cannot remove the last validator");
        
        // Rimuove il validatore dall'array
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == _validator) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                break;
            }
        }
        
        isValidator[_validator] = false;
        
        emit ValidatorRemoved(_validator);
        
        // Aggiorna la soglia se necessario
        if (withdrawalThreshold > validators.length) {
            withdrawalThreshold = validators.length;
            emit WithdrawalThresholdUpdated(withdrawalThreshold);
        }
    }

    /**
     * @dev Imposta la soglia di conferme per i prelievi
     * @param _threshold Nuova soglia
     */
    function setWithdrawalThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0, "Threshold must be greater than 0");
        require(_threshold <= validators.length, "Threshold must be less than or equal to the number of validators");
        
        withdrawalThreshold = _threshold;
        
        emit WithdrawalThresholdUpdated(_threshold);
    }

    /**
     * @dev Raccoglie le commissioni
     * @param _token Indirizzo del token
     * @param _recipient Indirizzo del destinatario
     */
    function collectFees(address _token, address _recipient) external onlyOwner {
        require(supportedTokens[_token].isSupported, "Token not supported");
        require(_recipient != address(0), "Invalid recipient");
        
        TokenInfo storage tokenInfo = supportedTokens[_token];
        uint256 amount = tokenInfo.collectedFees;
        
        require(amount > 0, "No fees to collect");
        
        // Resetta le commissioni raccolte
        tokenInfo.collectedFees = 0;
        
        // Trasferisce le commissioni al destinatario
        IERC20(_token).safeTransfer(_recipient, amount);
        
        emit FeesCollected(_token, _recipient, amount);
    }

    /**
     * @dev Imposta la radice dell'albero di Merkle per i prelievi
     * @param _merkleRoot Nuova radice
     */
    function setWithdrawalMerkleRoot(bytes32 _merkleRoot) external onlyValidator {
        require(_merkleRoot != bytes32(0), "Invalid merkle root");
        
        withdrawalMerkleRoot = _merkleRoot;
        
        emit MerkleRootUpdated(_merkleRoot);
    }

    /**
     * @dev Verifica una prova di Merkle per un prelievo
     * @param _withdrawalId ID del prelievo
     * @param _proof Prova di Merkle
     * @return True se la prova è valida
     */
    function verifyWithdrawalProof(bytes32 _withdrawalId, bytes32[] calldata _proof) external view returns (bool) {
        require(withdrawalMerkleRoot != bytes32(0), "Merkle root not set");
        
        return MerkleProof.verify(_proof, withdrawalMerkleRoot, _withdrawalId);
    }

    /**
     * @dev Mette in pausa il contratto
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Riprende il contratto
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Ottiene il numero di depositi
     * @return Numero di depositi
     */
    function getDepositCount() external view returns (uint256) {
        return depositCount;
    }

    /**
     * @dev Ottiene il numero di prelievi
     * @return Numero di prelievi
     */
    function getWithdrawalCount() external view returns (uint256) {
        return withdrawalCount;
    }

    /**
     * @dev Ottiene il numero di validatori
     * @return Numero di validatori
     */
    function getValidatorCount() external view returns (uint256) {
        return validators.length;
    }

    /**
     * @dev Ottiene il numero di conferme per un prelievo
     * @param _withdrawalId ID del prelievo
     * @return Numero di conferme
     */
    function getWithdrawalConfirmationCount(bytes32 _withdrawalId) external view returns (uint256) {
        uint256 confirmations = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            if (withdrawalConfirmations[_withdrawalId][validators[i]]) {
                confirmations++;
            }
        }
        return confirmations;
    }

    /**
     * @dev Ottiene i depositi per un utente
     * @param _user Indirizzo dell'utente
     * @return Array degli ID dei depositi
     */
    function getDepositsByUser(address _user) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < depositIds.length; i++) {
            if (deposits[depositIds[i]].sender == _user) {
                count++;
            }
        }
        
        bytes32[] memory userDepositIds = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < depositIds.length; i++) {
            if (deposits[depositIds[i]].sender == _user) {
                userDepositIds[index] = depositIds[i];
                index++;
            }
        }
        
        return userDepositIds;
    }

    /**
     * @dev Ottiene i prelievi per un utente
     * @param _user Indirizzo dell'utente
     * @return Array degli ID dei prelievi
     */
    function getWithdrawalsByUser(address _user) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < withdrawalIds.length; i++) {
            if (withdrawals[withdrawalIds[i]].recipient == _user) {
                count++;
            }
        }
        
        bytes32[] memory userWithdrawalIds = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < withdrawalIds.length; i++) {
            if (withdrawals[withdrawalIds[i]].recipient == _user) {
                userWithdrawalIds[index] = withdrawalIds[i];
                index++;
            }
        }
        
        return userWithdrawalIds;
    }
}

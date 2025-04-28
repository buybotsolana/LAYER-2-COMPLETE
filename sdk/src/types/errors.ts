/**
 * Error codes for the Layer 2 SDK
 */
export enum ErrorCode {
  UNKNOWN_ERROR = 'unknown_error',
  INVALID_CONFIG = 'invalid_config',
  NETWORK_ERROR = 'network_error',
  
  NO_WALLET_OR_KEYPAIR = 'no_wallet_or_keypair',
  WALLET_NOT_CONNECTED = 'wallet_not_connected',
  WALLET_SIGN_NOT_SUPPORTED = 'wallet_sign_not_supported',
  
  DEPOSIT_FAILED = 'deposit_failed',
  WITHDRAW_FAILED = 'withdraw_failed',
  GET_OPERATION_STATUS_FAILED = 'get_operation_status_failed',
  GET_OPERATION_HISTORY_FAILED = 'get_operation_history_failed',
  
  TRANSACTION_FAILED = 'transaction_failed',
  TRANSACTION_NOT_FOUND = 'transaction_not_found',
  GET_TRANSACTION_HISTORY_FAILED = 'get_transaction_history_failed',
  ESTIMATE_FEE_FAILED = 'estimate_fee_failed',
  
  CHALLENGE_FAILED = 'challenge_failed',
  CHALLENGE_NOT_FOUND = 'challenge_not_found',
  GET_CHALLENGE_STATUS_FAILED = 'get_challenge_status_failed',
  
  BATCH_CREATION_FAILED = 'batch_creation_failed',
  BATCH_NOT_FOUND = 'batch_not_found',
  GET_BATCH_STATUS_FAILED = 'get_batch_status_failed',
  
  PROOF_GENERATION_FAILED = 'proof_generation_failed',
  PROOF_VERIFICATION_FAILED = 'proof_verification_failed',
  
  STATE_UPDATE_FAILED = 'state_update_failed',
  STATE_NOT_FOUND = 'state_not_found',
  GET_STATE_FAILED = 'get_state_failed',
  
  NFT_MINT_FAILED = 'nft_mint_failed',
  NFT_TRANSFER_FAILED = 'nft_transfer_failed',
  NFT_BURN_FAILED = 'nft_burn_failed',
  NFT_NOT_FOUND = 'nft_not_found'
}

/**
 * Layer 2 SDK Error class
 */
export class Layer2Error extends Error {
  /** Error code */
  public code: ErrorCode;
  
  /**
   * Creates a new Layer 2 error
   * @param message Error message
   * @param code Error code
   */
  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN_ERROR) {
    super(message);
    this.name = 'Layer2Error';
    this.code = code;
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Layer2Error);
    }
  }
}

/**
 * Anti-Rug System for Solana Layer-2
 * 
 * This module provides anti-rug pull functionality for the Layer-2 solution,
 * including team verification, project auditing, and insurance fund management.
 * 
 * @module anti_rug_system
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { Logger } from './utils/logger';
import * as crypto from 'crypto';

/**
 * Configuration options for the anti-rug system
 */
export interface AntiRugConfig {
  /** Solana RPC endpoint URL */
  solanaRpcUrl: string;
  /** Operator account keypair */
  operatorKeypair: Keypair;
  /** Maximum contribution percentage to insurance fund (0-1) */
  maxContributionPercentage: number;
  /** Minimum lock period in seconds */
  minLockPeriod: number;
  /** Scoring threshold for project safety (0-100) */
  scoringThreshold: number;
  /** Whether team verification is required */
  teamVerificationRequired: boolean;
  /** Whether audit is required */
  auditRequired: boolean;
  /** Insurance fund account public key */
  insuranceFundAccount?: PublicKey;
}

/**
 * Team verification interface
 */
export interface TeamVerification {
  /** Team members information */
  teamMembers: TeamMember[];
  /** Whether KYC is completed */
  kycCompleted: boolean;
  /** Whether social media is verified */
  socialMediaVerified: boolean;
  /** Whether website is verified */
  websiteVerified: boolean;
  /** Whether GitHub is verified */
  gitHubVerified: boolean;
  /** Verification timestamp */
  verificationTimestamp: number;
  /** Verification expiration timestamp */
  expirationTimestamp: number;
}

/**
 * Team member interface
 */
export interface TeamMember {
  /** Team member name */
  name: string;
  /** Team member role */
  role: string;
  /** Team member public key */
  publicKey: string;
  /** Whether KYC is completed for this member */
  kycCompleted: boolean;
  /** Social media profiles */
  socialProfiles?: {
    twitter?: string;
    telegram?: string;
    linkedin?: string;
    github?: string;
  };
}

/**
 * Audit interface
 */
export interface Audit {
  /** Auditor name */
  auditor: string;
  /** Audit score (0-100) */
  score: number;
  /** Audit report URL */
  reportUrl: string;
  /** Audit timestamp */
  timestamp: number;
  /** Audit expiration timestamp */
  expirationTimestamp: number;
  /** Audit issues */
  issues: AuditIssue[];
}

/**
 * Audit issue interface
 */
export interface AuditIssue {
  /** Issue ID */
  id: string;
  /** Issue title */
  title: string;
  /** Issue description */
  description: string;
  /** Issue severity (CRITICAL, HIGH, MEDIUM, LOW, INFO) */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  /** Whether the issue is resolved */
  resolved: boolean;
  /** Resolution description */
  resolution?: string;
}

/**
 * Claim request interface
 */
export interface ClaimRequest {
  /** Claim ID */
  id: string;
  /** Requester address */
  requester: string;
  /** Claim amount */
  amount: bigint;
  /** Claim reason */
  reason: string;
  /** Evidence supporting the claim */
  evidence: string;
  /** Claim timestamp */
  timestamp: number;
  /** Claim status */
  status: ClaimStatus;
  /** Whether the claim is approved */
  approved: boolean;
  /** Payout amount */
  payoutAmount: bigint;
}

/**
 * Claim status enum
 */
export enum ClaimStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid'
}

/**
 * Liquidity lock interface
 */
export interface LiquidityLock {
  /** Lock ID */
  id: string;
  /** Project ID */
  projectId: string;
  /** Token address */
  tokenAddress: string;
  /** Locked amount */
  amount: bigint;
  /** Lock timestamp */
  lockTimestamp: number;
  /** Unlock timestamp */
  unlockTimestamp: number;
  /** Owner address */
  owner: string;
  /** Whether the lock is active */
  active: boolean;
}

/**
 * Class that implements the anti-rug system functionality
 */
export class AntiRugSystem {
  private connection: Connection;
  private operatorKeypair: Keypair;
  private config: AntiRugConfig;
  private logger: Logger;
  private teamVerifications: Map<string, TeamVerification> = new Map();
  private audits: Map<string, Audit> = new Map();
  private claimRequests: Map<string, ClaimRequest> = new Map();
  private liquidityLocks: Map<string, LiquidityLock> = new Map();
  private insuranceFund: bigint = BigInt(0);
  private insuranceFundAccount: PublicKey;
  private initialized: boolean = false;

  /**
   * Creates a new instance of AntiRugSystem
   * 
   * @param config - Configuration options for the anti-rug system
   */
  constructor(config: AntiRugConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.operatorKeypair = config.operatorKeypair;
    this.config = config;
    this.logger = new Logger('AntiRugSystem');
    this.insuranceFundAccount = config.insuranceFundAccount || this.operatorKeypair.publicKey;
    
    // Validate configuration
    this.validateConfig();
    
    this.logger.info('AntiRugSystem initialized', {
      solanaRpcUrl: config.solanaRpcUrl,
      maxContributionPercentage: config.maxContributionPercentage,
      minLockPeriod: config.minLockPeriod,
      scoringThreshold: config.scoringThreshold,
      teamVerificationRequired: config.teamVerificationRequired,
      auditRequired: config.auditRequired
    });
  }

  /**
   * Validates the configuration
   * 
   * @private
   */
  private validateConfig(): void {
    if (this.config.maxContributionPercentage <= 0 || this.config.maxContributionPercentage > 1) {
      throw new Error('maxContributionPercentage must be between 0 and 1');
    }
    
    if (this.config.minLockPeriod <= 0) {
      throw new Error('minLockPeriod must be greater than 0');
    }
    
    if (this.config.scoringThreshold < 0 || this.config.scoringThreshold > 100) {
      throw new Error('scoringThreshold must be between 0 and 100');
    }
  }

  /**
   * Initializes the anti-rug system
   * 
   * @returns Promise resolving when initialization is complete
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.info('AntiRugSystem already initialized');
      return;
    }
    
    try {
      this.logger.info('Initializing AntiRugSystem');
      
      // Initialize insurance fund account
      await this.initializeInsuranceFundAccount();
      
      // Load insurance fund balance
      await this.loadInsuranceFundBalance();
      
      this.initialized = true;
      this.logger.info('AntiRugSystem initialized successfully', {
        insuranceFundBalance: this.insuranceFund.toString()
      });
    } catch (error) {
      this.logger.error('Failed to initialize AntiRugSystem', { error });
      throw new Error(`Failed to initialize AntiRugSystem: ${error.message}`);
    }
  }

  /**
   * Initializes the insurance fund account
   * 
   * @returns Promise resolving when initialization is complete
   * @private
   */
  private async initializeInsuranceFundAccount(): Promise<void> {
    try {
      this.logger.info('Initializing insurance fund account');
      
      // Check if the account exists
      const accountInfo = await this.connection.getAccountInfo(this.insuranceFundAccount);
      
      if (!accountInfo) {
        this.logger.info('Insurance fund account does not exist, creating it');
        
        // In a real implementation, this would create a PDA account
        // owned by the anti-rug program
        
        // For now, we'll just use the operator's account
        this.logger.info('Using operator account as insurance fund account');
      } else {
        this.logger.info('Insurance fund account already exists');
      }
    } catch (error) {
      this.logger.error('Failed to initialize insurance fund account', { error });
      throw new Error(`Failed to initialize insurance fund account: ${error.message}`);
    }
  }

  /**
   * Loads the insurance fund balance
   * 
   * @returns Promise resolving when the balance is loaded
   * @private
   */
  private async loadInsuranceFundBalance(): Promise<void> {
    try {
      this.logger.info('Loading insurance fund balance');
      
      // In a real implementation, this would query the token account
      // balance or program state
      
      // For now, we'll just use a default value
      this.insuranceFund = BigInt(1000000000); // 1 SOL in lamports
      
      this.logger.info('Insurance fund balance loaded', {
        balance: this.insuranceFund.toString()
      });
    } catch (error) {
      this.logger.error('Failed to load insurance fund balance', { error });
      throw new Error(`Failed to load insurance fund balance: ${error.message}`);
    }
  }

  /**
   * Sets team verification for a project
   * 
   * @param projectId - Project ID
   * @param teamVerification - Team verification information
   * @returns Promise resolving to whether the verification was set successfully
   */
  async setTeamVerification(
    projectId: string,
    teamVerification: TeamVerification
  ): Promise<boolean> {
    try {
      this.logger.info('Setting team verification', {
        projectId
      });
      
      // Validate team verification
      if (!this.validateTeamVerification(teamVerification)) {
        return false;
      }
      
      // Store team verification
      this.teamVerifications.set(projectId, teamVerification);
      
      this.logger.info('Team verification set successfully', {
        projectId,
        teamMembers: teamVerification.teamMembers.length,
        kycCompleted: teamVerification.kycCompleted
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to set team verification', { error });
      return false;
    }
  }

  /**
   * Validates team verification information
   * 
   * @param teamVerification - Team verification information
   * @returns Whether the verification is valid
   * @private
   */
  private validateTeamVerification(teamVerification: TeamVerification): boolean {
    if (!teamVerification.teamMembers || teamVerification.teamMembers.length === 0) {
      this.logger.error('Team verification must include at least one team member');
      return false;
    }
    
    // Verify that at least one team member has completed KYC
    if (this.config.teamVerificationRequired && !teamVerification.kycCompleted) {
      this.logger.error('Team verification requires KYC completion');
      return false;
    }
    
    // Verify that at least one platform is verified
    if (!teamVerification.socialMediaVerified && 
        !teamVerification.websiteVerified && 
        !teamVerification.gitHubVerified) {
      this.logger.error('Team verification requires at least one verified platform');
      return false;
    }
    
    return true;
  }

  /**
   * Sets audit for a project
   * 
   * @param projectId - Project ID
   * @param audit - Audit information
   * @returns Promise resolving to whether the audit was set successfully
   */
  async setAudit(projectId: string, audit: Audit): Promise<boolean> {
    try {
      this.logger.info('Setting audit', {
        projectId,
        auditor: audit.auditor
      });
      
      // Validate audit
      if (!this.validateAudit(audit)) {
        return false;
      }
      
      // Store audit
      this.audits.set(projectId, audit);
      
      this.logger.info('Audit set successfully', {
        projectId,
        auditor: audit.auditor,
        score: audit.score
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to set audit', { error });
      return false;
    }
  }

  /**
   * Validates audit information
   * 
   * @param audit - Audit information
   * @returns Whether the audit is valid
   * @private
   */
  private validateAudit(audit: Audit): boolean {
    if (!audit.auditor || audit.auditor.trim() === '') {
      this.logger.error('Audit must include auditor name');
      return false;
    }
    
    if (audit.score < 0 || audit.score > 100) {
      this.logger.error('Audit score must be between 0 and 100');
      return false;
    }
    
    // Verify that there are no unresolved critical issues
    const unresolvedCritical = audit.issues.some(issue => 
      issue.severity === 'CRITICAL' && !issue.resolved
    );
    
    if (unresolvedCritical) {
      this.logger.error('Audit has unresolved critical issues');
      return false;
    }
    
    // Verify that the score is above the threshold
    if (this.config.auditRequired && audit.score < this.config.scoringThreshold) {
      this.logger.error(`Audit score (${audit.score}) is below threshold (${this.config.scoringThreshold})`);
      return false;
    }
    
    return true;
  }

  /**
   * Checks if a project is safe based on team verification and audit
   * 
   * @param projectId - Project ID
   * @returns Whether the project is considered safe
   */
  isProjectSafe(projectId: string): boolean {
    try {
      this.logger.info('Checking if project is safe', {
        projectId
      });
      
      // Get team verification and audit
      const teamVerification = this.teamVerifications.get(projectId);
      const audit = this.audits.get(projectId);
      
      // Check if team verification is required and completed
      const teamVerified = !this.config.teamVerificationRequired || 
                          (teamVerification !== undefined && teamVerification.kycCompleted);
      
      // Check if audit is required and completed
      const auditVerified = !this.config.auditRequired || 
                           (audit !== undefined && audit.score >= this.config.scoringThreshold);
      
      const isSafe = teamVerified && auditVerified;
      
      this.logger.info('Project safety check result', {
        projectId,
        isSafe,
        teamVerified,
        auditVerified
      });
      
      return isSafe;
    } catch (error) {
      this.logger.error('Failed to check if project is safe', { error });
      return false;
    }
  }

  /**
   * Calculates the safety score for a project
   * 
   * @param projectId - Project ID
   * @returns Safety score (0-100)
   */
  calculateSafetyScore(projectId: string): number {
    try {
      this.logger.info('Calculating safety score', {
        projectId
      });
      
      // Get team verification and audit
      const teamVerification = this.teamVerifications.get(projectId);
      const audit = this.audits.get(projectId);
      
      let score = 0;
      let maxScore = 0;
      
      // Calculate team verification score (max 50 points)
      if (teamVerification) {
        maxScore += 50;
        
        // KYC completed (20 points)
        if (teamVerification.kycCompleted) {
          score += 20;
        }
        
        // Social media verified (10 points)
        if (teamVerification.socialMediaVerified) {
          score += 10;
        }
        
        // Website verified (10 points)
        if (teamVerification.websiteVerified) {
          score += 10;
        }
        
        // GitHub verified (10 points)
        if (teamVerification.gitHubVerified) {
          score += 10;
        }
      }
      
      // Calculate audit score (max 50 points)
      if (audit) {
        maxScore += 50;
        
        // Audit score (up to 50 points)
        score += (audit.score / 100) * 50;
      }
      
      // If no verification or audit, score is 0
      if (maxScore === 0) {
        return 0;
      }
      
      // Normalize score to 0-100
      const normalizedScore = (score / maxScore) * 100;
      
      this.logger.info('Safety score calculated', {
        projectId,
        score: normalizedScore
      });
      
      return normalizedScore;
    } catch (error) {
      this.logger.error('Failed to calculate safety score', { error });
      return 0;
    }
  }

  /**
   * Creates a liquidity lock for a project
   * 
   * @param projectId - Project ID
   * @param tokenAddress - Token address
   * @param amount - Amount to lock
   * @param lockPeriod - Lock period in seconds
   * @param owner - Owner address
   * @returns Promise resolving to the lock ID if successful, null otherwise
   */
  async createLiquidityLock(
    projectId: string,
    tokenAddress: string,
    amount: bigint,
    lockPeriod: number,
    owner: string
  ): Promise<string | null> {
    try {
      this.logger.info('Creating liquidity lock', {
        projectId,
        tokenAddress,
        amount: amount.toString(),
        lockPeriod,
        owner
      });
      
      // Validate lock parameters
      if (amount <= BigInt(0)) {
        this.logger.error('Lock amount must be greater than 0');
        return null;
      }
      
      if (lockPeriod < this.config.minLockPeriod) {
        this.logger.error(`Lock period (${lockPeriod}s) is less than minimum (${this.config.minLockPeriod}s)`);
        return null;
      }
      
      // Generate lock ID
      const lockId = this.generateLockId();
      
      // Calculate timestamps
      const now = Math.floor(Date.now() / 1000);
      const unlockTimestamp = now + lockPeriod;
      
      // Create lock
      const lock: LiquidityLock = {
        id: lockId,
        projectId,
        tokenAddress,
        amount,
        lockTimestamp: now,
        unlockTimestamp,
        owner,
        active: true
      };
      
      // Store lock
      this.liquidityLocks.set(lockId, lock);
      
      this.logger.info('Liquidity lock created', {
        lockId,
        projectId,
        amount: amount.toString(),
        unlockTimestamp
      });
      
      return lockId;
    } catch (error) {
      this.logger.error('Failed to create liquidity lock', { error });
      return null;
    }
  }

  /**
   * Unlocks a liquidity lock
   * 
   * @param lockId - Lock ID
   * @param unlocker - Address of the account unlocking
   * @returns Promise resolving to whether the unlock was successful
   */
  async unlockLiquidity(lockId: string, unlocker: string): Promise<boolean> {
    try {
      this.logger.info('Unlocking liquidity', {
        lockId,
        unlocker
      });
      
      // Get lock
      const lock = this.liquidityLocks.get(lockId);
      
      if (!lock) {
        this.logger.error('Lock not found', {
          lockId
        });
        return false;
      }
      
      // Check if lock is active
      if (!lock.active) {
        this.logger.error('Lock is not active', {
          lockId
        });
        return false;
      }
      
      // Check if unlocker is the owner
      if (lock.owner !== unlocker) {
        this.logger.error('Unlocker is not the lock owner', {
          lockId,
          owner: lock.owner,
          unlocker
        });
        return false;
      }
      
      // Check if lock period has expired
      const now = Math.floor(Date.now() / 1000);
      if (now < lock.unlockTimestamp) {
        this.logger.error('Lock period has not expired', {
          lockId,
          unlockTimestamp: lock.unlockTimestamp,
          currentTimestamp: now,
          remainingTime: lock.unlockTimestamp - now
        });
        return false;
      }
      
      // Update lock
      lock.active = false;
      this.liquidityLocks.set(lockId, lock);
      
      this.logger.info('Liquidity unlocked successfully', {
        lockId,
        amount: lock.amount.toString()
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to unlock liquidity', { error });
      return false;
    }
  }

  /**
   * Creates a claim request
   * 
   * @param requester - Requester address
   * @param amount - Claim amount
   * @param reason - Claim reason
   * @param evidence - Evidence supporting the claim
   * @returns Promise resolving to the claim ID if successful, null otherwise
   */
  async createClaimRequest(
    requester: string,
    amount: bigint,
    reason: string,
    evidence: string
  ): Promise<string | null> {
    try {
      this.logger.info('Creating claim request', {
        requester,
        amount: amount.toString(),
        reason
      });
      
      // Validate claim parameters
      if (amount <= BigInt(0)) {
        this.logger.error('Claim amount must be greater than 0');
        return null;
      }
      
      if (!reason || reason.trim() === '') {
        this.logger.error('Claim reason is required');
        return null;
      }
      
      // Generate claim ID
      const claimId = this.generateClaimId();
      
      // Create claim request
      const claimRequest: ClaimRequest = {
        id: claimId,
        requester,
        amount,
        reason,
        evidence,
        timestamp: Date.now(),
        status: ClaimStatus.PENDING,
        approved: false,
        payoutAmount: BigInt(0)
      };
      
      // Store claim request
      this.claimRequests.set(claimId, claimRequest);
      
      this.logger.info('Claim request created', {
        claimId,
        requester,
        amount: amount.toString()
      });
      
      return claimId;
    } catch (error) {
      this.logger.error('Failed to create claim request', { error });
      return null;
    }
  }

  /**
   * Processes a claim request
   * 
   * @param claimId - Claim ID
   * @param approved - Whether the claim is approved
   * @param payoutAmount - Payout amount (if approved)
   * @returns Promise resolving to the processing result
   */
  async processClaim(
    claimId: string,
    approved: boolean,
    payoutAmount: bigint = BigInt(0)
  ): Promise<{ approved: boolean; payoutAmount: bigint }> {
    try {
      this.logger.info('Processing claim', {
        claimId,
        approved,
        payoutAmount: payoutAmount.toString()
      });
      
      // Get claim request
      const claimRequest = this.claimRequests.get(claimId);
      
      if (!claimRequest) {
        this.logger.error('Claim request not found', {
          claimId
        });
        return { approved: false, payoutAmount: BigInt(0) };
      }
      
      // Check if claim is pending
      if (claimRequest.status !== ClaimStatus.PENDING) {
        this.logger.error('Claim request is not pending', {
          claimId,
          status: claimRequest.status
        });
        return { approved: false, payoutAmount: BigInt(0) };
      }
      
      if (approved) {
        // Validate payout amount
        if (payoutAmount <= BigInt(0)) {
          this.logger.error('Payout amount must be greater than 0');
          return { approved: false, payoutAmount: BigInt(0) };
        }
        
        // Check if insurance fund has enough balance
        if (payoutAmount > this.insuranceFund) {
          this.logger.error('Insufficient insurance fund balance', {
            payoutAmount: payoutAmount.toString(),
            insuranceFund: this.insuranceFund.toString()
          });
          return { approved: false, payoutAmount: BigInt(0) };
        }
        
        // Update claim request
        claimRequest.approved = true;
        claimRequest.status = ClaimStatus.APPROVED;
        claimRequest.payoutAmount = payoutAmount;
        
        // Execute payout
        await this.executePayout(claimRequest);
        
        // Update claim status
        claimRequest.status = ClaimStatus.PAID;
        this.claimRequests.set(claimId, claimRequest);
        
        this.logger.info('Claim approved and paid', {
          claimId,
          payoutAmount: payoutAmount.toString()
        });
        
        return { approved: true, payoutAmount };
      } else {
        // Reject claim
        claimRequest.approved = false;
        claimRequest.status = ClaimStatus.REJECTED;
        this.claimRequests.set(claimId, claimRequest);
        
        this.logger.info('Claim rejected', {
          claimId
        });
        
        return { approved: false, payoutAmount: BigInt(0) };
      }
    } catch (error) {
      this.logger.error('Failed to process claim', { error });
      return { approved: false, payoutAmount: BigInt(0) };
    }
  }

  /**
   * Executes a payout for a claim
   * 
   * @param claimRequest - Claim request
   * @returns Promise resolving when the payout is complete
   * @private
   */
  private async executePayout(claimRequest: ClaimRequest): Promise<void> {
    try {
      this.logger.info('Executing payout', {
        claimId: claimRequest.id,
        payoutAmount: claimRequest.payoutAmount.toString()
      });
      
      // In a real implementation, this would transfer tokens
      // from the insurance fund to the requester
      
      // For now, just update the insurance fund balance
      this.insuranceFund -= claimRequest.payoutAmount;
      
      this.logger.info('Payout executed', {
        claimId: claimRequest.id,
        payoutAmount: claimRequest.payoutAmount.toString(),
        newInsuranceFundBalance: this.insuranceFund.toString()
      });
    } catch (error) {
      this.logger.error('Failed to execute payout', { error });
      throw new Error(`Failed to execute payout: ${error.message}`);
    }
  }

  /**
   * Adds funds to the insurance fund
   * 
   * @param amount - Amount to add
   * @returns Promise resolving to the new balance
   */
  async addToInsuranceFund(amount: bigint): Promise<bigint> {
    try {
      this.logger.info('Adding to insurance fund', {
        amount: amount.toString()
      });
      
      // Validate amount
      if (amount <= BigInt(0)) {
        this.logger.error('Amount must be greater than 0');
        return this.insuranceFund;
      }
      
      // In a real implementation, this would transfer tokens
      // to the insurance fund account
      
      // For now, just update the balance
      this.insuranceFund += amount;
      
      this.logger.info('Added to insurance fund', {
        amount: amount.toString(),
        newBalance: this.insuranceFund.toString()
      });
      
      return this.insuranceFund;
    } catch (error) {
      this.logger.error('Failed to add to insurance fund', { error });
      return this.insuranceFund;
    }
  }

  /**
   * Gets the insurance fund balance
   * 
   * @returns Insurance fund balance
   */
  getInsuranceFundBalance(): bigint {
    return this.insuranceFund;
  }

  /**
   * Gets a team verification by project ID
   * 
   * @param projectId - Project ID
   * @returns Team verification if found, undefined otherwise
   */
  getTeamVerification(projectId: string): TeamVerification | undefined {
    return this.teamVerifications.get(projectId);
  }

  /**
   * Gets an audit by project ID
   * 
   * @param projectId - Project ID
   * @returns Audit if found, undefined otherwise
   */
  getAudit(projectId: string): Audit | undefined {
    return this.audits.get(projectId);
  }

  /**
   * Gets a liquidity lock by ID
   * 
   * @param lockId - Lock ID
   * @returns Liquidity lock if found, undefined otherwise
   */
  getLiquidityLock(lockId: string): LiquidityLock | undefined {
    return this.liquidityLocks.get(lockId);
  }

  /**
   * Gets liquidity locks by project ID
   * 
   * @param projectId - Project ID
   * @returns Array of liquidity locks for the project
   */
  getLiquidityLocksByProject(projectId: string): LiquidityLock[] {
    return Array.from(this.liquidityLocks.values())
      .filter(lock => lock.projectId === projectId);
  }

  /**
   * Gets active liquidity locks
   * 
   * @returns Array of active liquidity locks
   */
  getActiveLiquidityLocks(): LiquidityLock[] {
    return Array.from(this.liquidityLocks.values())
      .filter(lock => lock.active);
  }

  /**
   * Gets a claim request by ID
   * 
   * @param claimId - Claim ID
   * @returns Claim request if found, undefined otherwise
   */
  getClaimRequest(claimId: string): ClaimRequest | undefined {
    return this.claimRequests.get(claimId);
  }

  /**
   * Gets claim requests by status
   * 
   * @param status - Status to filter by
   * @returns Array of claim requests with the specified status
   */
  getClaimRequestsByStatus(status: ClaimStatus): ClaimRequest[] {
    return Array.from(this.claimRequests.values())
      .filter(claim => claim.status === status);
  }

  /**
   * Gets all claim requests
   * 
   * @returns Array of all claim requests
   */
  getAllClaimRequests(): ClaimRequest[] {
    return Array.from(this.claimRequests.values());
  }

  /**
   * Generates a unique claim ID
   * 
   * @returns Claim ID
   * @private
   */
  private generateClaimId(): string {
    return `claim_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generates a unique lock ID
   * 
   * @returns Lock ID
   * @private
   */
  private generateLockId(): string {
    return `lock_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Updates the configuration
   * 
   * @param config - New configuration
   */
  updateConfig(config: Partial<AntiRugConfig>): void {
    // Update configuration
    this.config = {
      ...this.config,
      ...config
    };
    
    // Validate new configuration
    this.validateConfig();
    
    this.logger.info('Configuration updated', {
      maxContributionPercentage: this.config.maxContributionPercentage,
      minLockPeriod: this.config.minLockPeriod,
      scoringThreshold: this.config.scoringThreshold,
      teamVerificationRequired: this.config.teamVerificationRequired,
      auditRequired: this.config.auditRequired
    });
  }

  /**
   * Gets the current configuration
   * 
   * @returns Current configuration
   */
  getConfig(): AntiRugConfig {
    return { ...this.config };
  }
}

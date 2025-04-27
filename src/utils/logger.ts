/**
 * Utils Logger for Solana Layer-2
 * 
 * This module provides logging functionality for the Layer-2 solution.
 * 
 * @module utils/logger
 */

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Whether to enable verbose logging */
  verbose?: boolean;
  /** Whether to include timestamps in logs */
  includeTimestamps?: boolean;
  /** Whether to include log level in logs */
  includeLevel?: boolean;
  /** Whether to include module name in logs */
  includeModule?: boolean;
  /** Whether to log to console */
  logToConsole?: boolean;
  /** Whether to log to file */
  logToFile?: boolean;
  /** Log file path */
  logFilePath?: string;
}

/**
 * Log level enum
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

/**
 * Class that implements logging functionality
 */
export class Logger {
  private moduleName: string;
  private config: LoggerConfig;

  /**
   * Creates a new instance of Logger
   * 
   * @param moduleName - Name of the module using this logger
   * @param config - Logger configuration options
   */
  constructor(moduleName: string, config: LoggerConfig = {}) {
    this.moduleName = moduleName;
    this.config = {
      verbose: config.verbose !== undefined ? config.verbose : false,
      includeTimestamps: config.includeTimestamps !== undefined ? config.includeTimestamps : true,
      includeLevel: config.includeLevel !== undefined ? config.includeLevel : true,
      includeModule: config.includeModule !== undefined ? config.includeModule : true,
      logToConsole: config.logToConsole !== undefined ? config.logToConsole : true,
      logToFile: config.logToFile !== undefined ? config.logToFile : false,
      logFilePath: config.logFilePath || './logs/layer2.log'
    };
  }

  /**
   * Logs a debug message
   * 
   * @param message - Message to log
   * @param data - Additional data to log
   */
  debug(message: string, data?: any): void {
    if (this.config.verbose) {
      this.log(LogLevel.DEBUG, message, data);
    }
  }

  /**
   * Logs an info message
   * 
   * @param message - Message to log
   * @param data - Additional data to log
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Logs a warning message
   * 
   * @param message - Message to log
   * @param data - Additional data to log
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Logs an error message
   * 
   * @param message - Message to log
   * @param data - Additional data to log
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Logs a message with the specified level
   * 
   * @param level - Log level
   * @param message - Message to log
   * @param data - Additional data to log
   * @private
   */
  private log(level: LogLevel, message: string, data?: any): void {
    const timestamp = this.config.includeTimestamps ? new Date().toISOString() : '';
    const levelStr = this.config.includeLevel ? `[${level}]` : '';
    const moduleStr = this.config.includeModule ? `[${this.moduleName}]` : '';
    
    let logMessage = '';
    
    if (timestamp) {
      logMessage += `${timestamp} `;
    }
    
    if (levelStr) {
      logMessage += `${levelStr} `;
    }
    
    if (moduleStr) {
      logMessage += `${moduleStr} `;
    }
    
    logMessage += message;
    
    if (data !== undefined) {
      if (typeof data === 'object') {
        try {
          // Handle circular references and BigInt values
          const serializedData = JSON.stringify(data, (key, value) => {
            if (typeof value === 'bigint') {
              return value.toString();
            }
            return value;
          }, 2);
          logMessage += ` ${serializedData}`;
        } catch (error) {
          logMessage += ` [Error serializing data: ${error.message}]`;
        }
      } else {
        logMessage += ` ${data}`;
      }
    }
    
    if (this.config.logToConsole) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(logMessage);
          break;
        case LogLevel.INFO:
          console.info(logMessage);
          break;
        case LogLevel.WARN:
          console.warn(logMessage);
          break;
        case LogLevel.ERROR:
          console.error(logMessage);
          break;
      }
    }
    
    if (this.config.logToFile) {
      // In a real implementation, this would write to a file
      // For now, we'll just skip file logging
    }
  }
}

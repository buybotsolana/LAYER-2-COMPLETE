/**
 * @file database.service.test.ts
 * @description Test suite for the DatabaseService
 */

import { DatabaseService } from '../src/database/database.service';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { createConnection, getConnection, Connection } from 'typeorm';

describe('DatabaseService', () => {
  let databaseService: DatabaseService;
  let connectionStub: sinon.SinonStub;
  let getConnectionStub: sinon.SinonStub;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (DatabaseService as any).instance = null;
    
    // Stub the TypeORM createConnection and getConnection methods
    connectionStub = sinon.stub(require('typeorm'), 'createConnection');
    getConnectionStub = sinon.stub(require('typeorm'), 'getConnection');
    
    // Create a mock connection
    const mockConnection = {
      isConnected: true,
      close: sinon.stub().resolves(),
      query: sinon.stub().resolves([]),
      getRepository: sinon.stub().returns({
        find: sinon.stub().resolves([]),
        findOne: sinon.stub().resolves({}),
        save: sinon.stub().resolves({}),
        remove: sinon.stub().resolves({}),
        count: sinon.stub().resolves(0),
        createQueryBuilder: sinon.stub().returns({
          where: sinon.stub().returnsThis(),
          andWhere: sinon.stub().returnsThis(),
          orderBy: sinon.stub().returnsThis(),
          addOrderBy: sinon.stub().returnsThis(),
          take: sinon.stub().returnsThis(),
          skip: sinon.stub().returnsThis(),
          getMany: sinon.stub().resolves([]),
          getOne: sinon.stub().resolves({}),
          getCount: sinon.stub().resolves(0),
          update: sinon.stub().returnsThis(),
          set: sinon.stub().returnsThis(),
          execute: sinon.stub().resolves({ affected: 0 }),
          delete: sinon.stub().returnsThis(),
          from: sinon.stub().returnsThis(),
          select: sinon.stub().returnsThis(),
          getRawOne: sinon.stub().resolves({}),
          getRawMany: sinon.stub().resolves([])
        })
      }),
      manager: {
        transaction: sinon.stub().callsFake(async (fn) => await fn({}))
      }
    };
    
    // Configure the stubs to return the mock connection
    connectionStub.resolves(mockConnection as unknown as Connection);
    getConnectionStub.returns(mockConnection as unknown as Connection);
    
    // Get the DatabaseService instance
    databaseService = DatabaseService.getInstance();
  });
  
  afterEach(() => {
    // Restore the stubs after each test
    sinon.restore();
  });
  
  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = DatabaseService.getInstance();
      const instance2 = DatabaseService.getInstance();
      
      expect(instance1).to.equal(instance2);
    });
  });
  
  describe('initialize', () => {
    it('should initialize the database connection', async () => {
      await databaseService.initialize();
      
      expect(connectionStub.calledOnce).to.be.true;
      expect(databaseService.isInitialized()).to.be.true;
    });
    
    it('should not initialize if already initialized', async () => {
      await databaseService.initialize();
      await databaseService.initialize();
      
      expect(connectionStub.calledOnce).to.be.true;
    });
    
    it('should handle initialization errors', async () => {
      connectionStub.rejects(new Error('Connection error'));
      
      try {
        await databaseService.initialize();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to initialize database');
      }
    });
  });
  
  describe('getRepository', () => {
    it('should get a repository for an entity', async () => {
      await databaseService.initialize();
      
      const repository = databaseService.getRepository({} as any);
      
      expect(repository).to.exist;
    });
    
    it('should throw an error if not initialized', () => {
      try {
        databaseService.getRepository({} as any);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Database not initialized');
      }
    });
  });
  
  describe('executeQuery', () => {
    it('should execute a raw SQL query', async () => {
      await databaseService.initialize();
      
      const result = await databaseService.executeQuery('SELECT 1');
      
      expect(result).to.exist;
    });
    
    it('should throw an error if not initialized', async () => {
      try {
        await databaseService.executeQuery('SELECT 1');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Database not initialized');
      }
    });
  });
  
  describe('executeTransaction', () => {
    it('should execute a transaction', async () => {
      await databaseService.initialize();
      
      const result = await databaseService.executeTransaction(async (manager) => {
        return { success: true };
      });
      
      expect(result).to.deep.equal({ success: true });
    });
    
    it('should throw an error if not initialized', async () => {
      try {
        await databaseService.executeTransaction(async (manager) => {
          return { success: true };
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Database not initialized');
      }
    });
  });
  
  describe('isConnected', () => {
    it('should return true if connected', async () => {
      await databaseService.initialize();
      
      const connected = await databaseService.isConnected();
      
      expect(connected).to.be.true;
    });
    
    it('should return false if not initialized', async () => {
      const connected = await databaseService.isConnected();
      
      expect(connected).to.be.false;
    });
  });
  
  describe('getConnectionPoolStats', () => {
    it('should get connection pool statistics', async () => {
      await databaseService.initialize();
      
      const stats = await databaseService.getConnectionPoolStats();
      
      expect(stats).to.exist;
      expect(stats).to.have.property('total');
      expect(stats).to.have.property('idle');
      expect(stats).to.have.property('active');
    });
  });
  
  describe('performMaintenance', () => {
    it('should perform database maintenance', async () => {
      await databaseService.initialize();
      
      await databaseService.performMaintenance();
      
      // Verify that maintenance queries were executed
      const connection = getConnection();
      expect(connection.query.called).to.be.true;
    });
  });
  
  describe('shutdown', () => {
    it('should close the database connection', async () => {
      await databaseService.initialize();
      
      await databaseService.shutdown();
      
      expect(databaseService.isInitialized()).to.be.false;
    });
    
    it('should handle shutdown when not initialized', async () => {
      await databaseService.shutdown();
      
      expect(databaseService.isInitialized()).to.be.false;
    });
  });
});

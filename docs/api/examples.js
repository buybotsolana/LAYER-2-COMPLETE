// Code examples for using the LAYER-2 system APIs

/**
 * Examples of using the LAYER-2 system APIs in JavaScript
 * 
 * This file contains code examples for interacting with the LAYER-2
 * system APIs using JavaScript and the Fetch library.
 */

// Basic configuration
const API_BASE_URL = 'https://api.layer2.solana.com/v1';
let authToken = null;

// Utility function for making API requests
async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  const options = {
    method,
    headers,
    credentials: 'include',
  };
  
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Request Error:', error);
    throw error;
  }
}

// Example 1: Get system status
async function getSystemStatus() {
  try {
    const status = await apiRequest('/status');
    console.log('System Status:', status);
    return status;
  } catch (error) {
    console.error('Failed to get system status:', error);
    throw error;
  }
}

// Example 2: Get sequencer status
async function getSequencerStatus() {
  try {
    const status = await apiRequest('/sequencer/status');
    console.log('Sequencer Status:', status);
    return status;
  } catch (error) {
    console.error('Failed to get sequencer status:', error);
    throw error;
  }
}

// Example 3: Submit a transaction to the sequencer
async function submitTransaction(transaction) {
  try {
    const result = await apiRequest('/sequencer/transactions', 'POST', transaction);
    console.log('Transaction submitted:', result);
    return result;
  } catch (error) {
    console.error('Failed to submit transaction:', error);
    throw error;
  }
}

// Example deposit transaction
const depositTransaction = {
  type: 'deposit',
  amount: 100.0,
  account: 'user123',
  timestamp: new Date().toISOString()
};

// Example 4: Get a specific transaction
async function getTransaction(transactionId) {
  try {
    const transaction = await apiRequest(`/sequencer/transactions/${transactionId}`);
    console.log('Transaction details:', transaction);
    return transaction;
  } catch (error) {
    console.error(`Failed to get transaction ${transactionId}:`, error);
    throw error;
  }
}

// Example 5: Get the list of nodes in the cluster
async function getNodes() {
  try {
    const nodes = await apiRequest('/distributed/nodes');
    console.log('Cluster nodes:', nodes);
    return nodes;
  } catch (error) {
    console.error('Failed to get nodes:', error);
    throw error;
  }
}

// Example 6: Start node synchronization
async function syncNode(nodeId) {
  try {
    const syncResult = await apiRequest('/distributed/sync', 'POST', { nodeId });
    console.log('Node synchronization started:', syncResult);
    return syncResult;
  } catch (error) {
    console.error(`Failed to sync node ${nodeId}:`, error);
    throw error;
  }
}

// Example 7: Get the list of available secrets
async function listSecrets() {
  try {
    const secrets = await apiRequest('/secrets');
    console.log('Available secrets:', secrets);
    return secrets;
  } catch (error) {
    console.error('Failed to list secrets:', error);
    throw error;
  }
}

// Example 8: Create a new secret
async function createSecret(name, value) {
  try {
    const result = await apiRequest('/secrets', 'POST', { name, value });
    console.log('Secret created:', result);
    return result;
  } catch (error) {
    console.error(`Failed to create secret ${name}:`, error);
    throw error;
  }
}

// Example 9: Delete a secret
async function deleteSecret(name) {
  try {
    const result = await apiRequest(`/secrets/${name}`, 'DELETE');
    console.log('Secret deleted:', result);
    return result;
  } catch (error) {
    console.error(`Failed to delete secret ${name}:`, error);
    throw error;
  }
}

// Example 10: Rotate a secret
async function rotateSecret(name) {
  try {
    const result = await apiRequest(`/secrets/${name}/rotate`, 'POST');
    console.log('Secret rotated:', result);
    return result;
  } catch (error) {
    console.error(`Failed to rotate secret ${name}:`, error);
    throw error;
  }
}

// Complete usage example
async function exampleUsage() {
  try {
    // Get system status
    const systemStatus = await getSystemStatus();
    
    // If the system is healthy, proceed with other operations
    if (systemStatus.status === 'healthy') {
      // Get sequencer status
      const sequencerStatus = await getSequencerStatus();
      
      // Submit a transaction
      if (sequencerStatus.state === 'running') {
        const transactionResult = await submitTransaction(depositTransaction);
        
        // Get transaction details
        if (transactionResult.id) {
          await getTransaction(transactionResult.id);
        }
      }
      
      // Get the list of nodes
      const nodesResult = await getNodes();
      
      // If there are inactive nodes, start synchronization
      if (nodesResult.nodes.some(node => node.state !== 'leader')) {
        const inactiveNode = nodesResult.nodes.find(node => node.state !== 'leader');
        if (inactiveNode) {
          await syncNode(inactiveNode.id);
        }
      }
      
      // Manage secrets
      const secretsResult = await listSecrets();
      
      // Create a new secret if it doesn't exist
      if (!secretsResult.secrets.includes('api-key')) {
        await createSecret('api-key', 'my-secret-api-key');
      }
      
      // Rotate an existing secret
      if (secretsResult.secrets.includes('database-password')) {
        await rotateSecret('database-password');
      }
    }
  } catch (error) {
    console.error('Example usage failed:', error);
  }
}

// Export functions for use in other modules
module.exports = {
  getSystemStatus,
  getSequencerStatus,
  submitTransaction,
  getTransaction,
  getNodes,
  syncNode,
  listSecrets,
  createSecret,
  deleteSecret,
  rotateSecret,
  exampleUsage
};

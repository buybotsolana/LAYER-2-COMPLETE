# HSM Setup Guide

This guide provides instructions for setting up Hardware Security Modules (HSMs) for the LAYER-2 system on Solana.

## Table of Contents

1. [Introduction](#introduction)
2. [AWS CloudHSM Setup](#aws-cloudhsm-setup)
3. [YubiHSM Setup](#yubihsm-setup)
4. [Key Management Configuration](#key-management-configuration)
5. [Failover Configuration](#failover-configuration)
6. [Key Rotation](#key-rotation)
7. [Monitoring and Alerts](#monitoring-and-alerts)
8. [Troubleshooting](#troubleshooting)

## Introduction

Hardware Security Modules (HSMs) are specialized hardware devices designed to securely store cryptographic keys and perform cryptographic operations. The LAYER-2 system uses HSMs to protect critical keys used by the sequencer for signing transactions and blocks.

This guide covers the setup and configuration of two supported HSM solutions:
- AWS CloudHSM: A cloud-based HSM service that provides FIPS 140-2 Level 3 validated hardware
- YubiHSM: A physical HSM device that provides a cost-effective solution for key protection

## AWS CloudHSM Setup

### Prerequisites

- AWS account with appropriate permissions
- VPC with at least two subnets in different Availability Zones
- AWS CLI installed and configured

### Installation Steps

1. **Create an AWS CloudHSM cluster**

   ```bash
   aws cloudhsm create-cluster \
     --hsm-type hsm1.medium \
     --subnet-ids subnet-12345678 subnet-87654321
   ```

   Note the cluster ID returned by this command.

2. **Initialize the cluster**

   ```bash
   aws cloudhsm initialize-cluster --cluster-id cluster-12345678
   ```

3. **Create an HSM within the cluster**

   ```bash
   aws cloudhsm create-hsm \
     --cluster-id cluster-12345678 \
     --availability-zone us-east-1a \
     --subnet-id subnet-12345678
   ```

4. **Install the CloudHSM client**

   Download and install the CloudHSM client from the AWS console or using the AWS CLI:

   ```bash
   wget https://s3.amazonaws.com/cloudhsmv2-software/CloudHsmClient/EL7/cloudhsm-client-latest.el7.x86_64.rpm
   sudo yum install -y ./cloudhsm-client-latest.el7.x86_64.rpm
   ```

5. **Configure the CloudHSM client**

   ```bash
   sudo /opt/cloudhsm/bin/configure -a <cluster-ip>
   ```

6. **Create a crypto user**

   ```bash
   /opt/cloudhsm/bin/cloudhsm_mgmt_util /opt/cloudhsm/etc/cloudhsm_mgmt_util.cfg
   
   # Inside the cloudhsm_mgmt_util
   loginHSM PRECO admin password
   createUser CU sequencer-user password
   quit
   ```

7. **Generate and extract keys**

   ```bash
   /opt/cloudhsm/bin/key_mgmt_util
   
   # Inside the key_mgmt_util
   loginHSM -u CU -s sequencer-user -p password
   genSymKey -t 31 -s 32 -l sequencer-signing-key
   # Note the key handle returned
   quit
   ```

### Configuration for LAYER-2

Update the configuration file for the LAYER-2 system to use AWS CloudHSM:

```json
{
  "keyManager": {
    "type": "aws-cloudhsm",
    "config": {
      "clusterEndpoint": "<cluster-ip>",
      "username": "sequencer-user",
      "password": "password",
      "keyHandle": "<key-handle>",
      "region": "us-east-1",
      "logLevel": "info",
      "metrics": {
        "enabled": true,
        "namespace": "LAYER2/HSM",
        "region": "us-east-1"
      }
    }
  }
}
```

## YubiHSM Setup

### Prerequisites

- YubiHSM 2 device
- YubiHSM SDK installed
- USB port available on the server

### Installation Steps

1. **Install YubiHSM SDK**

   ```bash
   wget https://developers.yubico.com/YubiHSM2/Releases/yubihsm2-sdk-latest-linux-amd64.tar.gz
   tar -xzf yubihsm2-sdk-latest-linux-amd64.tar.gz
   cd yubihsm2-sdk-*
   sudo ./install.sh
   ```

2. **Connect the YubiHSM device**

   Insert the YubiHSM 2 device into an available USB port on the server.

3. **Reset the device (if needed)**

   ```bash
   yubihsm-shell
   
   # Inside yubihsm-shell
   connect
   session open 1 password
   reset
   quit
   ```

4. **Configure the device**

   ```bash
   yubihsm-shell
   
   # Inside yubihsm-shell
   connect
   session open 1 password
   user create 2 sequencer-user password 0 0000000000000000 domains=all capabilities=all
   audit set log-mode on-device
   session close
   session open 2 password
   generate asymmetric 0 sequencer-signing-key 1 ecp256 exportable=no
   # Note the key ID returned
   quit
   ```

### Configuration for LAYER-2

Update the configuration file for the LAYER-2 system to use YubiHSM:

```json
{
  "keyManager": {
    "type": "yubihsm",
    "config": {
      "connector": "http://127.0.0.1:12345",
      "authKeyId": 2,
      "password": "password",
      "keyId": "<key-id>",
      "logLevel": "info"
    }
  }
}
```

## Key Management Configuration

The LAYER-2 system provides a flexible key management system that supports multiple HSM providers and failover mechanisms.

### Configuration Options

```json
{
  "keyManager": {
    "type": "aws-cloudhsm",
    "config": {
      "clusterEndpoint": "<cluster-ip>",
      "username": "sequencer-user",
      "password": "password",
      "keyHandle": "<key-handle>",
      "region": "us-east-1"
    },
    "failover": {
      "enabled": true,
      "providers": [
        {
          "type": "yubihsm",
          "config": {
            "connector": "http://127.0.0.1:12345",
            "authKeyId": 2,
            "password": "password",
            "keyId": "<key-id>"
          }
        },
        {
          "type": "emergency",
          "config": {
            "maxUsageTime": 3600,
            "maxTransactions": 1000
          }
        }
      ]
    },
    "keyRotation": {
      "enabled": true,
      "intervalDays": 30,
      "overlapDays": 2
    }
  }
}
```

## Failover Configuration

The LAYER-2 system supports a multi-level failover system for HSM providers:

1. **Primary Failover**: Between HSM clusters in different availability zones
2. **Secondary Failover**: To an alternative HSM provider
3. **Emergency Failover**: To an ephemeral key provider for critical situations

### Configuration

```json
{
  "keyManager": {
    "failover": {
      "enabled": true,
      "primaryRetryIntervalMs": 5000,
      "maxPrimaryRetries": 3,
      "secondaryRetryIntervalMs": 10000,
      "maxSecondaryRetries": 3,
      "emergencyModeEnabled": true,
      "emergencyModeRestrictions": {
        "maxTransactions": 1000,
        "maxTimeSeconds": 3600,
        "allowedOperations": ["sign"]
      },
      "notifications": {
        "enabled": true,
        "endpoints": [
          {
            "type": "email",
            "address": "admin@example.com"
          },
          {
            "type": "sns",
            "topicArn": "arn:aws:sns:us-east-1:123456789012:hsm-alerts"
          }
        ]
      }
    }
  }
}
```

## Key Rotation

The LAYER-2 system supports automatic key rotation to limit the exposure of cryptographic keys.

### Configuration

```json
{
  "keyManager": {
    "keyRotation": {
      "enabled": true,
      "intervalDays": 30,
      "overlapDays": 2,
      "rotationTime": "00:00:00",
      "timeZone": "UTC",
      "backupEnabled": true,
      "backupLocation": "s3://layer2-key-backups",
      "notifications": {
        "enabled": true,
        "endpoints": [
          {
            "type": "email",
            "address": "admin@example.com"
          }
        ]
      }
    }
  }
}
```

## Monitoring and Alerts

The LAYER-2 system provides comprehensive monitoring and alerting for HSM operations.

### CloudWatch Metrics

The following metrics are published to CloudWatch when using AWS CloudHSM:

- `HSMOperations`: Number of HSM operations performed
- `HSMErrors`: Number of HSM errors encountered
- `HSMLatency`: Latency of HSM operations
- `FailoverEvents`: Number of failover events
- `KeyRotationEvents`: Number of key rotation events

### Logging

HSM operations are logged to CloudWatch Logs with the following log groups:

- `/layer2/hsm/operations`: All HSM operations
- `/layer2/hsm/errors`: HSM errors
- `/layer2/hsm/failover`: Failover events
- `/layer2/hsm/rotation`: Key rotation events

## Troubleshooting

### Common Issues

#### AWS CloudHSM Connection Issues

If you encounter connection issues with AWS CloudHSM:

1. Check that the security group allows traffic on port 2223
2. Verify that the HSM is in the ACTIVE state
3. Check that the client configuration is correct
4. Verify that the crypto user credentials are correct

```bash
aws cloudhsm describe-clusters --cluster-id <cluster-id>
```

#### YubiHSM Connection Issues

If you encounter connection issues with YubiHSM:

1. Check that the YubiHSM device is properly connected
2. Verify that the connector URL is correct
3. Check that the authentication key ID and password are correct
4. Restart the YubiHSM connector service

```bash
sudo systemctl restart yubihsm-connector
```

#### Failover Issues

If failover is not working correctly:

1. Check the failover configuration
2. Verify that all failover providers are properly configured
3. Check the logs for failover events
4. Test the failover manually using the verification script

```bash
./scripts/verify_hsm_integration.sh --test-failover
```

#### Key Rotation Issues

If key rotation is not working correctly:

1. Check the key rotation configuration
2. Verify that the rotation schedule is correct
3. Check the logs for rotation events
4. Test the rotation manually using the verification script

```bash
./scripts/verify_hsm_integration.sh --test-rotation
```

For additional support, please contact the LAYER-2 team at support@layer2.solana.com.

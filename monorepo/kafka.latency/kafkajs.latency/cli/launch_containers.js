// path/to/launchContainers.js

const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const { Client } = require('ssh2');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Set the AWS region
const REGION = 'us-east-1';
const ec2Client = new EC2Client({ region: REGION });

// Add at the top level
const TEST_UUID = uuidv4().slice(0, 8);
const CONSUMERS_PER_INSTANCE = 1;
const PRODUCER_CONTAINERS_PER_INSTANCE = 1;
const PUBLISHERS_PER_CONTAINER = 16;
const PARTITIONS = 36;
const PRODUCER_SLEEP_MS = 1000;
const ITERATIONS = 100; //7200;
const SSH_KEY_FILENAME = 'john.davis.pem';
const CONSUMER_DURATION_SEC = ITERATIONS * (PRODUCER_SLEEP_MS / 1000) + 240; //600;

const generateDockerCommand = (role, containerIndex = 0) => {
    const containerUuid = uuidv4().slice(0, 8);
    const command = `
set -x
source ~/.bashrc
CONTAINER_NAME="kafka-${role}-${containerIndex}-${containerUuid}"
docker pull "$SHASTA_CDK_ECR_REPO_URI":latest
(docker run --rm \
    --name "$CONTAINER_NAME" \
    -e "KAFKA_BROKERS=$BOOTSTRAP_BROKERS" \
    -e DEBUG=kafkajs* \
    "$SHASTA_CDK_ECR_REPO_URI":latest \
    --mode ${role === 'consumer' ? 'consume' : 'publish'} \
    ${role === 'consumer' ? 
        `--duration ${CONSUMER_DURATION_SEC} ` + 
        `--topic latency-test-011-${TEST_UUID} ` +  
        '--brokers "$BOOTSTRAP_BROKERS" ' + 
        `--groupId "latency-test-group-${TEST_UUID}" ` + 
        '--debug true' : 
        `--iterations ${ITERATIONS} ` + 
        `--publishers ${PUBLISHERS_PER_CONTAINER} ` + 
        '--brokers "$BOOTSTRAP_BROKERS" ' + 
        `--partitions ${PARTITIONS} ` + 
        `--sleep ${PRODUCER_SLEEP_MS}`} \
    > /tmp/${role}-${containerIndex}-${containerUuid}.log 2>&1 & )
sleep 2
if docker ps | grep -q "$CONTAINER_NAME"; then
    echo "$CONTAINER_NAME"
else
    echo "Container failed to start. Last few lines of log:"
    tail -n 5 /tmp/${role}-${containerIndex}-${containerUuid}.log
    exit 1
fi
`;

    return {
        command: command.trim(),
        uuid: containerUuid,
        containerName: `kafka-${role}-${containerIndex}-${containerUuid}`
    };
};

const generateDockerLoginCommand = () => {
    return `
        set -x  # Enable command tracing
        source ~/.bashrc
        echo "SHASTA_CDK_ECR_REPO_URI=$SHASTA_CDK_ECR_REPO_URI"
        if [ -z "$SHASTA_CDK_ECR_REPO_URI" ]; then
            echo "Error: SHASTA_CDK_ECR_REPO_URI is not set"
            exit 1
        fi
        # Get AWS account ID from the ECR repo URI
        AWS_ACCOUNT_ID=$(echo "$SHASTA_CDK_ECR_REPO_URI" | cut -d. -f1)
        AWS_REGION=us-east-1
        
        # Authenticate with ECR directly using the account ID
        aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com" || {
            echo "Docker login failed with status $?"
            docker info
            aws sts get-caller-identity
            exit 1
        }
    `;
};

// Update getBastionHostDns to look for the correct tag
const getBastionHostDns = async () => {
    const params = {
        Filters: [
            { 
                Name: 'tag:Name', 
                Values: ['ShastaCdkStackL2/BastionHost'] // Updated tag name
            },
            { 
                Name: 'instance-state-name', 
                Values: ['running'] 
            }
        ]
    };

    try {
        const data = await ec2Client.send(new DescribeInstancesCommand(params));
        const bastionHost = data.Reservations[0]?.Instances[0];
        if (!bastionHost?.PublicDnsName) {
            throw new Error('Bastion host not found or missing public DNS');
        }
        return bastionHost.PublicDnsName;
    } catch (error) {
        console.error('Error fetching bastion host:', error.message);
        throw error;
    }
};

// Add debug logging function
const debug = (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[DEBUG ${timestamp}] ${message}`);
};

// Update setupBastionHost with more logging
const setupBastionHost = async () => {
    debug('Starting bastion host setup...');
    const bastionDns = await getBastionHostDns();
    debug(`Found bastion DNS: ${bastionDns}`);
    
    // Create a direct connection to bastion
    const conn = new Client();
    
    try {
        await new Promise((resolve, reject) => {
            debug('Attempting to connect to bastion host...');
            
            conn.on('error', (err) => {
                debug(`SSH connection error: ${err.message}`);
                reject(err);
            });

            conn.on('ready', async () => {
                debug('SSH connection established with bastion host');
                
                // Create .ssh directory and set permissions
                const setupCommands = [
                    'mkdir -p ~/.ssh',
                    'chmod 700 ~/.ssh',
                ];
                
                for (const cmd of setupCommands) {
                    debug(`Executing setup command: ${cmd}`);
                    await new Promise((resolveCmd, rejectCmd) => {
                        conn.exec(cmd, (err, stream) => {
                            if (err) {
                                debug(`Command execution error: ${err.message}`);
                                rejectCmd(err);
                                return;
                            }
                            
                            stream.on('data', (data) => {
                                debug(`STDOUT: ${data}`);
                            });
                            
                            stream.stderr.on('data', (data) => {
                                debug(`STDERR: ${data}`);
                            });
                            
                            stream.on('close', (code) => {
                                debug(`Command completed with code: ${code}`);
                                if (code !== 0) {
                                    rejectCmd(new Error(`Command failed with code ${code}`));
                                } else {
                                    resolveCmd();
                                }
                            });
                        });
                    });
                }
                
                // Copy the key file to bastion
                debug('Reading local SSH key file...');
                const keyPath = `/root/.ssh/${SSH_KEY_FILENAME}`;
                let keyContent;
                try {
                    keyContent = fs.readFileSync(keyPath, 'utf8');
                    debug('Successfully read SSH key file');
                } catch (error) {
                    debug(`Error reading SSH key file: ${error.message}`);
                    throw error;
                }
                
                const remotePath = `/home/ec2-user/.ssh/${SSH_KEY_FILENAME}`;
                debug(`Copying SSH key to bastion at ${remotePath}`);
                
                await new Promise((resolveWrite, rejectWrite) => {
                    const writeCommand = `cat > ${remotePath} << 'EOL'\n${keyContent}\nEOL`;
                    debug('Executing key write command...');
                    
                    conn.exec(writeCommand, (err, stream) => {
                        if (err) {
                            debug(`Key write error: ${err.message}`);
                            rejectWrite(err);
                            return;
                        }
                        
                        stream.on('data', (data) => {
                            debug(`Key write STDOUT: ${data}`);
                        });
                        
                        stream.stderr.on('data', (data) => {
                            debug(`Key write STDERR: ${data}`);
                        });
                        
                        stream.on('close', (code) => {
                            debug(`Key write completed with code: ${code}`);
                            if (code !== 0) {
                                rejectWrite(new Error(`Failed to write key file with code ${code}`));
                            } else {
                                resolveWrite();
                            }
                        });
                    });
                });
                
                // Set correct permissions on key file
                debug('Setting key file permissions...');
                await new Promise((resolveChmod, rejectChmod) => {
                    const chmodCommand = `chmod 600 ${remotePath}`;
                    debug(`Executing chmod command: ${chmodCommand}`);
                    
                    conn.exec(chmodCommand, (err, stream) => {
                        if (err) {
                            debug(`Chmod error: ${err.message}`);
                            rejectChmod(err);
                            return;
                        }
                        
                        stream.on('data', (data) => {
                            debug(`Chmod STDOUT: ${data}`);
                        });
                        
                        stream.stderr.on('data', (data) => {
                            debug(`Chmod STDERR: ${data}`);
                        });
                        
                        stream.on('close', (code) => {
                            debug(`Chmod completed with code: ${code}`);
                            if (code !== 0) {
                                rejectChmod(new Error(`Failed to chmod key file with code ${code}`));
                            } else {
                                resolveChmod();
                            }
                        });
                    });
                });
                
                debug('✓ Bastion host setup completed successfully');
                resolve();
            }).connect({
                host: bastionDns,
                username: 'ec2-user',
                privateKey: fs.readFileSync(`/root/.ssh/${SSH_KEY_FILENAME}`),
                debug: true  // Enable SSH debug logging
            });
        });
    } catch (error) {
        debug(`Bastion setup failed: ${error.message}`);
        throw error;
    } finally {
        debug('Closing bastion connection');
        conn.end();
    }
};

// Update executeSSHCommand to show more error details
const executeSSHCommand = async (targetHost, command, maxRetries = 3) => {
    const bastionDns = await getBastionHostDns();
    debug(`Executing command on ${targetHost} via bastion ${bastionDns}`);
    debug(`Command to execute: ${command}`);
    
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        debug(`Attempt ${attempt}/${maxRetries}`);
        try {
            return await new Promise((resolve, reject) => {
                const conn = new Client();
                
                conn.on('error', (err) => {
                    debug(`SSH connection error: ${err.message}`);
                    reject(err);
                });
                
                conn.on('ready', () => {
                    debug('SSH connection established');
                    const proxyCommand = `ssh -i /home/ec2-user/.ssh/${SSH_KEY_FILENAME} -o StrictHostKeyChecking=no ec2-user@${targetHost} 'bash -s' << 'ENDSSH'\n${command}\nENDSSH`;
                    debug(`Executing proxy command: ${proxyCommand}`);
                    
                    conn.exec(proxyCommand, (err, stream) => {
                        if (err) {
                            debug(`Command execution error: ${err.message}`);
                            conn.end();
                            reject(err);
                            return;
                        }
                        
                        let output = '';
                        let errorOutput = '';
                        
                        stream.stdout.on('data', (data) => {
                            const str = data.toString();
                            output += str;
                            debug(`STDOUT: ${str.trim()}`);
                        });
                        
                        stream.stderr.on('data', (data) => {
                            const str = data.toString();
                            errorOutput += str;
                            debug(`STDERR: ${str.trim()}`);
                        });
                        
                        stream.on('close', (code) => {
                            debug(`Command completed with exit code: ${code}`);
                            conn.end();
                            if (code !== 0) {
                                const errorMsg = `Command failed with code ${code}:\nSTDOUT: ${output}\nSTDERR: ${errorOutput}`;
                                debug(`Error details: ${errorMsg}`);
                                reject(new Error(errorMsg));
                            } else {
                                resolve(output);
                            }
                        });
                    });
                }).connect({
                    host: bastionDns,
                    username: 'ec2-user',
                    privateKey: fs.readFileSync(`/root/.ssh/${SSH_KEY_FILENAME}`),
                    debug: true
                });
            });
        } catch (error) {
            debug(`Attempt ${attempt} failed: ${error.message}`);
            lastError = error;
            if (attempt < maxRetries) {
                debug(`Waiting 5 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    throw lastError;
};

const ensureDockerRunning = async (publicDnsName) => {
    console.log('\nEnsuring Docker is running...');
    try {
        // Start Docker service if not running
        await executeSSHCommand(publicDnsName, 'sudo systemctl start docker');
        
        // Wait for Docker to be ready
        let retries = 5;
        while (retries > 0) {
            try {
                await executeSSHCommand(publicDnsName, 'docker ps');
                console.log('✓ Docker is running');
                return;
            } catch (error) {
                retries--;
                if (retries === 0) {
                    throw new Error('Docker failed to start');
                }
                console.log(`Waiting for Docker to be ready... (${retries} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    } catch (error) {
        throw new Error(`Failed to start Docker: ${error.message}`);
    }
};

// Update launchContainersOnInstance to use private DNS
const launchContainersOnInstance = async (instanceId, role, containerIndex = 0) => {
    console.log(`\nFetching DNS for instance ${instanceId}...`);
    const instanceData = await ec2Client.send(new DescribeInstancesCommand({
        InstanceIds: [instanceId]
    }));
    
    const privateDnsName = instanceData.Reservations[0].Instances[0].PrivateDnsName;
    if (!privateDnsName) {
        throw new Error(`No private DNS found for instance ${instanceId}`);
    }

    const { command: dockerCommand, containerName } = generateDockerCommand(role, containerIndex);
    const dockerLoginCommand = generateDockerLoginCommand();

    console.log(`\n=== Launching ${role} container ${containerIndex + 1} on ${privateDnsName} (${instanceId}) ===`);
    
    try {
        // Ensure Docker is running before proceeding
        await ensureDockerRunning(privateDnsName);
        
        // Step 1: Docker login
        console.log('\nStep 1: Docker login');
        await executeSSHCommand(privateDnsName, dockerLoginCommand);
        
        // Step 2: Launch container
        console.log('\nStep 2: Container launch');
        const result = await executeSSHCommand(privateDnsName, dockerCommand);
        const returnedContainerName = result.trim();
        
        if (!returnedContainerName) {
            throw new Error('Container name not returned from launch command');
        }
        
        console.log(`Container name: ${returnedContainerName}`);
        
        // Step 3: Poll container status
        console.log('\nStep 3: Polling container status...');
        let retries = 10;
        while (retries > 0) {
            try {
                const status = await executeSSHCommand(privateDnsName, 
                    `docker ps --format '{{.Names}} {{.Status}}' | grep "^${containerName}\\s"`
                );
                if (status) {
                    console.log(`Container status: ${status.trim()}`);
                    console.log(`✓ Container verified running on ${privateDnsName}`);
                    return;
                }
            } catch (error) {
                // Container not found in docker ps
            }
            
            retries--;
            if (retries === 0) {
                const logs = await executeSSHCommand(privateDnsName, 
                    `tail -n 20 /tmp/${role}-${containerIndex}-*.log`
                );
                console.error('\nContainer logs:', logs);
                
                if (logs.includes('[ConsumerGroup] Consumer has joined the group') || 
                    logs.includes('[Producer] Connected')) {
                    console.log('✓ Container appears to be running based on logs');
                    return;
                }
                
                throw new Error('Container failed to start');
            }
            
            console.log(`Waiting for container to start... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    } catch (error) {
        console.error(`\n✗ Failed to launch container on ${privateDnsName}:`, error.message);
        throw error;
    }
};

// Modify getInstancesByRole to return private DNS names
const getInstancesByRole = async (role) => {
    const params = {
        Filters: [
            { Name: 'tag:shasta-role', Values: [role] },
            { Name: 'instance-state-name', Values: ['running'] }
        ]
    };

    try {
        const data = await ec2Client.send(new DescribeInstancesCommand(params));
        return data.Reservations.flatMap(reservation => 
            reservation.Instances.map(instance => ({
                id: instance.InstanceId,
                privateDns: instance.PrivateDnsName // Use private DNS instead of public
            }))
        );
    } catch (error) {
        console.error(`Error fetching ${role} instances: ${error.message}`);
        return [];
    }
};

const collectTestResults = async (instances, role) => {
    console.log(`\nCollecting ${role} test results...`);
    
    // Create results directory if it doesn't exist
    const resultsDir = path.join(__dirname, 'test_results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }
    
    // Collect results from each instance
    for (const instance of instances) {
        // Use instance.id instead of passing the whole instance object
        const instanceData = await ec2Client.send(new DescribeInstancesCommand({
            InstanceIds: [instance.id]  // <-- Fix is here
        }));
        const privateDns = instanceData.Reservations[0].Instances[0].PrivateDnsName;
        
        // Extract summary records from all log files for this role
        const command = `grep "overall_summary" /tmp/${role}-*.log`;
        
        try {
            const results = await executeSSHCommand(privateDns, command);
            // Write results to local file
            fs.writeFileSync(
                `${resultsDir}/${privateDns}_${role}_summary.txt`,
                results
            );
            console.log(`Collected ${role} results from ${privateDns}`);
        } catch (error) {
            console.error(`Failed to collect results from ${privateDns}:`, error.message);
        }
    }
};

// Add new function to collect Docker logs
const collectDockerLogs = async (instances) => {
    console.log('\nCollecting Docker logs...');
    
    // Create results directory if it doesn't exist
    const resultsDir = path.join(__dirname, 'test_results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }

    for (const instance of instances) {
        const instanceData = await ec2Client.send(new DescribeInstancesCommand({
            InstanceIds: [instance.id]
        }));
        const privateDns = instanceData.Reservations[0].Instances[0].PrivateDnsName;
        
        try {
            // Create log directory on remote instance
            await executeSSHCommand(privateDns, 'mkdir -p /tmp/loadtest');
            
            // Get all container IDs for kafka containers
            const command = `
                for container in $(docker ps -a --filter "name=kafka-" --format "{{.Names}}"); do
                    echo "Collecting logs for $container..."
                    docker logs $container > "/tmp/loadtest/$container.log" 2>&1
                done
            `;
            
            await executeSSHCommand(privateDns, command);
            console.log(`Collected Docker logs from ${privateDns}`);
        } catch (error) {
            console.error(`Failed to collect Docker logs from ${privateDns}:`, error.message);
        }
    }
};

// Update start function to include Docker log collection
const start = async () => {
    console.log("Starting container launch process...");

    // Setup bastion host first
    await setupBastionHost();

    // Get all instances first
    console.log("Fetching instances...");
    const consumerInstances = await getInstancesByRole("consumer");
    const producerInstances = await getInstancesByRole("producer");
    console.log(`Found ${consumerInstances.length} consumer instances and ${producerInstances.length} producer instances`);

    // Clear old log files from all instances
    console.log("Clearing old log files...");
    const clearLogsCommand = 'rm -f /tmp/consumer-*.log /tmp/producer-*.log';
    for (const instance of [...consumerInstances, ...producerInstances]) {
        try {
            const instanceData = await ec2Client.send(new DescribeInstancesCommand({
                InstanceIds: [instance.id]  // Use instance.id instead of the whole object
            }));
            const privateDns = instanceData.Reservations[0].Instances[0].PrivateDnsName;
            await executeSSHCommand(privateDns, clearLogsCommand);
            console.log(`Cleared old logs from ${privateDns}`);
        } catch (error) {
            console.error(`Failed to clear logs from instance ${instance.id}:`, error.message);
        }
    }

    // Launch consumer containers sequentially
    console.log("Launching consumer containers...");
    for (const instance of consumerInstances) {
        console.log(`Launching consumer containers on instance ${instance.id}`);
        for (let i = 0; i < CONSUMERS_PER_INSTANCE; i++) {
            console.log(`Launching consumer container ${i + 1}/${CONSUMERS_PER_INSTANCE}`);
            await launchContainersOnInstance(instance.id, "consumer", i);
            // Wait 2 seconds between container launches
            if (i < CONSUMERS_PER_INSTANCE - 1) await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    console.log("Waiting 60 seconds before launching producer containers...");
    await new Promise(resolve => setTimeout(resolve, 60000));

    // Launch producer containers sequentially
    console.log("Launching producer containers...");
    for (const instance of producerInstances) {
        console.log(`Launching producer containers on instance ${instance.id}`);
        for (let i = 0; i < PRODUCER_CONTAINERS_PER_INSTANCE; i++) {
            console.log(`Launching producer container ${i + 1}/${PRODUCER_CONTAINERS_PER_INSTANCE}`);
            await launchContainersOnInstance(instance.id, "producer", i);
            // Wait 2 seconds between container launches
            if (i < PRODUCER_CONTAINERS_PER_INSTANCE - 1) await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    console.log("Container launch process completed.");
    
    const testDuration = CONSUMER_DURATION_SEC;
    console.log(`Waiting ${testDuration} seconds for test completion...`);
    await new Promise(resolve => setTimeout(resolve, testDuration * 1000));
    
    console.log("Collecting test results...");
    await collectTestResults(consumerInstances, "consumer");
    await collectTestResults(producerInstances, "producer");
    
    console.log("Collecting Docker logs...");
    await collectDockerLogs([...consumerInstances, ...producerInstances]);
    
    console.log("Test results and Docker logs collection completed.");
};

start();

import { Kafka, logLevel } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { writeFileSync, appendFileSync, unlinkSync, existsSync } from 'fs';

const getKafkaClient = async () => {
  const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',').map(broker => broker.trim()) : 
                  (process.argv.includes('--brokers') ? process.argv[process.argv.indexOf('--brokers') + 1].split(',').map(broker => broker.trim()) : 
                  ['redpanda:29092']);
  
  // Detect if we're connecting to MSK (looking for AWS domain)
  const isMSK = brokers.some(broker => broker.includes('.kafka.us-east-1.amazonaws.com'));
  const ssl = false; // isMSK; // Enable SSL only for MSK

  console.log(JSON.stringify({
    event: 'kafka_client_config',
    brokers,
    ssl,
    environment: isMSK ? 'msk' : 'redpanda'
  }));

  const kafka = new Kafka({
    clientId: 'latency-test',
    brokers,
  });

  // Create an admin client to fetch broker information
  const admin = kafka.admin();
  await admin.connect();
  
  try {
    const metadata = await admin.describeCluster();
    console.log(JSON.stringify({
      event: 'kafka_broker_info_006',
      controllerId: metadata.controller,
      brokerCount: metadata.brokers.length,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'kafka_broker_info_error',
      error: error instanceof Error ? error.message : String(error)
    }));
  } finally {
    await admin.disconnect();
  }

  return kafka;
};

interface Message {
  uuid: string;
  timestamp: number;
  seqno: number;
  payload: string;
}

interface LatencyResult {
  uuid: string;
  latencyMs: number;
  seqno: number;
}

async function publish(
  topic: string,
  iterations: number,
  partitions: number,
  payloadSize: number,
  sleepMs: number,
  publisherIndex: number
) {
  const kafka = await getKafkaClient();
  const producer = kafka.producer({
    allowAutoTopicCreation: true,
  });
  const admin = kafka.admin();

  // Connect both producer and admin clients
  await Promise.all([producer.connect(), admin.connect()]);

  // Ensure the topic exists with the specified number of partitions
  const topics = await admin.listTopics();
  if (!topics.includes(topic)) {
    await admin.createTopics({
      topics: [
        {
          topic,
          numPartitions: partitions,
          replicationFactor: 1,
        },
      ],
    });
    console.log(
      JSON.stringify({
        event: 'topic_created',
        topic,
        partitions,
        replicationFactor: 1,
      })
    );
  } else {
    console.log(
      JSON.stringify({
        event: 'topic_exists',
        topic,
      })
    );
  }

  // Disconnect the admin client as it's no longer needed
  await admin.disconnect();

  const producerUuid = uuidv4();

  console.log(
    JSON.stringify({
      event: 'publish_start',
      iterations,
      topic,
      producerUuid,
      publisherIndex,
    })
  );

  for (let i = 0; i < iterations; i++) {
    const message: Message = {
      uuid: producerUuid,
      timestamp: Date.now(),
      seqno: i,
      payload: 'x'.repeat(payloadSize),
    };
    await producer.send({
      topic,
      acks: 1,
      messages: [
        { key: producerUuid, value: JSON.stringify(message) },
      ],
    });
    console.log(
      JSON.stringify({
        event: 'message_published',
        messageNumber: i + 1,
        totalMessages: iterations,
        uuid: message.uuid,
        seqno: message.seqno,
        publisherIndex,
      })
    );

    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  await producer.disconnect();
  console.log(
    JSON.stringify({
      event: 'publish_complete',
      topic,
      producerUuid,
      publisherIndex,
    })
  );
}

async function consume(topic: string, durationSec: number, partitions: number, groupId?: string) {
  // Delete existing files if they exist
  const statsFile = '/tmp/kafka-latency-stats.jsonl';
  const eventsFile = '/tmp/kafka-latency-events.jsonl';
  if (existsSync(statsFile)) {
    unlinkSync(statsFile);
  }
  if (existsSync(eventsFile)) {
    unlinkSync(eventsFile);
  }

  const results: LatencyResult[] = [];
  const lastSeqnoByProducer = new Map<string, number>();
  const kafka = await getKafkaClient();
  
  // Add admin client for topic creation
  const admin = kafka.admin();
  await admin.connect();

  // Try to create topic, continue if it fails
  try {
    await admin.createTopics({
      topics: [
        {
          topic,
          numPartitions: partitions,
          replicationFactor: 1,
        },
      ],
    });
    console.log(JSON.stringify({
      event: 'topic_created',
      topic,
      partitions,
      replicationFactor: 1,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      event: 'topic_creation_skipped',
      topic,
      error: error instanceof Error ? error.message : String(error)
    }));
  }

  await admin.disconnect();
  
  // Use provided groupId or default
  const consumerGroupId = groupId || 'latency-group';
  
  const consumer = kafka.consumer({
    groupId: consumerGroupId,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    rebalanceTimeout: 60000,
    maxBytesPerPartition: 1048576,
    retry: {
      initialRetryTime: 100,
      retries: 8
    }
  });
  
  // Add error handler
  consumer.on(consumer.events.CRASH, function(e) {
    console.error('Consumer crashed!', e);
  });

  // Add rebalance listener
  consumer.on(consumer.events.GROUP_JOIN, function(e) {
    console.log('Consumer joined group:', e);
  });

  await consumer.connect();
  
  // Subscribe to only new messages
  await consumer.subscribe({ 
    topic,
    fromBeginning: false
  });

  console.log(JSON.stringify({
    event: 'consumer_subscribed',
    topic,
    groupId: consumerGroupId,
    timestamp: Date.now()
  }));
  appendFileSync(eventsFile, JSON.stringify({
    event: 'consumer_subscribed',
    topic,
    groupId: consumerGroupId,
    timestamp: Date.now()
  }) + '\n');

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 1000,
    eachMessage: async ({ message, partition }) => {
      const receivedTime = Date.now();
      console.log(JSON.stringify({
        event: 'raw_message_received',
        partition,
        offset: message.offset,
        timestamp: receivedTime
      }));

      const { uuid, timestamp, seqno } = JSON.parse(message.value?.toString() || '');
      
      if (receivedTime - timestamp > 30000) {
        return;
      }

      if (!lastSeqnoByProducer.has(uuid)) {
        lastSeqnoByProducer.set(uuid, -1);
      }

      const lastSeqno = lastSeqnoByProducer.get(uuid)!;

      if (seqno <= lastSeqno) {
        console.log(JSON.stringify({
          event: 'duplicate_message',
          seqno,
          uuid,
          lastSeqno
        }));
        return;
      }

      if (seqno !== lastSeqno + 1) {
        console.log(JSON.stringify({
          event: 'out_of_order_message',
          expectedSeqno: lastSeqno + 1,
          receivedSeqno: seqno,
          uuid,
          gap: seqno - (lastSeqno + 1)
        }));
      }

      lastSeqnoByProducer.set(uuid, seqno);
      
      const latencyMs = receivedTime - timestamp;
      results.push({ uuid, latencyMs, seqno });
      const eventData = {
        event: 'message_received',
        uuid,
        latencyMs,
        seqno,
        expectedSeqno: lastSeqno + 1
      };
      console.log(JSON.stringify(eventData));
      appendFileSync(eventsFile, JSON.stringify(eventData) + '\n');
    },
  });

  await new Promise(resolve => setTimeout(resolve, durationSec * 1000));

  // Add check for empty results
  if (results.length === 0) {
    const emptyStats = {
      event: 'overall_summary',
      averageLatencyMs: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      medianLatencyMs: 0,
      p99LatencyMs: 0,
      p999LatencyMs: 0,
      p9999LatencyMs: 0,
      totalMessages: 0,
      producerCount: 0,
      note: 'No messages received during the consumption period'
    };
    console.log(JSON.stringify(emptyStats));
    appendFileSync(statsFile, JSON.stringify(emptyStats) + '\n');
    appendFileSync(eventsFile, JSON.stringify(emptyStats) + '\n');
    await consumer.disconnect();
    process.exit(0);
    return;
  }

  // Calculate per-producer statistics
  const statsByProducer = new Map<string, { totalLatency: number, count: number }>();
  
  results.forEach(({ uuid, latencyMs }) => {
    if (!statsByProducer.has(uuid)) {
      statsByProducer.set(uuid, { totalLatency: 0, count: 0 });
    }
    const stats = statsByProducer.get(uuid)!;
    stats.totalLatency += latencyMs;
    stats.count += 1;
  });

  // Log per-producer averages
  for (const [uuid, stats] of statsByProducer.entries()) {
    const avgLatency = stats.totalLatency / stats.count;
    const producerStats = {
      event: 'producer_summary',
      uuid,
      averageLatencyMs: Number(avgLatency.toFixed(2)),
      messageCount: stats.count,
      expectedMessages: lastSeqnoByProducer.get(uuid)! + 1
    };
    console.log(JSON.stringify(producerStats));
    appendFileSync(statsFile, JSON.stringify(producerStats) + '\n');
    appendFileSync(eventsFile, JSON.stringify(producerStats) + '\n');
  }

  // Overall summary
  const avgLatency = results.reduce((sum, { latencyMs }) => sum + latencyMs, 0) / results.length;
  console.log(JSON.stringify({
    event: 'overall_summary',
    averageLatencyMs: Number(avgLatency.toFixed(2)),
    totalMessages: results.length,
    producerCount: statsByProducer.size
  }));

  // Calculate detailed statistics
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const mean = avgLatency;
  const median = latencies[Math.floor(latencies.length / 2)];
  
  // Calculate percentiles
  const getPercentile = (arr: number[], p: number) => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[index];
  };
  
  const p99 = getPercentile(latencies, 99);
  const p999 = getPercentile(latencies, 99.9);
  const p9999 = getPercentile(latencies, 99.99);

  // Modified overall summary with additional metrics
  const overallStats = {
    event: 'overall_summary',
    averageLatencyMs: Number(mean.toFixed(2)),
    minLatencyMs: Number(min.toFixed(2)),
    maxLatencyMs: Number(max.toFixed(2)),
    medianLatencyMs: Number(median.toFixed(2)),
    p99LatencyMs: Number(p99.toFixed(2)),
    p999LatencyMs: Number(p999.toFixed(2)),
    p9999LatencyMs: Number(p9999.toFixed(2)),
    totalMessages: results.length,
    producerCount: statsByProducer.size
  };
  console.log(JSON.stringify(overallStats));
  appendFileSync(statsFile, JSON.stringify(overallStats) + '\n');
  appendFileSync(eventsFile, JSON.stringify(overallStats) + '\n');

  await consumer.disconnect();
  process.exit(0);
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 --mode <mode> [options]')
    .option('mode', {
      alias: 'm',
      choices: ['publish', 'consume'] as const,
      demandOption: true,
      description: 'Operation mode',
    })
    .option('iterations', {
      alias: 'i',
      type: 'number',
      description: 'Number of messages to publish (publish mode only)',
      default: 10,
      coerce: (arg) => {
        const val = parseInt(arg);
        if (isNaN(val) || val <= 0) {
          throw new Error('Iterations must be a positive number');
        }
        return val;
      },
    })
    .option('duration', {
      alias: 'd',
      type: 'number',
      description: 'Duration to consume messages in seconds (consume mode only)',
      default: 30,
      coerce: (arg) => {
        const val = parseInt(arg);
        if (isNaN(val) || val <= 0) {
          throw new Error('Duration must be a positive number');
        }
        return val;
      },
    })
    .option('topic', {
      alias: 't',
      type: 'string',
      description: 'Kafka topic',
      default: 'latency-test',
      coerce: (arg) => {
        if (!arg || typeof arg !== 'string' || !arg.trim()) {
          throw new Error('Topic must be a non-empty string');
        }
        return arg.trim();
      },
    })
    .option('partitions', {
      alias: 'p',
      type: 'number',
      description: 'Number of partitions for the topic',
      default: 256,
      coerce: (arg) => {
        const val = parseInt(arg);
        if (isNaN(val) || val <= 0) {
          throw new Error('Partition count must be a positive number');
        }
        return val;
      },
    })
    .option('payloadSize', {
      alias: 's',
      type: 'number',
      description: 'Size of message payload in bytes (approximate)',
      default: 512,
      coerce: (arg) => {
        const val = parseInt(arg);
        if (isNaN(val) || val < 0) {
          throw new Error('Payload size must be a non-negative number');
        }
        return val;
      },
    })
    .option('sleep', {
      type: 'number',
      description: 'Sleep duration between publishes in milliseconds',
      default: 0,
      coerce: (arg) => {
        const val = parseInt(arg);
        if (isNaN(val) || val < 0) {
          throw new Error('Sleep duration must be a non-negative number');
        }
        return val;
      },
    })
    .option('publishers', {
      alias: 'n',
      type: 'number',
      description: 'Number of parallel publishers to launch',
      default: 1,
      coerce: (arg) => {
        const val = parseInt(arg);
        if (isNaN(val) || val <= 0) {
          throw new Error('Number of publishers must be a positive number');
        }
        return val;
      },
    })
    .option('brokers', {
      type: 'string',
      description: 'Comma-separated list of Kafka brokers',
      coerce: (arg) => {
        if (!arg || typeof arg !== 'string' || !arg.trim()) {
          return undefined;
        }
        return arg.trim();
      },
    })
    .option('groupId', {
      type: 'string',
      description: 'Consumer group ID (consume mode only)',
      default: 'latency-group',
      coerce: (arg) => {
        if (!arg || typeof arg !== 'string' || !arg.trim()) {
          return 'latency-group';
        }
        return arg.trim();
      },
    })
    .example('$0 --mode publish --iterations 100', 'Publish 100 messages')
    .example('$0 --mode consume --duration 60', 'Consume messages for 60 seconds')
    .example('$0 --mode publish --partitions 32', 'Publish with 32 partitions')
    .epilog('For more information, visit: https://github.com/airtimemedia/kafka-poc')
    .wrap(yargs.terminalWidth())
    .check((argv) => {
      return true;
    })
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'v')
    .argv;

  // Set brokers environment variable
  process.env.KAFKA_BROKERS = argv.brokers;

  if (argv.mode === 'publish') {
    // Launch n publishers in parallel
    const publishPromises = Array.from({ length: argv.publishers }, (_, index) => {
      console.log(JSON.stringify({
        event: 'spawning_publisher',
        publisherNumber: index + 1,
        totalPublishers: argv.publishers,
        publisherIndex: index
      }));
      return publish(argv.topic, argv.iterations, argv.partitions, argv.payloadSize, argv.sleep, index);
    });
    await Promise.all(publishPromises);
  } else {
    await consume(argv.topic, argv.duration, argv.partitions, argv.groupId);
  }
}

main().catch(console.error);

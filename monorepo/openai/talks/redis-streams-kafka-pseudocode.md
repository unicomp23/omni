```typescript
import { Kafka } from "kafkajs";
import { createClient } from "node-redis";
import { AsyncQueue } from "esfx";

class PubSub {
  kafka: Kafka;
  topic: string;
  redisClient: any;

  constructor(topic: string) {
    this.topic = topic;
    this.kafka = new Kafka({
      clientId: "PubSub",
      brokers: ["localhost:9092"],
    });
    this.redisClient = createClient();
  }

  async publish(partitionKey: string, message: any): Promise<void> {
    const producer = this.kafka.producer();

    await producer.connect();
    await producer.send({
      topic: this.topic,
      messages: [
        { key: partitionKey, value: JSON.stringify(message) },
      ],
    });

    await producer.disconnect();
  }

  async subscribe(partitionKey: string): Promise<AsyncQueue<any>> {
    const queue = new AsyncQueue<any>();

    const getSnapshot = async (): Promise<[string, any]> => {
      const snapshot = await this.redisClient.hget(partitionKey, 'snapshot');
      if (!snapshot) throw new Error('No snapshot available.');
      return [snapshot.seqno, snapshot.value];
    };

    const readRedisStream = async (seqno: string) => {
      const entries = await this.redisClient.xrange(partitionKey, seqno, '+');
      entries.forEach(([id, entry]) => {
        const message = entry.find(val => val === "value")!;
        queue.write(JSON.parse(message));
      });
    };

    getSnapshot().then(([seqno, initialValue]) => {
      queue.write(initialValue);
      setInterval(() => readRedisStream(seqno), 1000); // poll every second
    });

    return queue;
  }

  async worker(): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: 'PubSub' });

    await consumer.connect();
    await consumer.subscribe({ topic: this.topic });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const partitionKey = message.key.toString();
        const payload = JSON.parse(message.value.toString());

        const seqno = await this.redisClient.incr(`seqno:${partitionKey}`);
        payload.seqno = seqno;

        await this.redisClient.hmset(partitionKey, 'snapshot', payload);
        await this.redisClient.xadd(partitionKey, '*', 'value', JSON.stringify(payload));
      },
    });
  }
}

// Example usage of the PubSub class:

const pubsub = new PubSub("exampleTopic");

// Example of a pubsub subscriber
pubsub.subscribe("examplePartitionKey").then(queue => {
  (async () => {
    for await (const entry of queue) {
      console.log("Subscriber received:", entry);
    }
  })();
});

// Example of a pubsub publisher
(async () => {
  await pubsub.publish("examplePartitionKey", { foo: 'bar' });
})();

// Example of a pubsub worker
(async () => {
  await pubsub.worker();
})();
```

```mermaid
sequenceDiagram
    participant PubSub as PubSub Class
    participant KafkaProducer as Kafka Producer
    participant KafkaConsumer as Kafka Consumer
    participant RedisClient as Redis Client
    participant AsyncQueue as Async Queue

    note over PubSub: Initialization
    PubSub->>KafkaProducer: Creates Kafka producer connection
    PubSub->>KafkaConsumer: Creates Kafka consumer connection
    PubSub->>RedisClient: Creates Redis client connection

    note over Publisher: Publishes a message
    Publisher->>PubSub: publish(partitionKey, message)
    PubSub->>KafkaProducer: Sends message to Kafka
    KafkaProducer->>KafkaTopic: Message is stored in Kafka topic

    note over Workers: Processes messages
    KafkaTopic->>KafkaConsumer: Consumes message from Kafka topic
    KafkaConsumer->>PubSub: eachMessage callback triggered
    PubSub->>RedisClient: Stores message snapshot in Redis
    PubSub->>RedisClient: Appends message to Redis stream

    note over Subscriber: Subscribes to messages
    Subscriber->>PubSub: subscribe(partitionKey)
    PubSub->>RedisClient: Gets snapshot from Redis
    PubSub->>AsyncQueue: Writes snapshot to queue
    loop Polls for new messages
        PubSub->>RedisClient: Reads new messages from Redis stream
        PubSub->>AsyncQueue: Writes new messages to queue
    end
    Subscriber->>AsyncQueue: For-await loop consumes messages from the queue
```

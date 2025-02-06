import {AsyncDisposable} from "@esfx/disposable";
import {Consumer, Kafka, logLevel, Producer} from "kafkajs";
import {Redis, RedisOptions} from "ioredis";
import {AsyncQueue} from "@esfx/async";
import {createKafka} from "../common2/createKafka";

const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || "default-client-id";
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "default-topic";
const KAFKA_CONSUMER_GROUP_ID = process.env.KAFKA_CONSUMER_GROUP_ID || "default-group-id";
const REDIS_OPTIONS: RedisOptions = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
};

class PubSub extends AsyncDisposable {
    private kafka: Kafka;
    private producer: Producer;
    private consumer: Consumer;
    private redis: Redis;
    private workerCallCheck: boolean = false;

    constructor() {
        super(async () => {
            await Promise.all([
                this.producer.disconnect(),
                this.consumer.disconnect(),
                this.redis.quit(),
            ]);
        });
        this.kafka = createKafka(KAFKA_CLIENT_ID);

        this.producer = this.kafka.producer();
        this.consumer = this.kafka.consumer({groupId: KAFKA_CONSUMER_GROUP_ID});
        this.redis = new Redis(REDIS_OPTIONS);
    }

    async publish(partitionKey: string, message: string): Promise<void> {
        await this.producer.connect();
        await this.producer.send({
            topic: KAFKA_TOPIC,
            messages: [{key: partitionKey, value: message}]
        });
    }

    async subscribe(partitionKey: string): Promise<AsyncQueue<string>> {
        const queue = new AsyncQueue<string>();

        const [snapshotSeqNo, snapshot] = await this.redis.hmget(`snapshot:${partitionKey}`, 'seqno', 'data');

        if (snapshot) {
            queue.put(snapshot);
        }

        const startId = snapshotSeqNo ? `${snapshotSeqNo}-0` : '0-0';
        const deltas = await this.redis.xrange(`stream:${partitionKey}`, startId, '+');

        for (const delta of deltas) {
            queue.put(delta[1][1]);
        }

        return queue;
    }

    async runWorker(): Promise<void> {
        if (this.workerCallCheck) {
            throw new Error("RunWorker can only be called once.");
        }
        this.workerCallCheck = true;

        await this.consumer.connect();
        await this.consumer.subscribe({topic: KAFKA_TOPIC, fromBeginning: true});

        await this.consumer.run({
            eachMessage: async ({topic, partition, message}) => {
                const partitionKey = message.key?.toString();
                const value = message.value?.toString();
                const seqno = await this.redis.incr(`seqno:${partitionKey}`);

                if (partitionKey && value) {
                    // Store the snapshot in Redis hash
                    await this.redis.hset(
                        `snapshot:${partitionKey}`,
                        'seqno',
                        seqno,
                        'data',
                        value
                    );
                    // Store the delta in Redis stream
                    await this.redis.xadd(
                        `stream:${partitionKey}`,
                        "*",
                        "seqno",
                        seqno,
                        "data",
                        value
                    );
                }

                console.log(`Processed message: key=${partitionKey}, value=${value}`);
            },
        });
    }
}
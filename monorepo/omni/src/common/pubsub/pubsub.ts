import { env } from 'process';
import { PathArray } from "../pathArray/pathArray";
import { Consumer, Kafka, Producer } from "kafkajs";
import { AsyncDisposableStack } from "@esfx/disposable";
import { Message } from "../message/message";
import { AsyncQueue } from "@esfx/async-queue";
import Redis from "ioredis";
import {createKafka} from "../../common2/createKafka";

// Configuration Variables
const KAFKA_TOPIC = env.KAFKA_TOPIC || 'example_topic';
const KAFKA_GROUP_ID = env.KAFKA_GROUP_ID || 'example_group';
const KAFKA_CLIENT_ID = env.KAFKA_CLIENT_ID || 'example_client';
//const KAFKA_BROKERS = (env.KAFKA_BROKERS || 'redpanda:9092').split(',');
const KAFKA_BROKERS = (env.KAFKA_BROKERS || 'boot-mieuwso3.c2.kafka-serverless.us-east-1.amazonaws.com:9098').split(',');

const PARTITION_KEY_PREFIX = "seqno:";
const SNAPSHOT_KEY_PREFIX = "snap:";
const STREAM_KEY_PREFIX = "stream:";
const TAG_PATH_KEY = "tagPath";
const MESSAGE_KEY = "message";
const TTL_KEY = "ttl";
const SEQNO_KEY = "seqno";

export type SeqnoPath = PathArray;
export type TagPath = PathArray;

export class PubSub {
    private producer?: Producer;
    private consumer?: Consumer;
    private kafka: Kafka;
    private redis: Redis;
    private disposables: AsyncDisposableStack;
    private isWorkerRunning: boolean;

    constructor() {
        this.isWorkerRunning = false;
        this.kafka = createKafka(KAFKA_CLIENT_ID),
        this.redis = new Redis({
            host: 'redis',
            port: 6379,
        });
        this.disposables = new AsyncDisposableStack();
    }

    get disposeAsync(): () => Promise<void> {
        return this.disposables.disposeAsync;
    }

    private async lazilyConnectProducer() {
        if (!this.producer) {
            this.producer = this.kafka.producer();
            await this.producer.connect();
            const producer = this.producer;
            this.disposables.use(producer, async () => {
                await producer.disconnect();
            });
        }

        return this.producer;
    }

    public async publish(seqnoPath: SeqnoPath, tagPath: TagPath, message: Message, ttl: number = 0): Promise<void> {
        if (!tagPath.startsWith(seqnoPath)) {
            throw new Error('Invalid input: tagPath must start with seqnoPath');
        }

        const producer = await this.lazilyConnectProducer();

        const serializedMessage = new Message();
        serializedMessage.set(TAG_PATH_KEY, tagPath.serialize());
        serializedMessage.set(MESSAGE_KEY, message.serialize());
        if (ttl > 0) {
            serializedMessage.set(TTL_KEY, ttl.toString());
        }

        await producer.send({
            topic: KAFKA_TOPIC,
            messages: [{ key: `${PARTITION_KEY_PREFIX}${PathArray.serialize(seqnoPath)}`, value: serializedMessage.serialize() }],
        });
    }

    public async subscribe(seqnoPath: SeqnoPath) {
        const outputQueue = new AsyncQueue<{ tagPath: TagPath, message: Message }>();

        const snapshotKey = `${SNAPSHOT_KEY_PREFIX}${PathArray.serialize(seqnoPath)}`;

        const snapshot = await this.redis.hgetall(snapshotKey);

        let seqno = "1";
        for (const key in snapshot) {
            // Retrieve seqno first from the snapshot fields
            if (key === SEQNO_KEY) {
                seqno = snapshot[key];
                continue;
            }

            const tagPath = PathArray.deserialize(key);
            const message = Message.deserialize(snapshot[key]);
            outputQueue.put({tagPath: tagPath.pathArray, message: message.message});
        }

        const streamKey = `${STREAM_KEY_PREFIX}${PathArray.serialize(seqnoPath)}`;
        const deltas = await this.redis.xrange(streamKey, seqno, '+');

        for (const delta of deltas) {
            const parts = delta[1];
            const tagPath = PathArray.deserialize(parts[0]);
            const message = Message.deserialize(parts[1]);
            outputQueue.put({tagPath: tagPath.pathArray, message: message.message});
        }

        return outputQueue;
    }

    public async runWorker(): Promise<void> {
        if (this.isWorkerRunning) {
            throw new Error('The is worker already running.');
        }

        this.isWorkerRunning = true;

        this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_ID });
        const consumer = this.consumer;
        this.disposables.use(consumer, async() => {
            await consumer.disconnect();
        });
        await this.consumer.connect();
        await this.consumer.subscribe({ topic: KAFKA_TOPIC });

        await this.consumer.run({
            partitionsConsumedConcurrently: 1,
            eachBatchAutoResolve: false,
            eachMessage: async ({ message, heartbeat }) => {
                if(message.key && message.value) {
                    const seqnoPath = PathArray.deserialize(message.key.toString('utf8').slice(PARTITION_KEY_PREFIX.length)).pathArray;
                    const deserializedMessage = Message.deserialize(message.value.toString('utf8'));
                    const tagPath = PathArray.deserialize(deserializedMessage.message.get(TAG_PATH_KEY) || '');
                    const messageValue = deserializedMessage.message.get(MESSAGE_KEY) || '';
                    const ttl = parseInt(deserializedMessage.message.get(TTL_KEY) || '0');

                    const seqnoKey = `${PARTITION_KEY_PREFIX}${PathArray.serialize(seqnoPath)}`;
                    const snapshotKey = `${SNAPSHOT_KEY_PREFIX}${PathArray.serialize(seqnoPath)}`;
                    const streamKey = `${STREAM_KEY_PREFIX}${PathArray.serialize(seqnoPath)}`;

                    // Get the seqno and use it for xadd
                    const nextSeqno = await this.redis.incr(seqnoKey);

                    await this.redis.multi()
                        .hset(snapshotKey, `${tagPath.pathArray.serialize()}`, messageValue, SEQNO_KEY, nextSeqno)
                        .xadd(streamKey, nextSeqno.toString(), TAG_PATH_KEY, tagPath.pathArray.serialize(), MESSAGE_KEY, messageValue, SEQNO_KEY, nextSeqno)
                        .exec();

                    if (ttl > 0) {
                        await this.redis.pexpire(snapshotKey, ttl);
                        await this.redis.pexpire(streamKey, ttl);
                    }

                    await heartbeat();
                }
            },
        });
    }
}
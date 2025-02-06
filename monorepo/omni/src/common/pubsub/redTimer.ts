import Redis from "ioredis";
import {Consumer, ConsumerEvents, Kafka, Producer} from "kafkajs";
import {AsyncDisposableStack} from "@esfx/disposable";
import {TagDataObjectIdentifier} from "./redShared";

export class RedTimer {
    private redisClient: Redis;
    private kafka: Kafka;
    private consumer?: Consumer;
    private producer?: Producer;
    private disposables: AsyncDisposableStack;

    constructor(redisClient: Redis, kafka: Kafka) {
        this.redisClient = redisClient;
        this.kafka = kafka;
        this.disposables = new AsyncDisposableStack();
    }

    private async lazilyConnectProducer() {
        if (!this.producer) {
            this.producer = this.kafka.producer();
            await this.producer.connect();
            this.disposables.use(this.producer, async () => {
                if(this.producer !== undefined)
                    await this.producer.disconnect();
            });
        }

        return this.producer;
    }

    public async setTimer(tdoi: TagDataObjectIdentifier, timeoutMillis: number): Promise<void> {
        const producer = await this.lazilyConnectProducer();
        const message = {
            key: tdoi.serialize(),
            value: JSON.stringify({ timeout: timeoutMillis }),
        };

        await this.redisClient.hset("currentTimes", tdoi.serialize(), Date.now());
        await producer.send({ topic: "timers", messages: [message] });
    }

    private async pollTimeouts(partition: number) {
        const timeoutsStream = `timeoutsStream:${partition}`;
        while (true) {
            const now = Date.now();
            const events = await this.redisClient.xrange(timeoutsStream, "-", now.toString());
            for (const event of events) {
                const [id, fields] = event;
                const eventData = this.convertFieldsToEventData(fields);

                const tdoi = TagDataObjectIdentifier.deserialize(eventData["tdoi"]);
                const storedTime = await this.redisClient.hget("currentTimes", tdoi.pathArray.serialize()) ?? "0";

                if (now >= parseInt(storedTime) + parseInt(eventData["timeout"])) {
                    console.log(`Timeout occurred for tdoi: ${tdoi.pathArray.serialize()}`);
                }
            }

            await this.sleep(5000);
        }
    }

    private convertFieldsToEventData(fields: string[]): Record<string, string> {
        const eventData: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
            const field = fields[i];
            const value = fields[i + 1];
            eventData[field] = value;
        }
        return eventData;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    public async runWorker(): Promise<void> {
        this.consumer = this.kafka.consumer({ groupId: "timer-group" });
        this.disposables.use(this.consumer, async () => {
            if(this.consumer !== undefined)
                await this.consumer.disconnect();
        });
        await this.consumer.connect();
        await this.consumer.subscribe({ topic: "timers" });

        this.consumer.on('consumer.group_join', async (evt) => {
            evt.payload.
            groupMember.assignedPartitions.forEach(async (partition) => {
                await this.pollTimeouts(partition);
            });
        });

        await this.consumer.run({
            eachMessage: async ({ message }) => {
                if (message.key && message.value) {
                    const tdoi = TagDataObjectIdentifier.deserialize(message.key.toString("utf8"));
                    const eventData = JSON.parse(message.value.toString("utf8"));
                    const timeout = eventData.timeout;

                    const now = Date.now();
                    const timeoutTimestamp = now + timeout;

                    await this.redisClient.xadd(timeoutsStream, timeoutTimestamp.toString(), "tdoi", tdoi.pathArray.serialize());
                }
            },
        });
    }
}

/*
Here's a brief explanation of the `RedTimer` class:

- The constructor initializes the Redis client and Kafka instances and sets up the disposables stack to manage the resources.
- The `lazilyConnectProducer` method ensures that the producer is connected before sending messages.
- The `setTimer` method allows users to set a timer for the given `TagDataObjectIdentifier` and `timeoutMillis`. It sends a message to the Kafka topic "timers" with the serialized tdoi as the partition key and the timeout information as the message value.
- The `pollTimeouts` method is an internal method that polls the Redis stream for timeout events. It runs in a loop, checking the stream for events with timestamps earlier than the current time. When it finds a timeout event, it logs the tdoi associated with the timeout. The loop runs indefinitely until the user explicitly breaks it.
- The `runWorker` method starts a Kafka consumer to process messages from the "timers" topic. It sets up a "GROUP_JOIN" event listener to launch the `pollTimeouts` method. The consumer processes each message and adds the timeout event to the Redis stream with the appropriate timestamp.

    This implementation provides a simple way to manage persisted timeouts using Kafka and Redis. Users can set timers for specific tdois, and the system will notify when a timeout occurs.
*/
import crypto from "crypto";
import { Kafka } from "kafkajs";
import { config as ConfigClass } from "./config";
import {createKafka} from "./common2/createKafka"; // Assuming the provided config class is in the same directory

class config_easy_pubsub {
    private constructor(
        private test_run_id: string
    ) {
    }

    public static create(test_run_id: string) {
        return new config_easy_pubsub(test_run_id);
    }

    // publishers, subscribers, workers
    get_worker_topic() {
        return 'worker-topic' + this.test_run_id;
    }

    get_worker_group_id() {
        return 'worker-group-id' + this.test_run_id;
    }

    get_reply_to_topic() {
        return 'reply-to-topic' + this.test_run_id;
    }

    get_reply_to_group_id() {
        return 'reply-to-group-id' + this.test_run_id;
    }

    /// global
    get_app_id() {
        return 'my_app_id' + this.test_run_id;
    }

    get_kafka_brokers() {
        if (process.env.KAFKA_BROKERS)
            return process.env.KAFKA_BROKERS.split(',');
        return ['redpanda:9092'];
    }

    get_redis_uri() {
        if (process.env.REDIS_URI)
            return process.env.REDIS_URI;
        return 'redis://redis:6379';
    }
}

class config_timeout_publisher {
    private constructor(
        private test_run_id: string
    ) {
    }

    public static create(test_run_id: string) {
        return new config_timeout_publisher(test_run_id);
    }

    /// timeout publisher
    get_timeout_topic() {
        return 'timeout-worker-topic' + this.test_run_id;
    }

    get_timeout_group_id() {
        return 'timeout-worker-group-id' + this.test_run_id;
    }
}

export class config {
    private constructor(
        private test_run_id = "-" + crypto.randomUUID(),
        public readonly easy_pubsub = config_easy_pubsub.create(test_run_id),
        public readonly timeout_publisher = config_timeout_publisher.create(test_run_id),
    ) {
    }

    public static async create() {
        return new config();
    }
}

export async function createTopics(config: ConfigClass): Promise<void> {
    const kafka = createKafka(config.easy_pubsub.get_app_id());

    const admin = kafka.admin();

    const requiredTopics = [
        config.easy_pubsub.get_worker_topic(),
        config.easy_pubsub.get_reply_to_topic(),
        config.timeout_publisher.get_timeout_topic(),
    ];

    try {
        await admin.connect();

        await admin.createTopics({
            topics: requiredTopics.map((topicName) => ({
                topic: topicName,
            })),
            waitForLeaders: true,
        });

        console.log("All topics have been created");
    } catch (error) {
        console.error("Error creating topics:", error);
    } finally {
        try {
            await admin.disconnect();
            console.log("Cleaned up admin client");
        } catch (error) {
            console.error("Error cleaning up admin client:", error);
        }
    }
}

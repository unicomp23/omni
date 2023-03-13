import crypto from "crypto";

class config_easy_pubsub {
    private constructor(
        private test_id = "-" + crypto.randomUUID()
    ) {
    }

    public static create() {
        return new config_easy_pubsub();
    }

    // publishers, workers
    get_worker_topic() {
        return 'worker-topic' + this.test_id;
    }

    get_worker_group_id() {
        return 'worker-group-id' + this.test_id;
    }

    get_reply_to_topic() {
        return 'reply-to-topic' + this.test_id;
    }

    get_reply_to_group_id() {
        return 'reply-to-group-id' + this.test_id;
    }

    /// timeout publisher
    get_timeout_topic() {
        return 'timeout-worker-topic' + this.test_id;
    }

    get_timeout_group_id() {
        return 'timeout-worker-group-id' + this.test_id;
    }


    /// global
    get_app_id() {
        return 'my_app_id' + this.test_id;
    }

    get_kafka_brokers() {
        return ['redpanda:9092'];
    }

    get_redis_uri() {
        if (process.env.REDIS_URI)
            return process.env.REDIS_URI;
        return 'redis://redis:6379';
    }
}

class config_timeout_publisher {
    private constructor() {
    }
    public static create() {
        return new config_timeout_publisher();
    }
}

export class config {
    public readonly easy_pubsub = config_easy_pubsub.create();
    public readonly timeout_publisher = config_timeout_publisher.create();
    private constructor() {
    }
    public static create() {
        return new config();
    }
}

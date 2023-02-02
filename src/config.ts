import crypto from "crypto";

export class config {
    private constructor(
        private test_id = "-" + crypto.randomUUID()
    ) {
    }

    public static create() {
        return new config();
    }

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

    get_app_id() {
        return 'my_app_id' + this.test_id;
    }

    get_kafka_brokers() {
        return ['redpanda:9092'];
    }
}

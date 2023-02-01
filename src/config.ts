export class config {
    private constructor() {
    }

    public static create() {
        return new config();
    }

    get_worker_topic() {
        return 'worker-topic';
    }

    get_reply_to_topic() {
        return 'reply-to-topic';
    }

    get_app_id() {
        return "my_app_id";
    }

    get_kafka_brokers() {
        return ['kafka1:9092', 'kafka2:9092'];
    }

    get_work_consumer_group_id() {
        return 'work_consumer_group';
    }
}

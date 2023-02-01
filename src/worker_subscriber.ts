import {config} from "./config";
import {Kafka} from "kafkajs";
import crypto from "crypto";

class worker_subscriber {
    private constructor(
        private readonly config_ = config.create(),
        readonly topic = config_.get_worker_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly producer = kafka.producer()
    ) {
    }

    public static create() {
        return new worker_subscriber();
    }
}

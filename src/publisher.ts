import {Kafka} from "kafkajs";
import {config} from "./config";
import * as crypto from "crypto";

export class publisher {
    private constructor(
        private readonly config_ = config.create(),
        private readonly topic = config_.get_worker_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        })
    ) {
    }

    public static create() {
        return new publisher();
    }
}
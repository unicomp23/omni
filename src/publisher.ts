import {Kafka} from "kafkajs";
import {config} from "./config";
import * as crypto from "crypto";
import {runner} from "./runner";

export class publisher {
    private constructor(
        private readonly config_ = config.create(),
        private readonly topic = config_.get_worker_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly producer = kafka.producer()
    ) {
    }

    private connected = false;

    public async send() {
        if(!this.connected) {
            await this.producer.connect();
            this.connected = true;
        }
        await this.producer.send({
            topic: this.topic,
            messages: []
        });
    }
    public static create() {
        return new publisher();
    }
}

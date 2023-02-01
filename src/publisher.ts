import {Kafka} from "kafkajs";
import {config} from "./config";
import * as crypto from "crypto";
import {runner} from "./runner";
import {AirCoreFrame} from "../proto/generated/devinternal_pb";

export class publisher {
    private constructor(
        private readonly config_ = config.create(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly producer = kafka.producer()
    ){}

    private connected = false;

    public async send(frame: AirCoreFrame) {
        if(!this.connected) {
            await this.producer.connect();
            this.connected = true;
        }
        const key = frame.sendTo?.kafkaPartitionKey?.toBinary()
        await this.producer.send({
            topic: frame.sendTo!.kafkaTopic,
            messages: [{
                key:Buffer.from(frame.sendTo!.kafkaPartitionKey!.toBinary()),
                value:Buffer.from(frame.toBinary())
            }]
        });
    }
    public static create() {
        return new publisher();
    }
}

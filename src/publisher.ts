import {Kafka} from "kafkajs";
import {config} from "./config";
import * as crypto from "crypto";
import {runner} from "./runner";
import {AirCoreFrame} from "../proto/generated/devinternal_pb";

export class publisher {
    private readonly topic: string;
    private constructor(
        private readonly config_: config,
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly producer = kafka.producer()
    ){
        this.topic = config_.get_worker_topic();
    }

    private connected = false;

    public async send(frame: AirCoreFrame) {
        if(!this.connected) {
            await this.producer.connect();
            this.connected = true;
        }
        const partition_key = frame.sendTo?.kafkaPartitionKey?.toBinary()
        if(partition_key) {
            await this.producer.send({
                topic: this.topic,
                messages: [{
                    key:Buffer.from(partition_key),
                    value:Buffer.from(frame.toBinary())
                }]
            });
        }
    }
    public static create(config_: config) {
        return new publisher(config_);
    }
}

import {Kafka, Partitioners} from "kafkajs";
import {config} from "./config";
import * as crypto from "crypto";
import {runner} from "./runner";
import {AirCoreFrame} from "../proto/generated/devinternal_pb";
import {Disposable} from "@esfx/disposable";

export class publisher {
    private readonly topic: string;
    private constructor(
        private readonly config_: config,
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly producer = kafka.producer({
            allowAutoTopicCreation: true,
            createPartitioner: Partitioners.DefaultPartitioner,
        })
    ){
        this.topic = config_.get_worker_topic();
    }

    private connected = false;

    public async send(frame: AirCoreFrame) {
        console.log("send");
        if(!this.connected) {
            await this.producer.connect();
            console.log("send.connect")
            this.connected = true;
        }
        const partition_key = frame.sendTo?.kafkaPartitionKey?.toBinary()
        if(partition_key) {
            console.log("producing:", this.topic);
            await this.producer.send({
                topic: this.topic,
                messages: [{
                    key:Buffer.from(partition_key),
                    value:Buffer.from(frame.toBinary())
                }]
            });
            console.log("send.produce")
        } else {
            console.log("producer.send, missing partition key");
        }
    }

    [Disposable.dispose]() {
    }

    public close() {
        this.producer.disconnect();
    }

    public static create(config_: config) {
        return new publisher(config_);
    }
}

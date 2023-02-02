import {config} from "./config";
import {Kafka} from "kafkajs";
import crypto from "crypto";
import {runner} from "./runner";
import {AirCoreFrame} from "../proto/generated/devinternal_pb";
import {AsyncQueue} from "@esfx/async";

export class worker_subscriber {
    private constructor(
        private readonly config_: config,
        readonly topic = config_.get_worker_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/client_id/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly consumer = kafka.consumer({
            groupId: config_.get_worker_group_id(),
        }),
    ) {
    }

    public readonly frames = new AsyncQueue<AirCoreFrame>();

    private readonly runner_ = new runner(async() => {
        await this.consumer.connect()
        console.log("consumer_worker: ", this.config_.get_worker_topic());
        await this.consumer.subscribe({
            topic: this.config_.get_worker_topic(),
            fromBeginning: false,
        })
        await this.consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                const frame = AirCoreFrame.fromBinary(message.value!);
                this.frames.put(frame);
            },
        })
        return true;
    });

    public static create(config_: config) {
        return new worker_subscriber(config_);
    }
}

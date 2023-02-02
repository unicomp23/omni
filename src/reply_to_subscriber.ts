import {config} from "./config";
import {Kafka} from "kafkajs";
import crypto from "crypto";
import {runner} from "./runner";
import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame} from "../proto/generated/devinternal_pb";

export class reply_to_subscriber {
    private constructor(
        private readonly config_ = config.create(),
        readonly topic = config_.get_reply_to_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/reply_to/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly consumer = kafka.consumer({
            groupId: config_.get_reply_to_group_id()
        }),
    ) {
    }

    public readonly frames = new AsyncQueue<AirCoreFrame>();

    private readonly runner_ = new runner(async() => {
        await this.consumer.connect()
        await this.consumer.subscribe({
            topic: this.config_.get_reply_to_topic(),
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

    public static create() {
        return new reply_to_subscriber();
    }
}

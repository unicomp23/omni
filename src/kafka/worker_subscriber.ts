import {config} from "../config";
import {Kafka, logLevel} from "kafkajs";
import crypto from "crypto";
import {AirCoreFrame} from "../../proto/gen/devinternal_pb";
import {AsyncQueue} from "@esfx/async";
import {AsyncDisposable} from "@esfx/disposable";
import {kafkaLogLevel} from "./constants";

export class worker_subscriber {
    public readonly frames = new AsyncQueue<AirCoreFrame>();
    private readonly runner_ = (async () => {
        await this.consumer.connect()
        //console.log("consumer_worker: ", this.config_.get_worker_topic());
        await this.consumer.subscribe({
            topic: this.config_.get_worker_topic(),
            fromBeginning: false,
        })
        await this.consumer.run({
            eachMessage: async ({topic, partition, message}) => {
                const frame = AirCoreFrame.fromBinary(message.value!);
                this.frames.put(frame);
            },
        })
        return true;
    })();

    private constructor(
        private readonly config_: config,
        readonly topic = config_.get_worker_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/client_id/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers(),
            logLevel: kafkaLogLevel,
        }),
        private readonly consumer = kafka.consumer({
            groupId: config_.get_worker_group_id(),
        }),
    ) {
    }

    public static create(config_: config) {
        return new worker_subscriber(config_);
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.consumer.stop();
        await this.consumer.disconnect();
    }
}

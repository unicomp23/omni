import {Kafka} from "kafkajs";
import crypto from "crypto";
import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame} from "../../proto/gen/devinternal_pb";
import {AsyncDisposable} from "@esfx/disposable";
import {kafkaLogLevel} from "./constants";
import {config} from "../config";
import {partition_tracking} from "./partition_tracking";
import {createKafka} from "../common2/createKafka";

export class reply_to_subscriber {
    public readonly partition_tracking_ = partition_tracking.create();
    public readonly frames = new AsyncQueue<AirCoreFrame>();
    private readonly runner_ = (async () => {
        this.partition_tracking_.group_join(this.consumer, this.topic);
        //console.log("reply_to_worker: ", this.config_.get_worker_topic());
        await this.consumer.subscribe({
            topic: this.config_.easy_pubsub.get_reply_to_topic(),
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


    public async connect() {
        await this.consumer.connect()
    }

    private joined = false;
    public is_joined() { return this.joined; }

    private constructor(
        private readonly config_: config,
        readonly topic = config_.easy_pubsub.get_reply_to_topic(),
        private readonly kafka = createKafka(config_.easy_pubsub.get_app_id() + '/reply_to/' + crypto.randomUUID()),
        private readonly consumer = kafka.consumer({
            groupId: config_.easy_pubsub.get_reply_to_group_id()
        }),
    ) {
        consumer.on(consumer.events.FETCH_START, async () => {
            this.joined = true;
        });
    }

    public static create(config_: config) {
        return new reply_to_subscriber(config_);
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.consumer.stop();
        await this.consumer.disconnect();
    }
}

import {config} from "../config";
import {Kafka, logLevel} from "kafkajs";
import crypto from "crypto";
import {AsyncQueue, delay} from "@esfx/async";
import {AirCoreFrame} from "../../proto/gen/devinternal_pb";
import {AsyncDisposable} from "@esfx/disposable";
import {kafkaLogLevel} from "./constants";

export class reply_to_subscriber {
    public readonly frames = new AsyncQueue<AirCoreFrame>();
    private partitions = new Array<number>();
    private last_reply_partition_index = 0;
    private partitions_stable = false;
    private readonly runner_ = (async () => {
        await this.consumer.connect()
        this.consumer.on("consumer.group_join", (event) => {
            const partitions = event.payload.memberAssignment[this.topic];
            //console.log("consumer.group_join.partitions", partitions);
            this.partitions = [];
            for (const partition of partitions)
                this.partitions.push(partition);
            this.partitions_stable = true;
        });
        //console.log("reply_to_worker: ", this.config_.get_worker_topic());
        await this.consumer.subscribe({
            topic: this.config_.get_reply_to_topic(),
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
        readonly topic = config_.get_reply_to_topic(),
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/reply_to/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers(),
            logLevel: kafkaLogLevel,
        }),
        private readonly consumer = kafka.consumer({
            groupId: config_.get_reply_to_group_id()
        }),
    ) {
    }

    public static create(config_: config) {
        return new reply_to_subscriber(config_);
    }

    public async reply_to_active() {
        while (!this.partitions_stable)
            await delay(100);
        // todo timeout
        return true;
    }

    public async get_next_reply_partition() {
        await this.reply_to_active();
        this.last_reply_partition_index++;
        const index = this.last_reply_partition_index % this.partitions.length;
        this.last_reply_partition_index = index;
        const result = this.partitions[index];
        //console.log(`get_next_reply_partition.index: ${index}, ${this.partitions.length}, ${result}`);
        return result;
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.consumer.stop();
        await this.consumer.disconnect();
    }
}

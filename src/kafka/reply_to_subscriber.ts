import {config} from "../config";
import {Kafka} from "kafkajs";
import crypto from "crypto";
import {AsyncQueue, delay} from "@esfx/async";
import {AirCoreFrame} from "../../proto/generated/devinternal_pb";
import {Disposable} from "@esfx/disposable";

export class reply_to_subscriber {
    private constructor(
        private readonly config_: config,
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

    private partitions = new Array<number>();
    private last_reply_partition_index = 0;
    public async get_next_reply_partition() {
        while(!this.partitions_stable)
            await delay(100);
        this.last_reply_partition_index++;
        const index = this.last_reply_partition_index % this.partitions.length;
        this.last_reply_partition_index = index;
        const result = this.partitions[index];
        console.log(`get_next_reply_partition.index: ${index}, ${this.partitions.length}, ${result}`);
        return result;
    }
    private partitions_stable = false;
    private readonly runner_ = (async() => {
        await this.consumer.connect()
        this.consumer.on("consumer.group_join", (event) => {
            const partitions = event.payload.memberAssignment[this.topic];
            console.log("consumer.group_join.partitions", partitions);
            this.partitions = new Array();
            for(const partition of partitions)
                this.partitions.push(partition);
            this.partitions_stable = true;
        });
        console.log("reply_to_worker: ", this.config_.get_worker_topic());
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
    })();

    [Disposable.dispose]() {
        this.consumer.stop();
        this.consumer.disconnect();
    }

    public static create(config_: config) {
        return new reply_to_subscriber(config_);
    }
}

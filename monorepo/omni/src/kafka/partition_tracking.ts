import {delay} from "@esfx/async";
import {Consumer} from "kafkajs";

export class partition_tracking {
    private constructor() {
    }

    public static create() {
        return new partition_tracking();
    }

    private last_reply_partition_index = 0;
    private partitions_ = new Array<number>();

    public get partitions() {
        return this.partitions_;
    }

    private partitions_stable = false;

    public async partitions_to_active() {
        while (!this.partitions_stable)
            await delay(100);
        // todo timeout
        return true;
    }

    public group_join(consumer: Consumer, topic: string) {
        consumer.on("consumer.group_join", (event) => {
            const partitions = event.payload.memberAssignment[topic];
            //console.log("consumer.group_join.partitions", partitions);
            this.partitions_ = [];
            for (const partition of partitions)
                this.partitions_.push(partition);
            this.partitions_stable = true;
        });
    }

    public async get_next_partition() {
        await this.partitions_to_active();
        this.last_reply_partition_index++;
        const index = this.last_reply_partition_index % this.partitions.length;
        this.last_reply_partition_index = index;
        const result = this.partitions[index];
        //console.log(`get_next_reply_partition.index: ${index}, ${this.partitions.length}, ${result}`);
        return result;
    }
}
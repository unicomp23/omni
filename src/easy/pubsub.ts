import {config} from "../config";
import {publisher, topic_type} from "../kafka/publisher";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {AsyncQueue, delay} from "@esfx/async";
import {AirCoreFrame, ReplyTo, SendTo, Sequencing} from "../../proto/generated/devinternal_pb";
import crypto from "crypto";
import {runner} from "../common/runner";
import {HashMap} from "@esfx/collections";
import {Timestamp} from "@bufbuild/protobuf";

export class pubsub {
    private constructor(
        private readonly config_: config,
        private readonly publisher_ = publisher.create(config_),
        private readonly reply_to_subscriber_ = reply_to_subscriber.create(config_),
        private readonly warmup_correlation_id = crypto.randomUUID(),
        private epoch = Timestamp.now(),
    ) {
    }
    private runner_ = new runner(async() => {
        for(;;) {
            const frame = await this.reply_to_subscriber_.frames.get();
            if(frame.replyTo?.correlationId === this.warmup_correlation_id) {
                this.reply_to_flushed_ = true;
            } else {
                const correlation_id = frame.replyTo?.correlationId;
                if(correlation_id) {
                    const stream = this.subscriptions.get(correlation_id);
                    if(stream) {
                        stream.put(frame);
                    } else {
                        console.log(`missing handler: ${correlation_id}`);
                    }
                }
            }
        }
        return true;
    });
    private next_seqno = BigInt(0);
    public static async create(config_: config) {
        const client = new pubsub(config_);
        await client.publisher_.send(topic_type.reply_to, new AirCoreFrame({
            sendTo: {
                kafkaPartitionKey: {
                    partitioning: {
                        case: "partitionInteger",
                        value: client.reply_to_subscriber_.get_next_reply_partition(),
                    }
                },
            },
            replyTo: {
                correlationId: client.warmup_correlation_id,
            }
        }));
        await client.reply_to_flushed();
        return client;
    }
    public async publish(frame: AirCoreFrame) {
        await this.reply_to_flushed();
        if(!frame.sendTo) frame.sendTo = new SendTo();
        if(!frame.sendTo.sequencing) frame.sendTo.sequencing = new Sequencing()
        frame.sendTo.sequencing.epoc = Timestamp.fromDate(this.epoch.toDate());
        frame.sendTo.sequencing.sequenceNumber = this.next_seqno;
        await this.publisher_.send(topic_type.worker, frame);
    }
    private subscriptions = new HashMap<string, AsyncQueue<AirCoreFrame>>();
    public async subscribe(reply_to: ReplyTo) {
        await this.reply_to_flushed();
        // todo
        const stream_id = crypto.randomUUID();
        const stream = new AsyncQueue<AirCoreFrame>();
        this.subscriptions.set(stream_id, stream);
        return stream_id;
    }
    private reply_to_flushed_ = false;
    public async reply_to_flushed() {
        for(;;) {
            if(this.reply_to_flushed_)
                return true;
            await delay(100);
        }
    }
}

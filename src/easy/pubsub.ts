import {config} from "../config";
import {publisher, topic_type} from "../kafka/publisher";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {AsyncQueue, delay} from "@esfx/async";
import {AirCoreFrame, Commands, Coordinates, Sequencing} from "../../proto/generated/devinternal_pb";
import crypto from "crypto";
import {HashMap} from "@esfx/collections";
import {Timestamp} from "@bufbuild/protobuf";
import {Disposable, DisposableStack} from "@esfx/disposable";

export class pubsub {
    private readonly publisher_: publisher;
    private readonly reply_to_subscriber_: reply_to_subscriber;
    private constructor(
        private readonly config_: config,
        private readonly warmup_correlation_id = crypto.randomUUID(),
        private epoch = Timestamp.now(),
    ) {
        this.publisher_ = publisher.create(config_);
        this.stack.use(this.publisher_);
        this.reply_to_subscriber_ = reply_to_subscriber.create(config_);
        this.stack.use(this.reply_to_subscriber_);
    }
    private stack = new DisposableStack();
    private runner_ = (async() => {
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
    })();
    private next_seqno = 0;
    public static async create(config_: config) {
        const client = new pubsub(config_);
        await client.publisher_.send(topic_type.reply_to, new AirCoreFrame({
            sendTo: {
                dbKey: {
                    kafkaPartitionKey: {
                        partitionInteger: client.reply_to_subscriber_.get_next_reply_partition(),
                    },
                }
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

        if(!frame.sendTo?.planetKey) throw new Error("missing planet key");
        if(!frame.sendTo?.dbKey) throw new Error("missing db key");
        if(!frame.sendTo?.dbKey.kafkaPartitionKey) throw new Error("missing kafka partition key");

        if(!frame.sendTo) frame.sendTo = new Coordinates();
        if(!frame.sequencing) frame.sequencing = new Sequencing()
        frame.sequencing.epoc = Timestamp.fromDate(this.epoch.toDate());
        frame.sequencing.sequenceNumber = this.next_seqno;

        await this.publisher_.send(topic_type.worker, frame);
    }
    private subscriptions = new HashMap<string, AsyncQueue<AirCoreFrame>>();
    public async subscribe(send_to: Coordinates) {
        await this.reply_to_flushed();

        const stream_id = crypto.randomUUID();
        await this.publisher_.send(topic_type.worker, new AirCoreFrame({
            command: Commands.SUBSCRIBE,
            replyTo: {
                correlationId: stream_id,
                dbKey: {
                    kafkaPartitionKey: {
                        partitionInteger: this.reply_to_subscriber_.get_next_reply_partition(),
                    }
                }
            }
        }));
        const stream = new AsyncQueue<AirCoreFrame>();
        this.subscriptions.set(stream_id, stream);
        return {
            stream_id,
            stream
        };
    }
    private reply_to_flushed_ = false;
    public async reply_to_flushed() {
        for(;;) {
            if(this.reply_to_flushed_)
                return true;
            await delay(100);
        }
    }
    [Disposable.dispose]() {
        this.stack.dispose();
    }
}

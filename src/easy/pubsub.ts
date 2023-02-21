import {config} from "../config";
import {publisher, topic_type} from "../kafka/publisher";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame, Commands, Coordinates, Path, Sequencing} from "../../proto/generated/devinternal_pb";
import crypto from "crypto";
import {HashMap} from "@esfx/collections";
import {Timestamp} from "@bufbuild/protobuf";
import {AsyncDisposable, AsyncDisposableStack, Disposable, DisposableStack} from "@esfx/disposable";
import {prettySpaces} from "../common/constants";

export class pubsub {
    private readonly publisher_: publisher;
    private readonly reply_to_subscriber_: reply_to_subscriber;
    private constructor(
        private readonly config_: config,
        private epoch = Timestamp.now(),
    ) {
        this.publisher_ = publisher.create(config_);
        this.disposable_stack.use(this.publisher_);
        this.reply_to_subscriber_ = reply_to_subscriber.create(config_);
        this.disposable_stack.use(this.reply_to_subscriber_);
        this.run().then(() => { console.log(`pubsub.run exit`); });
    }
    private disposable_stack = new AsyncDisposableStack();
    private async run() {
        for (; ;) {
            const frame = await this.reply_to_subscriber_.frames.get();
            const correlation_id = frame.replyTo?.correlationId;
            //console.log(`firing.correlationid`, frame.toJsonString({prettySpaces}));
            if (correlation_id) {
                const stream = this.subscriptions.get(correlation_id);
                if (stream) {
                    stream.put(frame);
                } else {
                    console.log(`missing handler: ${correlation_id}`);
                }
            }
        }
    }
    private next_seqno = 0;
    public static async create(config_: config) {
        const client = new pubsub(config_);
        await client.reply_to_active();
        return client;
    }
    public async publish(frame: AirCoreFrame) {
        await this.reply_to_active();

        if(!frame.sendTo?.kafkaKey) throw new Error("missing kafka key");
        if(!frame.sendTo?.kafkaKey.kafkaPartitionKey) throw new Error("missing kafka partition key");

        if(!frame.sendTo) frame.sendTo = new Coordinates();
        if(!frame.sequencing) frame.sequencing = new Sequencing()
        frame.sequencing.epoc = Timestamp.fromDate(this.epoch.toDate());
        frame.sequencing.sequenceNumber = BigInt(this.next_seqno);
        this.next_seqno++;

        await this.publisher_.send(topic_type.worker, frame);
    }
    private subscriptions = new HashMap<string, AsyncQueue<AirCoreFrame>>();
    public async subscribe(path: Path) {
        await this.reply_to_active();

        const correlationId = crypto.randomUUID();
        await this.publisher_.send(topic_type.worker, new AirCoreFrame({
            command: Commands.SUBSCRIBE,
            sendTo: {
                kafkaKey: {
                    kafkaPartitionKey: {
                        x: {
                            case: "partitionKey",
                            value: path,
                        }
                    },
                },
            },
            replyTo: {
                correlationId,
                kafkaKey: {
                    kafkaPartitionKey: {
                        x: {
                            case: "partitionInteger",
                            value: await this.reply_to_subscriber_.get_next_reply_partition(),
                        },
                    },
                },
            },
        }));
        const stream = new AsyncQueue<AirCoreFrame>();
        this.subscriptions.set(correlationId, stream);
        return {
            correlationId,
            stream
        };
    }
    private async reply_to_active() {
        await this.reply_to_subscriber_.reply_to_active();
    }
    async[AsyncDisposable.asyncDispose]() {
        await this.disposable_stack.disposeAsync();
    }
}

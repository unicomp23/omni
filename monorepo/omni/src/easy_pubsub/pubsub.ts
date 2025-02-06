import {publisher, topic_type} from "../kafka/publisher";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame, Commands, Path, Sequencing} from "../../proto/gen/devinternal_pb";
import crypto from "crypto";
import {HashMap} from "@esfx/collections";
import {Timestamp} from "@bufbuild/protobuf";
import {AsyncDisposable, AsyncDisposableStack} from "@esfx/disposable";
import {config} from "../config";

export class pubsub {
    private readonly publisher_: publisher;
    private readonly reply_to_subscriber_: reply_to_subscriber;
    private disposable_stack = new AsyncDisposableStack();
    private next_seqno = 0;
    private subscriptions = new HashMap<string, AsyncQueue<AirCoreFrame>>();

    private constructor(
        private readonly config_: config,
        private epoch = Timestamp.now(),
    ) {
        this.publisher_ = publisher.create(config_);
        this.disposable_stack.use(this.publisher_);
        this.reply_to_subscriber_ = reply_to_subscriber.create(config_);
        this.disposable_stack.use(this.reply_to_subscriber_);
        this.run().then(() => {
            console.log(`pubsub.run exit`);
        });
    }

    public static async create(config_: config) {
        const client = new pubsub(config_);
        await client.partitions_active();
        return client;
    }

    public async publish(frame: AirCoreFrame) {
        await this.partitions_active();

        if (!frame.sendTo) throw new Error("missing frame.sendTo");
        if (!frame.sendTo?.kafkaKey) throw new Error("missing frame.sendTo?.kafkaKey");
        if (!frame.sendTo?.kafkaKey.kafkaPartitionKey) throw new Error("missing frame.sendTo?.kafkaKey.kafkaPartitionKey");

        if (!frame.payloads) throw new Error("missing frame.payloads");
        if (!frame.payloads[0]) throw new Error("frame.payloads[0]");
        if (!frame.payloads[0].itemPath) throw new Error("missing frame.payloads[0].itemPath");

        frame.payloads[0].sequencing = new Sequencing()
        frame.payloads[0].sequencing.epoc = Timestamp.fromDate(this.epoch.toDate());
        frame.payloads[0].sequencing.sequenceNumber = BigInt(this.next_seqno);
        this.next_seqno++;

        await this.publisher_.send(topic_type.worker, frame);
    }

    public async subscribe(path: Path) {
        await this.partitions_active();

        const correlationId = crypto.randomUUID();
        await this.publisher_.send(topic_type.worker, new AirCoreFrame({
            command: Commands.SUBSCRIBE,
            sendTo: {
                kafkaKey: {
                    kafkaPartitionKey: {
                        x: {
                            case: "sequenceNumberPath",
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
                            value: await this.reply_to_subscriber_.partition_tracking_.get_next_partition(),
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

    async [AsyncDisposable.asyncDispose]() {
        await this.disposable_stack.disposeAsync();
    }

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

    private async partitions_active() {
        await this.reply_to_subscriber_.partition_tracking_.partitions_to_active();
    }
}

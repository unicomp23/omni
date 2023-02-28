import {AirCoreFrame, PathTypes, Tags} from "../../proto/gen/devinternal_pb";
import {publisher, topic_type} from "../kafka/publisher";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {Deferred} from "@esfx/async";
import {AsyncDisposableStack} from "@esfx/disposable";

describe(`pubsub`, () => {
    test(`primitive round trip`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        const quit = new Deferred<boolean>();
        try {
            const config_ = config.create();

            const publisher_ = publisher.create(config_);
            disposable_stack.use(publisher_);

            const worker_subscriber_ = worker_subscriber.create(config_);
            disposable_stack.use(worker_subscriber_);

            const reply_to_subscriber_ = reply_to_subscriber.create(config_);
            disposable_stack.use(reply_to_subscriber_);

            let start_time = performance.now();

            const strand_worker = async () => {
                for (; ;) {
                    const frame = await worker_subscriber_.frames.get();
                    if (frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionInteger") {
                        try {
                            await publisher_.send(topic_type.reply_to, frame);
                        } catch (e) {
                            console.error(`send.reply_to:`, e);
                        }
                    } else throw new Error(`missing partitionInteger`);
                }
            }
            strand_worker().then(() => {
                console.log("strand_worker exit")
            });

            const strand_reply_to = async () => {
                for (; ;) {
                    const frame = await reply_to_subscriber_.frames.get();
                    //console.log(`reply_to frame(rtt): ${performance.now() - start_time} ms,`, frame.toJsonString({prettySpaces}))
                    quit.resolve(true);
                }
            }
            strand_reply_to().then(() => {
                console.log("strand_reply_to exit")
            });

            start_time = performance.now();
            const frame = new AirCoreFrame({
                replyTo: {
                    kafkaKey: {
                        kafkaPartitionKey: {
                            x: {
                                case: "partitionInteger",
                                value: await reply_to_subscriber_.get_next_reply_partition(),
                            },
                        },
                    },
                },
                sendTo: {
                    kafkaKey: {
                        kafkaPartitionKey: {
                            x: {
                                case: "partitionKey",
                                value: {
                                    hops: [
                                        {tag: Tags.PATH_TYPE, x: {case: "integer", value: PathTypes.APP}}, // first hop, always has PATH_TYPE
                                        {tag: Tags.APP_ID, x: {case: "integer", value: 123}},
                                    ],
                                }
                            },
                        },
                    },
                },
                payload: {
                    x: {
                        case: "text",
                        value: "some text"
                    },
                },
            });
            //console.log(`publisher.send`, frame.toJsonString({prettySpaces}));
            await publisher_.send(topic_type.worker, frame);

            expect(await quit.promise).toBe(true);
        } finally {
            await disposable_stack.disposeAsync();
        }
    })
})
import {AirCoreFrame, PathTypes, Tags} from "../../proto/gen/devinternal_pb";
import {publisher, topic_type} from "../kafka/publisher";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {Deferred, delay} from "@esfx/async";
import {AsyncDisposableStack} from "@esfx/disposable";
import {config, createTopics} from "../config";
import {prettySpaces} from "../common2/constants";

describe(`pubsub`, () => {
    test(`primitive round trip`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        const quit = new Deferred<boolean>();
        try {
            const config_ = (await config.create());
            await createTopics(config_);

            const publisher_ = publisher.create(config_);
            disposable_stack.use(publisher_);

            const worker_subscriber_ = worker_subscriber.create(config_);
            disposable_stack.use(worker_subscriber_);
            await worker_subscriber_.connect();
            while(!worker_subscriber_.is_joined())
                await delay(1000);

            const reply_to_subscriber_ = reply_to_subscriber.create(config_);
            disposable_stack.use(reply_to_subscriber_);
            await reply_to_subscriber_.connect();
            while(!reply_to_subscriber_.is_joined())
                await delay(1000);

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
                                value: await reply_to_subscriber_.partition_tracking_.get_next_partition(),
                            },
                        },
                    },
                },
                sendTo: {
                    kafkaKey: {
                        kafkaPartitionKey: {
                            x: {
                                case: "sequenceNumberPath",
                                value: {
                                    hops: [
                                        {tag: Tags.PATH_TYPE, x: {case: "integer", value: PathTypes.SEQ_APP}}, // first hop, always has PATH_TYPE
                                        {tag: Tags.APP_ID, x: {case: "integer", value: 123}},
                                    ],
                                }
                            },
                        },
                    },
                },
                payloads: [{
                    x: {
                        case: "text",
                        value: "some text"
                    },
                }],
            });
            //await delay(5000); // TODO, looks like we need to wait for the workers to join via heartbeat signal in app
            console.log(`publisher.send`, frame.toJsonString({prettySpaces}));
            await publisher_.send(topic_type.worker, frame);

            expect(await quit.promise).toBe(true);
        } finally {
            await disposable_stack.disposeAsync();
        }
    })
})
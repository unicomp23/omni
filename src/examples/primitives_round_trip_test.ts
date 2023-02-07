import {AirCoreFrame, PathTypes, Tags} from "../../proto/generated/devinternal_pb";
import {publisher, topic_type} from "../kafka/publisher";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {delay} from "@esfx/async";
import {DisposableStack} from "@esfx/disposable";

const main = async() => {
    const stack = new DisposableStack();
    try {
        const config_ = config.create();

        const publisher_ = publisher.create(config_);
        stack.use(publisher_);

        const worker_subscriber_ = worker_subscriber.create(config_);
        stack.use(worker_subscriber_);

        const reply_to_subscriber_ = reply_to_subscriber.create(config_);
        stack.use(reply_to_subscriber_);

        let start_time = performance.now();

        const strand_worker = async () => {
            for (; ;) {
                const frame = await worker_subscriber_.frames.get();
                console.log("worker frame.3:", frame.toJsonString({prettySpaces: 2}))
                const partitionInteger = frame.replyTo?.dbKey?.kafkaPartitionKey?.partitionInteger;
                try {
                    await publisher_.send(topic_type.reply_to, frame);
                } catch (e) {
                    console.error(`send.reply_to: ${partitionInteger}`, e);
                }
            }
        }
        strand_worker().then(() => {
            console.log("strand_worker exit")
        });

        const strand_reply_to = async () => {
            for (; ;) {
                const frame = await reply_to_subscriber_.frames.get();
                console.log(`reply_to frame(rtt): ${performance.now() - start_time} ms,`, frame.toJsonString({prettySpaces: 2}))
            }
        }
        strand_reply_to().then(() => {
            console.log("strand_reply_to exit")
        });

        await delay(1000);

        start_time = performance.now();
        const frame = new AirCoreFrame({
            replyTo: {
                dbKey: {
                    kafkaPartitionKey: {
                        partitionInteger: reply_to_subscriber_.get_next_reply_partition(),
                    },
                },
            },
            sendTo: {
                dbKey: {
                    kafkaPartitionKey: {
                        partitionKey: {
                            hops: [
                                {tag: Tags.PATH_TYPE, x: {case: "integer", value: PathTypes.APP}}, // first hop, always has PATH_TYPE
                                {tag: Tags.APP_ID, x: { case: "integer", value: 123}},
                            ],
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
        console.log(`publisher.send`, frame.toJsonString({prettySpaces: 2}));
        await publisher_.send(topic_type.worker, frame);

        await delay(1000);
    } finally {
        stack.dispose();
    }
}
main().then(() => { console.log("exit main"); });

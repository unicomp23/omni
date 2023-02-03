import {AirCoreFrame, PathElement, SendTo, Tags} from "../../proto/generated/devinternal_pb";
import {publisher} from "../kafka/publisher";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {delay} from "@esfx/async";

console.log("running")

const coord = new AirCoreFrame({
    sendTo: new SendTo({kafkaTopic: "topic"})
});

const bytes = coord.toBinary();
const coord_2 = AirCoreFrame.fromBinary(bytes);

console.log(`out: ${coord_2.sendTo?.kafkaTopic}`);

const main = async() => {
    const config_ = config.create();
    const publisher_ = publisher.create(config_);
    const worker_subscriber_ = worker_subscriber.create(config_);
    const reply_to_subscriber_ = reply_to_subscriber.create(config_);

    try {
        const strand_worker = async () => {
            for (; ;) {
                const frame = await worker_subscriber_.frames.get();
                console.log("worker frame:", frame.toJson())
            }
        }
        strand_worker().then(() => {
            console.log("strand_worker exit")
        });

        const strand_reply_to = async () => {
            for (; ;) {
                const frame = await reply_to_subscriber_.frames.get();
                console.log("reply_to frame:", frame.toJson())
            }
        }
        strand_reply_to().then(() => {
            console.log("strand_reply_to exit")
        });

        await delay(1000);

        await publisher_.send(new AirCoreFrame({
            sendTo: {
                kafkaPartitionKey: {
                    partitioning: {
                        value: {
                            hops: [{tag: Tags.APP_ID, val: {value: 123, case: "integer"}}],
                        },
                        case: "partitionKey",
                    }
                },
            },
            payload: {
                text: "some text"
            },
        }));

        await delay(1000);
    } finally {
        try { publisher_.close(); } catch {}
        try { worker_subscriber_.close(); } catch {}
        try { reply_to_subscriber_.close(); } catch {}
    }
}
main().then(() => { console.log("exit main"); });

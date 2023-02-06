import {AirCoreFrame, Coordinates, DbKey, PathTypes, Tags} from "../../proto/generated/devinternal_pb";
import {publisher, topic_type} from "../kafka/publisher";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {delay} from "@esfx/async";

console.log("running")

const coord = new AirCoreFrame({
    sendTo: new Coordinates({dbKey: {kafkaTopic: "topic"}})
});

const bytes = coord.toBinary();
const coord_2 = AirCoreFrame.fromBinary(bytes);

const kafkaTopic = coord_2.sendTo?.dbKey?.kafkaTopic;
if(kafkaTopic) console.log(`out: ${kafkaTopic}`);


const main = async() => {
    const config_ = config.create();
    const publisher_ = publisher.create(config_);
    const worker_subscriber_ = worker_subscriber.create(config_);
    const reply_to_subscriber_ = reply_to_subscriber.create(config_);

    let start_time = performance.now();

    try {
        const strand_worker = async () => {
            for (; ;) {
                const frame = await worker_subscriber_.frames.get();
                console.log("worker frame:", frame.toJson())
                const partition = reply_to_subscriber_.get_next_reply_partition();
                try {
                    const kafkaPartitionKey = frame.sendTo?.dbKey?.kafkaPartitionKey;
                    if(kafkaPartitionKey) kafkaPartitionKey.partitioning = {case: "partitionInteger", value: partition};
                    else throw new Error(`missing: frame.sendTo.dbKey.kafkaPartitionKey`);
                    await publisher_.send(topic_type.reply_to, frame);
                } catch(e) {
                    console.error(`send.reply_to: ${partition}`, e);
                }
            }
        }
        strand_worker().then(() => {
            console.log("strand_worker exit")
        });

        const strand_reply_to = async () => {
            for (; ;) {
                const frame = await reply_to_subscriber_.frames.get();
                console.log(`reply_to frame(rtt): ${performance.now() - start_time} ms,`, frame.toJson())
            }
        }
        strand_reply_to().then(() => {
            console.log("strand_reply_to exit")
        });

        await delay(1000);

        start_time = performance.now();
        await publisher_.send(topic_type.worker, new AirCoreFrame({
            sendTo: {
                dbKey: {
                    kafkaPartitionKey: {
                        partitioning: {
                            value: {
                                hops: [
                                    {tag: Tags.PATH_TYPE, val: {value: PathTypes.APP, case: "integer"}}, // first hop, always has PATH_TYPE
                                    {tag: Tags.APP_ID, val: {value: 123, case: "integer"}},
                                ],
                            },
                            case: "partitionKey",
                        }
                    },
                }
            },
            payload: {
                x: {
                    case: "text",
                    value: "some text",
                }
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

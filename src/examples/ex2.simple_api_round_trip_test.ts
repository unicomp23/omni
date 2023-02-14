import {DisposableStack} from "@esfx/disposable";
import {worker} from "../easy/worker";
import {config} from "../config";
import {
    AirCoreFrame,
    Commands, Coordinates,
    DbSnapshot,
    KafkaKey,
    Path,
    PathTypes,
    PayloadType,
    Tags
} from "../../proto/generated/devinternal_pb";
import {Deferred} from "@esfx/async";
import {pubsub} from "../easy/pubsub";
import {prettySpaces} from "../common/constants";
import {publisher, topic_type} from "../kafka/publisher";

function *range(start: number, end: number) {
    for(let i = start; i < end; i++)
        yield i;
}

function make_path_chan() {
    const key_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.APP_CHAN_USER}},
            {tag: Tags.APP_ID, x: {case: "text", value: "app_id_123"}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
        ]
    });
    return key_path;
}

const main = async() => {
    const some_text = "some text 123";
    const disposable_stack = new DisposableStack();
    try {
        const config_ = config.create();
        const quit = new Deferred<boolean>();

        const late_join_server = new worker(config_, async(stream, publisher_) => {
            const db_snapshot = new DbSnapshot(); // todo replace w/ redis
            const subscriptions = new Map<string /*partition_key*/, Map<string /*correlation_id*/, Coordinates>>();

            for(;;) {
                const frame = await stream.get();
                console.log(`worker.received`, frame.toJsonString({prettySpaces}));
                switch (frame.command) {
                    case Commands.SUBSCRIBE: {
                        if (frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case != "partitionKey") throw new Error(`missing sendTo.kafkaKey.partitionKey.case`);
                        const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                        const key = Buffer.from(kafkaPartitionKey).toString("base64");
                        if (!frame.replyTo?.correlationId) throw new Error(`missing correlationId`);
                        if (!frame.replyTo?.kafkaKey?.kafkaPartitionKey) throw new Error(`missing replyTo.kafkaPartitionKey`);
                        if (frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x?.case != "partitionInteger") throw new Error(`missing replyTo.partitionInteger`);
                        if(!subscriptions.has(key))
                            subscriptions.set(key, new Map<string, Coordinates>());
                        const subscribers = subscriptions.get(key);
                        if(subscribers) {
                            subscribers.set(frame.replyTo?.correlationId, frame.replyTo.clone());
                            // todo, send snapshot (ie late joiner support)
                            console.log(`subscribers.set: `, frame.toJsonString({prettySpaces}));
                        }
                        break;
                    }
                    case Commands.UPSERT: {
                        if (!(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionKey")) throw new Error(`missing sendTo.partitionKey.case`);
                        const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                        if (!kafkaPartitionKey) throw new Error(`missing sendTo.kafkaPartitionKey.value`);
                        const payload = frame.payload;
                        if (!payload) throw new Error(`missing payload`);
                        const key = Buffer.from(kafkaPartitionKey).toString("base64");
                        db_snapshot.entries[key] = payload;
                        const subscribers = subscriptions.get(key);
                        if(subscribers) {
                            for(const entry of subscribers.entries()) {
                                const coordinates = entry[1];
                                console.log(`send.to.subscriber.2`);
                                if(coordinates) {
                                    frame.replyTo = coordinates.clone();
                                    await publisher_.send(topic_type.reply_to, frame);
                                    console.log(`send.to.subscriber: `, frame.toJsonString({prettySpaces}));
                                }
                            }
                        }
                        break;
                    }
                    default:
                        throw new Error(`unhandled: ${Commands[frame.command].toString()}`);
                }
            }
            return true;
        });
        disposable_stack.use(late_join_server);

        const pubsub_ = await pubsub.create(config_);
        disposable_stack.use(pubsub_);

        const runner_subscribe = async() => {
            const frames = await pubsub_.subscribe(make_path_chan());
            const stream = frames.stream;
            for(;;) {
                const frame = await stream.get();
                console.log(`runner.subscribe: `, frame.toJsonString({prettySpaces}));
                if(frame?.payload?.x.case == "text" && frame.payload.x.value == some_text) {
                    quit.resolve(true);
                    break;
                }
            }
        }
        runner_subscribe().then(() => { console.log(`runner_subscribe exit`);})

        const runner_publish = async() => {
            const count = 1;
            for (const i of range(0, count)) {
                await pubsub_.publish(new AirCoreFrame({
                    command: Commands.UPSERT,
                    sendTo: {
                        kafkaKey: {
                            kafkaPartitionKey: {
                                x: {
                                    case: "partitionKey",
                                    value: make_path_chan(),
                                }
                            }
                        },
                    },
                    payload: {
                        type: PayloadType.DELTA,
                        x: {
                            case: "text",
                            value: some_text,
                        },
                    },
                }));
            }
        }
        runner_publish().then(() => { console.log(`runner_publish exit`);})

        console.log(`await'ing quit signal`);
        await quit.promise;
    } finally {
        disposable_stack.dispose();
    }
}
main().then(() => { console.log("exit main"); });

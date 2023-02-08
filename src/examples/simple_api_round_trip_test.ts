import {DisposableStack} from "@esfx/disposable";
import {worker} from "../easy/worker";
import {config} from "../config";
import {
    AirCoreFrame,
    Commands,
    DbSnapshot,
    Path,
    PathTypes,
    Subscriptions,
    Tags
} from "../../proto/generated/devinternal_pb";
import {Deferred} from "@esfx/async";
import {pubsub} from "../easy/pubsub";

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

function make_path_user(user_id: string) {
    const key_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.APP_CHAN_USER}},
            {tag: Tags.APP_ID, x: {case: "text", value: "app_id_123"}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
            {tag: Tags.APP_USER_ID, x: {case: "text", value: user_id}},
        ]
    });
    return key_path;
}

const main = async() => {
    const stack = new DisposableStack();
    try {
        const config_ = config.create();
        const db_snapshot = new DbSnapshot();
        const subscriptions = new Subscriptions();
        const quit = new Deferred<boolean>();

        stack.use(new worker(config_, async(stream) => {
            for(;;) {
                const frame = await stream.get();
                switch(frame.command) {
                    case Commands.SUBSCRIBE:
                        const correlationId = frame.replyTo?.correlationId;
                        const dbKey = frame.sendTo?.kafkaKey;
                        if(correlationId && dbKey) {
                            subscriptions.callbacks[correlationId] = dbKey;
                            // todo, send snapshot
                        } else throw new Error(`missing correlationId or dbKey`);
                        break;
                    case Commands.UPSERT:
                        if(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionKey") {
                            const buffer = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                            const payload = frame.payload;
                            if (buffer && payload) {
                                db_snapshot.entries[Buffer.from(buffer).toString("base64")] = payload;
                            } else throw new Error(`missing buffer or payload`);
                        } else throw new Error(`missing partitionKey`);
                        break;
                    default:
                        throw new Error(`unhandled: ${Commands[frame.command].toString()}`);
                }
            }
            return true;
        }));

        const pubsub_ = await pubsub.create(config_);
        stack.use(pubsub_);

        const runner_publish = async() => {
            const count = 5;
            for (const i of range(0, count)) {
                await pubsub_.publish(new AirCoreFrame({
                    command: Commands.UPSERT,
                    sendTo: {
                        kafkaKey: {
                            kafkaPartitionKey: {
                                x: {
                                    case: "partitionKey",
                                    value: make_path_user(i.toString()),
                                }
                            }
                        },
                    }
                }))
            }
        }
        runner_publish().then(() => { console.log(`runner_publish exit`);})

        const runner_subscribe = async() => {
            const stream = pubsub_.subscribe(make_path_chan());
            // todo
        }
        runner_subscribe().then(() => { console.log(`runner_subscribe exit`);})

        await quit.promise;
    } finally {
        stack.dispose();
    }
}
main().then(() => { console.log("exit main"); });

import {DisposableStack} from "@esfx/disposable";
import {config} from "../config";
import {AirCoreFrame, Commands, Path, PathTypes, PayloadType, Tags} from "../../proto/generated/devinternal_pb";
import {Deferred} from "@esfx/async";
import {pubsub} from "../easy/pubsub";
import {prettySpaces} from "../common/constants";
import {spawn_server} from "../easy/servers/late.join.server";

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

        disposable_stack.use(spawn_server(config_));

        const pubsub_ = await pubsub.create(config_);
        disposable_stack.use(pubsub_);

        const runner_subscribe = async() => {
            const frames = await pubsub_.subscribe(make_path_chan());
            const stream = frames.stream;
            for(;;) {
                // snapshot
                const frame = await stream.get();
                console.log(`runner.subscribe.snapshot: `, frame.toJsonString({prettySpaces}));
                if(frame.payload?.type == PayloadType.SNAPSHOT) {
                    // delta(s)
                    const frame = await stream.get();
                    console.log(`runner.subscribe.delta: `, frame.toJsonString({prettySpaces}));
                    if(frame?.payload?.x.case == "text" && frame.payload.x.value == some_text && frame.payload.type == PayloadType.DELTA) {
                        quit.resolve(true);
                        break;
                    }
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

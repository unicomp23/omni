import {AsyncDisposableStack} from "@esfx/disposable";
import {config} from "../config";
import {AirCoreFrame, Commands, Path, PathTypes, PayloadType, Tags} from "../../proto/gen/devinternal_pb";
import {Deferred} from "@esfx/async";
import {pubsub} from "../easy/pubsub";
import {spawn_server} from "../easy/servers/late.join.server";
import crypto from "crypto";
import {make_paths} from "../common/redis/anydb.test";

function* range(start: number, end: number) {
    for (let i = start; i < end; i++)
        yield i;
}

const paths = make_paths(crypto.randomUUID());

function make_path_chan() {
    const key_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.APP_CHAN_USER}},
            {tag: Tags.APP_ID, x: {case: "text", value: "app_id_123"}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
            {tag: Tags.APP_USER_ID, x: {case: "text", value: "user_id_123"}},
        ]
    });
    return key_path;
}

function make_some_text(i: number) {
    return `some text ${i}`;
}

const count = 3;

describe(`pubsub`, () => {
    test(`simple api late joiner`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        try {
            const config_ = config.create();
            const quit = new Deferred<boolean>();

            disposable_stack.use(spawn_server(config_));

            const pubsub_ = await pubsub.create(config_);
            disposable_stack.use(pubsub_);

            const runner_subscribe = async () => {
                const frames = await pubsub_.subscribe(make_path_chan());
                const stream = frames.stream;
                // snapshot
                const frame = await stream.get();
                //console.log(`runner.subscribe.snapshot: `, frame.toJsonString({prettySpaces}));
                let i = 0;
                for (; ;) {
                    // delta(s)
                    let frame = await stream.get();
                    //console.log(`runner.subscribe.delta: `, frame.toJsonString({prettySpaces}));
                    if (frame?.payloads[0]?.x.case == "text" && frame.payloads[0].x.value == make_some_text(i) && frame.payloads[0].type == PayloadType.DELTA) {
                        if (i == (count - 1)) {
                            break;
                        }
                        i++;
                    }
                }
            }
            runner_subscribe().then(() => {
                console.log(`runner_subscribe exit`);
            })

            const runner_publish = async () => {
                for (const i of range(0, count)) {
                    await pubsub_.publish(new AirCoreFrame({
                        command: Commands.UPSERT,
                        sendTo: {
                            kafkaKey: {
                                kafkaPartitionKey: {
                                    x: {
                                        case: "sequencePath",
                                        value: make_path_chan(),
                                    }
                                }
                            },
                        },
                        payloads: [{
                            type: PayloadType.DELTA,
                            x: {
                                case: "text",
                                value: make_some_text(i),
                            },
                            itemPath: paths.item_path,
                        }],
                    }));
                }
                // late joiner
                const frames = await pubsub_.subscribe(make_path_chan());
                const stream = frames.stream;
                const frame = await stream.get();
                //console.log(`runner.publish.subscribe.snapshot: `, frame.toJsonString({prettySpaces}));
                if (frame?.payloads[0]?.x.case == "text" && frame.payloads[0].x.value == make_some_text(count - 1) && frame.payloads[0].type == PayloadType.SNAPSHOT) {
                    quit.resolve(true);
                } else {
                    throw new Error(`unexpected payload`);
                }
            }
            runner_publish().then(() => {
                console.log(`runner_publish exit`);
            })

            console.log(`await'ing quit signal`);
            expect(await quit.promise).toBe(true);
        } finally {
            await disposable_stack.disposeAsync();
        }
    })
})

import {AsyncDisposableStack} from "@esfx/disposable";
import {config} from "../config";
import {AirCoreFrame, Commands, Path, PathTypes, Tags} from "../../proto/gen/devinternal_pb";
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

describe(`pubsub`, () => {
    test(`simple api round trip`, async () => {
        const some_text = "some text 123";
        const disposable_stack = new AsyncDisposableStack();
        try {
            const config_ = config.create();
            const quit = new Deferred<boolean>();

            disposable_stack.use(spawn_server(config_));

            const pubsub_ = await pubsub.create(config_);
            disposable_stack.use(pubsub_);

            const runner_subscribe = async () => {
                const frames = await pubsub_.subscribe(paths.sequence_number_path);
                const stream = frames.stream;
                for (; ;) {
                    // snapshot
                    const frame_snap = await stream.get();
                    //console.log(`runner.subscribe.snapshot: `, frame.toJsonString({prettySpaces}));
                    // delta(s)
                    const frame_delta = await stream.get();
                    //console.log(`runner.subscribe.delta: `, frame.toJsonString({prettySpaces}));
                    if (frame_delta?.payloads[0]?.x.case == "text" && frame_delta.payloads[0].x.value == some_text) {
                        quit.resolve(true);
                        break;
                    }
                }
            }
            runner_subscribe().then(() => {
                console.log(`runner_subscribe exit`);
            })

            const runner_publish = async () => {
                const count = 1;
                for (const i of range(0, count)) {
                    await pubsub_.publish(new AirCoreFrame({
                        command: Commands.UPSERT,
                        sendTo: {
                            kafkaKey: {
                                kafkaPartitionKey: {
                                    x: {
                                        case: "sequenceNumberPath",
                                        value: paths.sequence_number_path,
                                    }
                                }
                            },
                        },
                        payloads: [{
                            x: {
                                case: "text",
                                value: some_text,
                            },
                            itemPath: paths.item_path,
                        }],
                    }));
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

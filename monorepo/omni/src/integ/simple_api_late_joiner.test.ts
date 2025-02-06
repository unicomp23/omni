import {AsyncDisposableStack} from "@esfx/disposable";
import {AirCoreFrame, Commands} from "../../proto/gen/devinternal_pb";
import {Deferred} from "@esfx/async";
import {pubsub} from "../easy_pubsub/pubsub";
import {spawn_server} from "../easy_pubsub/servers/late.join.server";
import crypto from "crypto";
import {make_user_paths} from "../common2/redis/make_paths";
import {config, createTopics} from "../config";

function* range(start: number, end: number) {
    for (let i = start; i < end; i++)
        yield i;
}

const paths = make_user_paths(crypto.randomUUID());

function make_some_text(i: number) {
    return `some text ${i}`;
}

const count = 3;

describe(`pubsub`, () => {
    test(`simple api late joiner`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        try {
            const config_ = (await config.create());
            await createTopics(config_);
            const quit = new Deferred<boolean>();

            const shutdown_server = new Deferred<boolean>();
            disposable_stack.use(spawn_server(config_, disposable_stack, shutdown_server));

            const pubsub_ = await pubsub.create(config_);
            disposable_stack.use(pubsub_);

            const runner_subscribe = async () => {
                const frames = await pubsub_.subscribe(paths.sequence_number_path);
                const stream = frames.stream;
                // snapshot
                const frame = await stream.get();
                //console.log(`runner.subscribe.snapshot: `, frame.toJsonString({prettySpaces}));
                let i = 0;
                for (; ;) {
                    // delta(s)
                    let frame = await stream.get();
                    //console.log(`runner.subscribe.delta: `, frame.toJsonString({prettySpaces}));
                    if (frame?.payloads[0]?.x.case == "text" && frame.payloads[0].x.value == make_some_text(i)) {
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
                                        case: "sequenceNumberPath",
                                        value: paths.sequence_number_path,
                                    }
                                }
                            },
                        },
                        payloads: [{
                            x: {
                                case: "text",
                                value: make_some_text(i),
                            },
                            itemPath: paths.item_path,
                        }],
                    }));
                }
                // late joiner
                const frames = await pubsub_.subscribe(paths.sequence_number_path);
                const stream = frames.stream;
                const frame = await stream.get();
                //console.log(`runner.publish.subscribe.snapshot: `, frame.toJsonString({prettySpaces}));
                if (frame?.payloads[0]?.x.case == "text" && frame.payloads[0].x.value == make_some_text(count - 1)) {
                    quit.resolve(true);
                    shutdown_server.resolve(true);
                } else {
                    throw new Error(`unexpected payload`);
                }
            }
            runner_publish().then(() => {
                console.log(`runner_publish exit`);
            })

            //console.log(`await'ing quit signal`);
            expect(await quit.promise).toBe(true);
            expect(await shutdown_server.promise).toBe(true);
        } finally {
            await disposable_stack.disposeAsync();
        }
    })
})

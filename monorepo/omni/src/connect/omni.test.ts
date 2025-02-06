// server
import {fastify} from "fastify";
import {fastifyConnectPlugin} from "@bufbuild/connect-fastify";
import {OmniImpl} from "./omni.impl";

// client
import {createPromiseClient} from "@bufbuild/connect";
import {Omni} from "../../proto/gen/devinternal_connect";
import {createConnectTransport} from "@bufbuild/connect-node";
import {GetDeltasRequest, UpsertRequest} from "../../proto/gen/devinternal_pb";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Deferred, delay} from "@esfx/async";
import crypto from "crypto";
import {make_user_paths} from "../common2/redis/make_paths";
import {spawn_server} from "../easy_pubsub/servers/late.join.server";
import {config, createTopics} from "../config";

const paths = make_user_paths(crypto.randomUUID());

describe(`connect server`, () => {
    test(`simple test`, async () => {
        const server = fastify();
        const config_ = (await config.create());
        await createTopics(config_);
        const disposable_stack = new AsyncDisposableStack();
        const shutdown_server = new Deferred<boolean>();
        disposable_stack.use(spawn_server(config_, disposable_stack, shutdown_server));
        let accumulated_checks_count = 0;
        const delta_count = 2;

        try {
            const omni_ = await OmniImpl.create(config_, disposable_stack, shutdown_server);
            await server.register(fastifyConnectPlugin, {
                routes(router) {
                    router.service(Omni, omni_);
                },
            });

            await server.listen({host: "localhost", port: 0});
            console.log("server is listening at", server.addresses());

            // client side testing
            const transport = createConnectTransport({
                baseUrl: `http://localhost:${server.addresses()[0].port}`,
                httpVersion: "1.1"
            });

            const test_val = `123`;
            const client = await createPromiseClient(Omni, transport);
            // intial delta
            const empty = await client.publish(new UpsertRequest({
                payload: {
                    x: {
                        case: "text",
                        value: test_val,
                    },
                    itemPath: paths.item_path,
                },
                sequenceNumberPath: paths.sequence_number_path,
            }));

            //console.log(`omni.test.upsert: `, empty);

            // get snap
            let keep_running = true;
            let deltasStartSequenceNumber = BigInt(0);
            while (keep_running) {
                await delay(100);
                const snapshot = await client.getSnapshot(paths.sequence_number_path);
                for (const payload of snapshot.payloads) {
                    if (payload) {
                        expect(payload.x.case).toBe(`text`);
                        expect(payload.x.value).toBe(test_val);
                        console.log(`deltasStartSequenceNumber.2: ${snapshot.deltasStartSequenceNumber}`);
                        expect(snapshot.deltasStartSequenceNumber).toBe(BigInt(2));
                        deltasStartSequenceNumber = snapshot.deltasStartSequenceNumber;
                        accumulated_checks_count++;
                        keep_running = false;
                        break;
                    }
                }
            }
            //console.log(`omni.test.snapshot: `, snapshot.toJsonString({prettySpaces: 2}));

            // add more deltas
            for (let i = 0; i < delta_count; i++) {
                const empty_2 = await client.publish(new UpsertRequest({
                    payload: {
                        x: {
                            case: "text",
                            value: i.toString(),
                        },
                        itemPath: paths.item_path,
                    },
                    sequenceNumberPath: paths.sequence_number_path,
                }));
            }

            // fetch deltas, relative to snap
            keep_running = true;
            let delta_index = 0;
            const endSequenceNumber = deltasStartSequenceNumber + BigInt(delta_count);
            let currentSequenceNumber = deltasStartSequenceNumber;
            while (keep_running) {
                await delay(100);
                const delta = await client.getDeltas(new GetDeltasRequest({
                    sequenceNumberPath: paths.sequence_number_path,
                    sequenceNumber: deltasStartSequenceNumber,
                }));
                if (delta.payloads) {
                    for (const payload of delta.payloads) {
                        if (payload && payload?.sequencing?.sequenceNumber) {
                            expect(payload.sequencing.sequenceNumber === currentSequenceNumber)
                            currentSequenceNumber++;
                            expect(payload.x.case).toBe(`text`);
                            expect(payload.x.value).toBe(delta_index.toString());
                            delta_index++;
                            if (delta_index == delta_count) {
                                keep_running = false;
                                accumulated_checks_count++;
                                shutdown_server.resolve(true);
                                break;
                            }
                        }
                    }
                }
            }

            expect(await shutdown_server.promise).toBe(true);
        } finally {
            await server.close();
            await disposable_stack.disposeAsync();
            expect(accumulated_checks_count).toBe(2);
        }
    })
})

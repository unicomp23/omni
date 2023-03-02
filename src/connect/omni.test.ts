// server
import {fastify} from "fastify";
import {fastifyConnectPlugin} from "@bufbuild/connect-fastify";
import {OmniImpl} from "./omni.impl";

// client
import {createPromiseClient} from "@bufbuild/connect";
import {Omni} from "../../proto/gen/devinternal_connect";
import {createConnectTransport} from "@bufbuild/connect-node";
import {UpsertRequest} from "../../proto/gen/devinternal_pb";
import {config} from "../config";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Deferred, delay} from "@esfx/async";
import crypto from "crypto";
import {make_paths} from "../common/redis/make_paths";
import {spawn_server} from "../easy/servers/late.join.server";

const paths = make_paths(crypto.randomUUID());

describe(`connect server`, () => {
    test(`simple test`, async () => {
        const server = fastify();
        const config_ = config.create();
        const disposable_stack = new AsyncDisposableStack();
        const shutdown_server = new Deferred<boolean>();
        disposable_stack.use(spawn_server(config_, disposable_stack, shutdown_server));
        let checks_count = 0;
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
            const empty = await client.upsert(new UpsertRequest({
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

            await delay(100);
            const snapshot = await client.getSnapshot(paths.sequence_number_path);
            for(const payload of snapshot.payloads) {
                if(payload) {
                    expect(payload.x.case).toBe(`text`);
                    expect(payload.x.value).toBe(test_val);
                    checks_count++;
                }
            }
            //console.log(`omni.test.snapshot: `, snapshot.toJsonString({prettySpaces: 2}));

            shutdown_server.resolve(true); // todo
            expect(await shutdown_server.promise).toBe(true);
        } finally {
            await server.close();
            await disposable_stack.disposeAsync();
            expect(checks_count).toBe(1);
        }
    })
})

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
import {Deferred} from "@esfx/async";

describe(`connect server`, () => {
    test(`simple test`, async () => {
        const server = fastify();
        const config_ = config.create();
        const disposable_stack = new AsyncDisposableStack();
        const shutdown = new Deferred<boolean>();
        try {
            const omni_ = await OmniImpl.create(config_, disposable_stack, shutdown);
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

            const client = await createPromiseClient(Omni, transport);
            const res = await client.upsert(new UpsertRequest());

            console.log(`upsert: `, res);
            expect(await shutdown.promise).toBe(true);
        } finally {
            await server.close();
            await disposable_stack.disposeAsync();
        }
    })
})

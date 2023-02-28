// server
import { fastify } from "fastify";
import { fastifyConnectPlugin } from "@bufbuild/connect-fastify";
import {OmniImpl} from "./omni.impl";

// client
import { createPromiseClient } from "@bufbuild/connect";
import { Omni } from "../../proto/gen/devinternal_connect";
import { createConnectTransport } from "@bufbuild/connect-node";
import {UpsertRequest} from "../../proto/gen/devinternal_pb";

describe(`connect server`, () => {
    test(`simple test`, async () => {
        const server = fastify();
        try {
            await server.register(fastifyConnectPlugin, {
                routes(router) {
                    router.service(Omni, new OmniImpl());
                },
            });

            await server.listen({host: "localhost", port: 0});
            console.log("server is listening at", server.addresses());

            // client
            const transport = createConnectTransport({
                baseUrl: `http://localhost:${server.addresses()[0].port}`,
                httpVersion: "1.1"
            });

            const client = await createPromiseClient(Omni, transport);
            const res = await client.upsert(new UpsertRequest());

            console.log(`upsert: `, res);
        } finally {
            await server.close();
        }
    })
})

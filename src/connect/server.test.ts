// server
import { fastify } from "fastify";
import { fastifyConnectPlugin } from "@bufbuild/connect-fastify";
import routes from "./connect";

// client
import { createPromiseClient } from "@bufbuild/connect";
import { Omni } from "../../proto/gen/devinternal_connect";
import { createConnectTransport } from "@bufbuild/connect-node";
import {UpsertRequest} from "../../proto/gen/devinternal_pb";

async function server() {
    const server = fastify();

    await server.register(fastifyConnectPlugin, {
        routes,
    });

    server.get("/", (_, reply) => {
        reply.type("text/plain");
        reply.send("Hello World!");
    });

    await server.listen({ host: "localhost", port: 8080 });
    console.log("server is listening at", server.addresses());
}

async function client() {
    const transport = createConnectTransport({
        baseUrl: "http://localhost:8080",
        httpVersion: "1.1"
    });

    const client = await createPromiseClient(Omni, transport);
    //const res = await client.say({ sentence: "I feel happy." });
    const res = await client.upsert(new UpsertRequest());
    console.log(res);
}

describe(`connect server`, () => {
    test(`simple test`, async () => {

    })
})

import {fastify} from "fastify";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Deferred} from "@esfx/async";
import {spawn_server} from "../easy_pubsub/servers/late.join.server";
import {OmniImpl} from "../connect/omni.impl";
import {fastifyConnectPlugin} from "@bufbuild/connect-fastify";
import {Omni} from "../../proto/gen/devinternal_connect";
import {config, createTopics} from "../config";

async function main() {
    console.log(`starting ...`);
    const server = fastify();
    const config_ = (await config.create());
    await createTopics(config_);
    const disposable_stack = new AsyncDisposableStack();
    const shutdown_server = new Deferred<boolean>();
    const worker_ = spawn_server(config_, disposable_stack, shutdown_server);
    disposable_stack.use(worker_);
    try {
        const omni_ = await OmniImpl.create(config_, disposable_stack, shutdown_server);
        await server.register(fastifyConnectPlugin, {
            routes(router) {
                router.service(Omni, omni_);
            },
        });

        await server.listen({host: "0.0.0.0", port: 80});
        console.log("server is listening at", server.addresses());

        console.log(`waiting on shutdown signal`);
        await shutdown_server.promise; // todo signals
        console.log(`shutdown signal received`);
    } finally {
        await disposable_stack.disposeAsync();
    }
}

main().then(() => {
    console.log(`main.exit`);
})

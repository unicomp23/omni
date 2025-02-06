import {worker} from "../worker";
import {AirCoreFrame, Commands, Coordinates, Path} from "../../../proto/gen/devinternal_pb";
import {topic_type} from "../../kafka/publisher";
import {config} from "../../config";
import {anydb} from "../../common2/redis/anydb";
import {createClient} from "redis";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Deferred} from "@esfx/async";

export function spawn_server(config_: config, disposable_stack: AsyncDisposableStack, shutdown: Deferred<boolean>) {
    const late_join_server = worker.create(config_, async (stream, publisher_) => {
        //const db_snapshot = new Map<string/*sequence_path*/, Map<string/*item_path*/, Payload>>(); // todo replace w/ redis
        const anydb_ = await anydb.create(createClient({url: config_.easy_pubsub.get_redis_uri()}));
        const subscriptions = new Map<string /*partition_key*/, Map<string /*correlation_id*/, Coordinates>>(); // todo, subscription keep-alive heartbeats, timeout results in cleanup
        disposable_stack.use(anydb_);

        for (; ;) {
            const frame_task = await stream.get();
            const shutdown_task = shutdown.promise;
            const result = await Promise.any([frame_task, shutdown_task]);
            if (result === true) break;

            const frame = result as AirCoreFrame;
            //console.log(`worker.received`, frame.toJsonString({prettySpaces}));
            try {
                switch (frame.command) {
                    case Commands.SUBSCRIBE: {
                        if (frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case != "sequenceNumberPath") throw new Error(`missing sendTo.kafkaKey.sequenceNumberPath.case`);
                        const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                        const key = Buffer.from(kafkaPartitionKey).toString("base64");
                        if (!frame.replyTo?.correlationId) throw new Error(`missing correlationId`);
                        if (!frame.replyTo?.kafkaKey?.kafkaPartitionKey) throw new Error(`missing replyTo.kafkaPartitionKey`);
                        if (frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x?.case != "partitionInteger") throw new Error(`missing replyTo.partitionInteger`);
                        if (!subscriptions.has(key))
                            subscriptions.set(key, new Map<string, Coordinates>());
                        const subscribers = subscriptions.get(key);
                        if (subscribers) {
                            subscribers.set(frame.replyTo?.correlationId, frame.replyTo.clone()); // save subscriber return path
                            //console.log(`subscribers.set: `, frame.toJsonString({prettySpaces}));
                            // send snapshot (ie late joiner support)
                            const snapshot = await anydb_.fetch_snapshot(frame.sendTo?.kafkaKey?.kafkaPartitionKey.x.value);
                            frame.payloads = [];
                            if (snapshot) for (const item of snapshot) {
                                const payload = item.payload;
                                frame.payloads.push(payload);
                            }
                            await publisher_.send(topic_type.reply_to, frame);
                            //console.log(`send.snapshot.to.subscriber: `, frame.toJsonString({prettySpaces}));
                        }
                        break;
                    }
                    case Commands.UPSERT: {
                        if (!(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "sequenceNumberPath")) throw new Error(`missing frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == sequenceNumberPath`);
                        const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                        if (!kafkaPartitionKey) throw new Error(`missing sendTo.kafkaPartitionKey.value`);
                        const payload = frame.payloads[0];
                        if (!payload) throw new Error(`missing payloads[0]`);
                        const key = Buffer.from(kafkaPartitionKey).toString("base64");
                        //console.log(`consumer.group.upsert: `, frame);
                        await anydb_.upsert(frame.sendTo.kafkaKey.kafkaPartitionKey.x.value, frame.payloads[0]);
                        const subscribers = subscriptions.get(key);
                        if (subscribers) {
                            for (const entry of subscribers.entries()) { // iterate subscriber return paths
                                const coordinates = entry[1];
                                //console.log(`send.to.subscriber.2`);
                                if (coordinates) {
                                    frame.replyTo = coordinates.clone();
                                    await publisher_.send(topic_type.reply_to, frame);
                                    //console.log(`send.delta.to.subscriber: `, frame.toJsonString({prettySpaces}));
                                }
                            }
                        }
                        break;
                    }
                    case Commands.KEEP_ALIVE:
                        // todo
                        break;
                    default:
                        throw new Error(`unhandled: ${Commands[frame.command].toString()}`);
                }
            } catch(e) {
                console.log(`late_join_server.1`, e);
            }
        }
        return true;
    });
    return late_join_server;
}

export function PathKey(path: Path | undefined) {
    if (path === undefined) throw new Error(`undefined path key`);
    return Buffer.from(path.toBinary()).toString("base64")
}

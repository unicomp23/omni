import {worker} from "../worker";
import {Commands, Coordinates, Path, Payload} from "../../../proto/gen/devinternal_pb";
import {topic_type} from "../../kafka/publisher";
import {config} from "../../config";

export function spawn_server(config_: config) {
    const late_join_server = new worker(config_, async (stream, publisher_) => {
        const db_snapshot = new Map<string/*sequence_path*/, Map<string/*item_path*/, Payload>>(); // todo replace w/ redis
        const subscriptions = new Map<string /*partition_key*/, Map<string /*correlation_id*/, Coordinates>>(); // todo, subscription keep-alive heartbeats, timeout results in cleanup

        for (; ;) {
            const frame = await stream.get();
            //console.log(`worker.received`, frame.toJsonString({prettySpaces}));
            switch (frame.command) {
                case Commands.SUBSCRIBE: {
                    if (frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case != "sequencePath") throw new Error(`missing sendTo.kafkaKey.partitionKey.case`);
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
                        const snapshot = db_snapshot.get(key); // fetch snapshot
                        frame.payloads = [];
                        if(snapshot) for(const item of snapshot) {
                            const payload = item[1];
                            frame.payloads.push(payload);
                        }
                        await publisher_.send(topic_type.reply_to, frame);
                        //console.log(`send.snapshot.to.subscriber: `, frame.toJsonString({prettySpaces}));
                    }
                    break;
                }
                case Commands.UPSERT: {
                    if (!(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "sequencePath")) throw new Error(`missing sendTo.partitionKey.case`);
                    const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                    if (!kafkaPartitionKey) throw new Error(`missing sendTo.kafkaPartitionKey.value`);
                    const payload = frame.payloads[0];
                    if (!payload) throw new Error(`missing payload`);
                    const key = Buffer.from(kafkaPartitionKey).toString("base64");
                    if(!db_snapshot.has(key)) db_snapshot.set(key, new Map<string, Payload>()); // update snapshot
                    const snapshot = db_snapshot.get(key);
                    if(snapshot) snapshot.set(PathKey(payload.itemPath), payload);
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
                default:
                    throw new Error(`unhandled: ${Commands[frame.command].toString()}`);
            }
        }
        return true;
    });
    return late_join_server;
}

export function PathKey(path: Path | undefined) {
    if(path === undefined) throw new Error(`undefined path key`);
    return Buffer.from(path.toBinary()).toString("base64")
}

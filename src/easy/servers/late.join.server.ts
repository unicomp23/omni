import {worker} from "../worker";
import {Commands, Coordinates, DbSnapshot, PayloadType} from "../../../proto/generated/devinternal_pb";
import {prettySpaces} from "../../common/constants";
import {topic_type} from "../../kafka/publisher";
import {config} from "../../config";

export function spawn_server(config_: config) {
    const late_join_server = new worker(config_, async(stream, publisher_) => {
        const db_snapshot = new DbSnapshot(); // todo replace w/ redis
        const subscriptions = new Map<string /*partition_key*/, Map<string /*correlation_id*/, Coordinates>>();

        for(;;) {
            const frame = await stream.get();
            console.log(`worker.received`, frame.toJsonString({prettySpaces}));
            switch (frame.command) {
                case Commands.SUBSCRIBE: {
                    if (frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case != "partitionKey") throw new Error(`missing sendTo.kafkaKey.partitionKey.case`);
                    const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                    const key = Buffer.from(kafkaPartitionKey).toString("base64");
                    if (!frame.replyTo?.correlationId) throw new Error(`missing correlationId`);
                    if (!frame.replyTo?.kafkaKey?.kafkaPartitionKey) throw new Error(`missing replyTo.kafkaPartitionKey`);
                    if (frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x?.case != "partitionInteger") throw new Error(`missing replyTo.partitionInteger`);
                    if(!subscriptions.has(key))
                        subscriptions.set(key, new Map<string, Coordinates>());
                    const subscribers = subscriptions.get(key);
                    if(subscribers) {
                        subscribers.set(frame.replyTo?.correlationId, frame.replyTo.clone());
                        console.log(`subscribers.set: `, frame.toJsonString({prettySpaces}));
                        // todo, send snapshot (ie late joiner support)
                        const payload = db_snapshot.entries[key];
                        if(payload) {
                            frame.payload = payload;
                            frame.payload.type = PayloadType.SNAPSHOT;
                            await publisher_.send(topic_type.reply_to, frame);
                            console.log(`send.snapshot.to.subscriber: `, frame.toJsonString({prettySpaces}));
                        }
                    }
                    break;
                }
                case Commands.UPSERT: {
                    if (!(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionKey")) throw new Error(`missing sendTo.partitionKey.case`);
                    const kafkaPartitionKey = frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value?.toBinary();
                    if (!kafkaPartitionKey) throw new Error(`missing sendTo.kafkaPartitionKey.value`);
                    const payload = frame.payload;
                    if (!payload) throw new Error(`missing payload`);
                    const key = Buffer.from(kafkaPartitionKey).toString("base64");
                    db_snapshot.entries[key] = payload;
                    const subscribers = subscriptions.get(key);
                    if(subscribers) {
                        for(const entry of subscribers.entries()) {
                            const coordinates = entry[1];
                            console.log(`send.to.subscriber.2`);
                            if(coordinates) {
                                frame.replyTo = coordinates.clone();
                                await publisher_.send(topic_type.reply_to, frame);
                                console.log(`send.delta.to.subscriber: `, frame.toJsonString({prettySpaces}));
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
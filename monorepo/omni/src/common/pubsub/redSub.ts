import { Redis } from "ioredis";
import { Message } from "../message/message";
import { AsyncQueue } from "@esfx/async-queue";
import { TagDataSnapshotIdentifier, TagDataObjectIdentifier } from "./redShared";

export class RedSub {
    private redisClient: Redis;

    constructor(redisClient: Redis) {
        this.redisClient = redisClient;
    }

    async getSnapshot(seqnoPath: TagDataSnapshotIdentifier): Promise<Map<TagDataObjectIdentifier, Message>> {
        const snapKey = 'snap:' + seqnoPath.serialize();
        const snapshot = new Map<TagDataObjectIdentifier, Message>();

        const hgetallResult = await this.redisClient.hgetall(snapKey);
        for (const key in hgetallResult) {
            if (hgetallResult.hasOwnProperty(key)) {
                const tagPath = TagDataObjectIdentifier.deserialize(key).pathArray;
                const message = Message.deserialize(hgetallResult[key]).message;
                snapshot.set(tagPath, message);
            }
        }

        return snapshot;
    }

    async subscribe(seqnoPath: TagDataSnapshotIdentifier): Promise<{
        queue: AsyncQueue<{
            tagPath: TagDataObjectIdentifier;
            seqno: string;
            message: Message;
        }>;
        queue_worker: Promise<void>
    }> {
        const streamKey = 'stream:' + seqnoPath.serialize();
        const queue = new AsyncQueue<{
            tagPath: TagDataObjectIdentifier;
            seqno: string;
            message: Message;
        }>();

        const snapshot = await this.getSnapshot(seqnoPath);
        let maxSeqno = 0;
        for (const message of snapshot.values()) {
            queue.put({
                tagPath: TagDataObjectIdentifier.deserialize(message.get('tagPath') || '').pathArray,
                seqno: message.get('seqno') || `1`,
                message
            });

            const toInt = parseInt(message.get('seqno') || `0`);
            if (toInt > maxSeqno) {
                maxSeqno = toInt;
            }
        }
        //console.log('maxSeqno', maxSeqno);
        let nextID = `${maxSeqno}-0`;

        const queue_worker = async () => {
            while (true) {
                //console.log('xread');
                const events = await this.redisClient.xread('BLOCK', 0, 'STREAMS', streamKey, nextID);
                //console.log('xread.events', events);

                if(events) events.forEach((streams) => {
                    const [stream_id, stream_events] = streams;

                    stream_events.forEach((event) => {
                        const id = event[0];
                        const fields = event[1];

                        const eventData: Record<string, string> = {};

                        for (let i = 0; i < fields.length; i += 2) {
                            const field = fields[i];
                            const value = fields[i + 1];
                            eventData[field] = value;
                        }

                        //console.log('eventData', eventData);
                        const tagPath = TagDataObjectIdentifier.deserialize(eventData['tagPath']).pathArray;
                        //console.log('tagPath', tagPath);
                        const message = Message.deserialize(eventData['message']).message;

                        const out = {
                            tagPath,
                            seqno: id,
                            message
                        };
                        //console.log('out.1', out);
                        queue.put(out);
                        nextID = id;
                    });
                });
            }
        };

        const workerPromise = queue_worker();
        return { queue, queue_worker: workerPromise };
    }
}
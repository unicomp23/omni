import {RedPub} from "./redPub";
import {TagDataSnapshotIdentifier, TagDataObjectIdentifier} from "./redShared";
import {Message} from "../message/message";
import {RedSub} from "./redSub";
import {Redis} from "ioredis";
import {randomUUID} from "crypto";
import {delay} from "@esfx/async";
import {AsyncDisposableStack} from "@esfx/disposable";

describe('Integration test for RedPub and RedSub', () => {
    it('Should publish and subscribe messages correctly', async () => {
        const stack = new AsyncDisposableStack();

        let recvCount = 0;
        const count = 3;

        const testId = randomUUID();
        const seqnoPath = TagDataSnapshotIdentifier.fromArray([testId, 'seqno']);
        const tagPath = TagDataObjectIdentifier.fromArray([testId, 'seqno', 'tag']);

        try {
            { // early joiner
                const redisClientPub = new Redis({host: 'redis', port: 6379});
                stack.use(redisClientPub, async () => {
                    redisClientPub.disconnect();
                });
                const redisClientSub = new Redis({host: 'redis', port: 6379});
                stack.use(redisClientSub, async () => {
                    redisClientSub.disconnect();
                });

                const redpub = new RedPub(redisClientPub);
                const redsub = new RedSub(redisClientSub);

                const message = new Message();

                const subscription = await redsub.subscribe(seqnoPath);
                console.log(`Subscribed to ${seqnoPath.serialize()}`);

                for (let i = 0; i < count; i++) {
                    message.set('key', `value${i}`);
                    await redpub.publish(seqnoPath, tagPath, message, null);
                    console.log(`Published message ${message.serialize()}`);
                }

                for (let i = 0; i < count; i++) {
                    const result = await subscription.queue.get();
                    console.log(`Received message `, result);

                    expect(result.tagPath.serialize()).toEqual(tagPath.serialize());
                    expect(result.message.get('key')).toBe(`value${i}`);

                    recvCount++;
                }
            }
            { // late joiner
                const redisClientSubLate = new Redis({host: 'redis', port: 6379});
                stack.use(redisClientSubLate, async () => {
                    redisClientSubLate.disconnect();
                });

                const redsub = new RedSub(redisClientSubLate);
                const subscription = await redsub.subscribe(seqnoPath);
                const result = await subscription.queue.get();
                console.log(`Received message.2 `, result);
                expect(result.message.get('key')).toBe(`value${count - 1}`);
                recvCount++;
            }

            console.log(`Done`);
        } finally {
            expect(recvCount).toBe(count + 1); // +1 for late joiner
            await stack.disposeAsync();
            console.log(`handles.Done`);
        }
    });
});

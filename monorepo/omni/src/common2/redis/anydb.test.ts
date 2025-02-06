import {anydb} from "./anydb";
import {createClient, RedisClientType} from "redis";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Path, Payload} from "../../../proto/gen/devinternal_pb";
import crypto from "crypto";
import {make_user_paths} from "./make_paths";
import {config, createTopics} from "../../config";

describe(`anydb`, () => {
    test(`publish delta, fetch delta`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        let completed = false;
        const config_ = await config.create();
        await createTopics(config_);
        const configEasyPubsub = config_.easy_pubsub;
        try {
            const anydb_ = await anydb.create(createClient({url: configEasyPubsub.get_redis_uri()}));
            await disposable_stack.use(anydb_);

            const paths = make_user_paths(crypto.randomUUID());
            await anydb_.upsert(paths.sequence_number_path, new Payload({
                x: {case: "text", value: "123"},
                itemPath: paths.item_path,
            }))
            const subscriber = await anydb_.fetch_deltas(paths.sequence_number_path, BigInt(1));
            for (const delta of subscriber) {
                expect(delta.x.case).toBe("text");
                expect(delta.x.value).toBe("123");
                completed = true;
                break;
            }
        } finally {
            await disposable_stack.disposeAsync();
            expect(completed).toBe(true);
        }
    })
    test(`publish delta, fetch snapshot`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        let completed = false;

        const config_ = await config.create();
        await createTopics(config_);
        const configEasyPubsub = config_.easy_pubsub;
        try {
            const anydb_ = await anydb.create(createClient({url: configEasyPubsub.get_redis_uri()}));
            await disposable_stack.use(anydb_);

            const paths = make_user_paths(crypto.randomUUID());
            await anydb_.upsert(paths.sequence_number_path, new Payload({
                x: {case: "text", value: "123"},
                itemPath: paths.item_path
            }))
            const subscriber = await anydb_.fetch_snapshot(paths.sequence_number_path);
            for (const item of subscriber) {
                const delta = item.payload;
                expect(delta.x.case).toBe("text");
                expect(delta.x.value).toBe("123");
                expect(delta.itemPath?.toJsonString()).toBe(paths.item_path.toJsonString());
                completed = true;
                break;
            }
        } finally {
            await disposable_stack.disposeAsync();
            expect(completed).toBe(true);
        }
    })
    test(`publish delta, fetch snapshot, publish delta, fetch snapshot deltas`, async () => {
        const disposable_stack = new AsyncDisposableStack();
        let completed = false;
        const config_ = await config.create();
        await createTopics(config_);
        const configEasyPubsub = config_.easy_pubsub;
        try {
            const anydb_ = await anydb.create(createClient({url: configEasyPubsub.get_redis_uri()}));
            await disposable_stack.use(anydb_);

            const paths = make_user_paths(crypto.randomUUID());
            let i = 0;
            // publish
            for (; i < 3; i++) {
                await anydb_.upsert(paths.sequence_number_path, new Payload({
                    x: {case: `text`, value: i.toString()},
                    itemPath: paths.item_path
                }))
            }
            // snapshot
            let snap_sequence_number = BigInt(0);
            {
                const subscriber = await anydb_.fetch_snapshot(paths.sequence_number_path);
                for (const item of subscriber) {
                    const delta = item.payload;
                    expect(delta.x.case).toBe("text");
                    expect(delta.x.value).toBe((i - 1).toString());
                    if (delta.sequencing?.sequenceNumber !== undefined)
                        snap_sequence_number = delta.sequencing?.sequenceNumber;
                    break;
                }
            }
            // publish
            const count = 3;
            const start = 3;
            for (; i < (count + start); i++) {
                await anydb_.upsert(paths.sequence_number_path, new Payload({
                    x: {
                        case: `text`,
                        value: i.toString()
                    },
                    itemPath: paths.item_path,
                }))
            }
            // fetch deltas
            {
                const subscriber = await anydb_.fetch_deltas(paths.sequence_number_path, snap_sequence_number);
                let counter = 0;
                for (const item of subscriber) {
                    counter++;
                    const delta = item;
                    expect(delta.x.case).toBe("text");
                    if (delta.x.value === (i - 1).toString())
                        break;
                }
                expect(counter - 1).toBe(count);
            }
            completed = true;
        } finally {
            await disposable_stack.disposeAsync();
            expect(completed).toBe(true);
        }
    })
});

import {anydb} from "./anydb";
import {createClient} from "redis";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Path, PathTypes, Payload, PayloadType, Tags} from "../../../proto/generated/devinternal_pb";
import crypto from "crypto";

function make_paths(app_id: string) {
    const sequence_number_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.APP_CHAN_USER}},
            {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
        ]
    });
    const topic_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.APP_CHAN_USER}},
            {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
            {tag: Tags.APP_USER_ID, x: {case: "text", value: "user_id_123"}},
        ]
    });
    return { sequence_number_path, topic_path };
}

describe(`anydb`, () => {
    test(`publish, fetch deltas`, async() => {
        const disposable_stack = new AsyncDisposableStack();
        try {
            const redis_uri = process.env.REDIS_URI;
            if(redis_uri) {
                const anydb_ = await anydb.create(createClient({url: redis_uri}));
                await disposable_stack.use(anydb_);

                const paths = make_paths(crypto.randomUUID());
                await anydb_.upsert(paths.sequence_number_path, paths.topic_path, new Payload({x: {case: "text", value: "123"}, type: PayloadType.DELTA}))
                //const subscriber = anydb_.fetch_deltas()
            } else {
                throw new Error(`missing REDIS_URI`);
            }
        } finally {
            await disposable_stack.disposeAsync();
        }
    })
    test(`publish, fetch snapshot`, async() => {
        // todo
    })
    test(`publish, fetch snapshot, publish, fetch deltas `, async() => {
        // todo
    })
})

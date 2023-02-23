import {anydb} from "./anydb";
import {createClient} from "redis";
import {AsyncDisposableStack} from "@esfx/disposable";
import {TopicArray} from "../topic_array";

function make_paths() {
    const sequence_number_path = TopicArray.create();
    sequence_number_path.push({tag: ``, val: ``}, {tag: ``, val: ``}, );
}

describe(`anydb`, () => {
    test(`subscribe then publish`, async() => {
        const disposable_stack = new AsyncDisposableStack();
        try {
            const redis_uri = process.env.REDIS_URI;
            if(redis_uri) {
                const anydb_ = await anydb.create(createClient({url: redis_uri}));
                await disposable_stack.use(anydb_);

                //anydb_.upsert()
                //const subscriber = anydb_.fetch_deltas()
            } else {
                throw new Error(`missing REDIS_URI`);
            }
        } finally {
            await disposable_stack.disposeAsync();
        }
    })
})

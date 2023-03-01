import {RedisClientType} from "redis";
import {AsyncDisposable} from "@esfx/disposable";
import {TopicArray} from "../topic_array";
import {Path, Payload, Sequencing} from "../../../proto/gen/devinternal_pb";
import {protoBase64, protoInt64} from "@bufbuild/protobuf";

const zset_suffix = `-z`;
const stream_suffix = `-s`;

export class anydb {
    private last_sequence_number = new Map<string /*seqno_path*/, number>();

    private constructor(
        private readonly client: RedisClientType,
    ) {
        client.on('error', err => console.log('Redis Client Error', err));
    }

    public static async create(client: RedisClientType) {
        const anydb_ = new anydb(client);
        await anydb_.client.connect();
        return anydb_;
    }

    public async upsert(sequence_number_path_: Path, payload: Payload) {
        const sequence_number_path = TopicArray.from_path(sequence_number_path_);
        if (!payload.itemPath)
            throw new Error(`missing topic path`);
        const item_path = TopicArray.from_path(payload.itemPath);
        if (!item_path.contains_path(sequence_number_path))
            throw new Error(
                `item_path is not parent of sequence_number_path, ` +
                `item_path: ${item_path}, sequence_number_path: ${sequence_number_path}`);

        const sequence_number_key = sequence_number_path.serialize();
        const sequence_number = await this.sync_sequence_number(sequence_number_key);
        await this.increment_sequence_number(sequence_number_key);

        if (!payload.sequencing) payload.sequencing = new Sequencing();
        payload.sequencing.sequenceNumber = protoInt64.parse(sequence_number);

        const encoded64 = protoBase64.enc(payload.toBinary())
        await this.client.hSet(sequence_number_key + zset_suffix, item_path.serialize(), encoded64);
        await this.client.xAdd(sequence_number_key + stream_suffix, `${sequence_number}-0`, {encoded64}, {
                TRIM: {
                    strategy: 'MAXLEN', // Trim by length.
                    strategyModifier: '~', // Approximate trimming.
                    threshold: 1000 // Retain around 1000 entries. // todo config
                }
            }
        );
    }

    public async fetch_snapshot(sequence_number_path_: Path) {
        const sequence_number_path = TopicArray.from_path(sequence_number_path_);
        const sequence_number_key = sequence_number_path.serialize();
        const result = await this.client.hGetAll(sequence_number_key + zset_suffix);
        const arr = new Array<{item_path: string, payload: Payload}>();
        for (const item_path_base64 in result) {
            const val = result[item_path_base64];
            const payload = Payload.fromBinary(protoBase64.dec(val));
            arr.push({
                item_path: Buffer.from(item_path_base64, `base64`).toString(`ascii`),
                payload,
            });
        }
        return arr;
    }

    public async fetch_deltas(sequence_number_path_: Path, sequence_number: BigInt) {
        const sequence_number_path = TopicArray.from_path(sequence_number_path_);
        const sequence_number_key = sequence_number_path.serialize();

        const count = 100; // todo config
        const results = await this.client.xRange(sequence_number_key + stream_suffix, `${sequence_number}-0`, `+`, {});
        const arr = new Array<Payload>();
        for (const result of results) {
            const encoded64 = result.message[`encoded64`];
            arr.push(Payload.fromBinary(protoBase64.dec(encoded64)));
        }
        return arr;
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.client.quit();
    }

    private async sync_sequence_number(key: string): Promise<number> {
        if (!this.last_sequence_number.has(key)) {
            const val = await this.client.get(key);
            let sequence_number = 1; // redis streams disallow 0-0
            if (val)
                sequence_number = Number.parseInt(val);
            this.last_sequence_number.set(key, sequence_number);
            //console.log(`last_sequence_number.set: ${sequence_number}`);
        }
        const sequence_number = this.last_sequence_number.get(key);
        //console.log(`last_sequence_number.get: ${sequence_number}`);
        if (sequence_number !== undefined)
            return sequence_number;
        else
            throw new Error(`not expected: ${sequence_number}`);
    }

    private async increment_sequence_number(key: string) {
        await this.sync_sequence_number(key);
        const current = this.last_sequence_number.get(key);
        if (current !== undefined) {
            const next = current + 1;
            this.last_sequence_number.set(key, next);
            await this.client.set(key, next.toString());
            return next;
        }
        throw new Error(`should get here`);
    }
}

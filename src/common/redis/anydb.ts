import {RedisClientType} from "redis";
import {AsyncDisposable} from "@esfx/disposable";
import {TopicArray} from "../topic_array";
import {check_integer} from "../ksortable_length_delimiter";
import {Payload, Sequencing} from "../../../proto/generated/devinternal_pb";
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

    public static async create(client: RedisClientType, name: string) {
        const anydb_ = new anydb(client);
        await anydb_.client.connect();
        return anydb_;
    }

    public async upsert(sequence_number_path: TopicArray, topic_path: TopicArray, payload: Payload) {
        if (!topic_path.contains_path(sequence_number_path))
            throw new Error(
                `topic_path is not parent of sequence_number_path, ` +
                `topic_path: ${topic_path}, sequence_number_path: ${sequence_number_path}`);

        const sequence_number_key = sequence_number_path.serialize();
        const sequence_number = await this.get_sequence_number(sequence_number_key);
        await this.increment_sequence_number(sequence_number_key);

        if (!payload.sequencing) payload.sequencing = new Sequencing();
        payload.sequencing.sequenceNumber = protoInt64.parse(sequence_number);

        const encoded64 = protoBase64.enc(payload.toBinary())
        await this.client.zAdd(sequence_number_key + zset_suffix, [{score: 0, value: topic_path.serialize_zkey(encoded64)}]);
        await this.client.xAdd(sequence_number_key + stream_suffix, `${sequence_number}-0`, {encoded64}, {
                TRIM: {
                    strategy: 'MAXLEN', // Trim by length.
                    strategyModifier: '~', // Approximate trimming.
                    threshold: 1000 // Retain around 1000 entries. // todo config
                }
            }
        );
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.client.disconnect();
    }

    private async sync_sequence_number(key: string) {
        if (!this.last_sequence_number.has(key)) {
            const val = await this.client.get(key);
            let sequence_number = 0;
            if (val)
                sequence_number = Number.parseInt(val);
            this.last_sequence_number.set(key, sequence_number);
            return sequence_number;
        }
        const sequence_number = this.last_sequence_number.get(key);
        if (sequence_number) return sequence_number;
        else throw new Error(`not expected`);
    }

    private async increment_sequence_number(key: string) {
        await this.sync_sequence_number(key);
        const current = this.last_sequence_number.get(key);
        if (current) {
            const next = current + 1;
            this.last_sequence_number.set(key, next);
            await this.client.set(key, next.toString());
            return next;
        }
        throw new Error(`should get here`);
    }

    private async get_sequence_number(key: string) {
        const val = this.last_sequence_number.get(key);
        if (!val)
            return await this.sync_sequence_number(key);
        else
            return val;
    }

    private async* fetch_snapshot(sequence_number_path: TopicArray) {
        const sequence_number_key = `[` + sequence_number_path.serialize();
        const result = await this.client.zRangeByLex(sequence_number_key + zset_suffix, sequence_number_key, sequence_number_key);
        for (const z_key of result) {
            const topic_array = new TopicArray();
            topic_array.deserialize(z_key);
            const top = topic_array.pop();
            if (top) {
                const payload = Payload.fromBinary(protoBase64.dec(top.val));
                yield {
                    topic_path: topic_array,
                    payload,
                }
                continue;
            }
            throw new Error(`malformed topic array`);
        }
    }

    private async* fetch_deltas(sequence_number_path: TopicArray, sequence_number: number) {
        check_integer(sequence_number);
        const sequence_number_key = sequence_number_path.serialize();

        const count = 100; // todo config
        const results = await this.client.xRange(sequence_number_key + stream_suffix, `${sequence_number}-0`, `+`, {});
        for(const result of results) {
            const encoded64 = result.message[`encoded64`];
            yield Payload.fromBinary(protoBase64.dec(encoded64));
        }
    }
}

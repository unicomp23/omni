import {RedisClientType} from "redis";
import {AsyncDisposable} from "@esfx/disposable";
import {TopicArray} from "../topic_array";
import {check_integer} from "../ksortable_length_delimiter";
import {Payload, Sequencing, Path} from "../../../proto/generated/devinternal_pb";
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

    public async upsert(sequence_number_path_: Path, topic_path_: Path, payload: Payload) {
        const sequence_number_path = TopicArray.from_path(sequence_number_path_);
        const topic_path = TopicArray.from_path(topic_path_);
        if (!topic_path.contains_path(sequence_number_path))
            throw new Error(
                `topic_path is not parent of sequence_number_path, ` +
                `topic_path: ${topic_path}, sequence_number_path: ${sequence_number_path}`);

        const sequence_number_key = sequence_number_path.serialize();
        const sequence_number = await this.sync_sequence_number(sequence_number_key);
        await this.increment_sequence_number(sequence_number_key);

        if (!payload.sequencing) payload.sequencing = new Sequencing();
        payload.sequencing.sequenceNumber = protoInt64.parse(sequence_number);

        const encoded64 = protoBase64.enc(payload.toBinary())
        await this.client.hSet(sequence_number_key + zset_suffix, topic_path.serialize(), encoded64);
        await this.client.xAdd(sequence_number_key + stream_suffix, `${sequence_number}-0`, {encoded64}, {
                TRIM: {
                    strategy: 'MAXLEN', // Trim by length.
                    strategyModifier: '~', // Approximate trimming.
                    threshold: 1000 // Retain around 1000 entries. // todo config
                }
            }
        );
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

    public async* fetch_snapshot(sequence_number_path_: Path) {
        const sequence_number_path = TopicArray.from_path(sequence_number_path_);
        const sequence_number_key = sequence_number_path.serialize();
        const result = await this.client.hGetAll(sequence_number_key + zset_suffix);
        for (const topic_path_base64 in result) {
            const val = result[topic_path_base64];
            const payload = Payload.fromBinary(protoBase64.dec(val));
            yield {
                topic_path: Buffer.from(topic_path_base64, `base64`).toString(`ascii`),
                payload,
            }
        }
    }

    public async* fetch_deltas(sequence_number_path_: Path, sequence_number: number) {
        const sequence_number_path = TopicArray.from_path(sequence_number_path_);
        check_integer(sequence_number);
        const sequence_number_key = sequence_number_path.serialize();

        const count = 100; // todo config
        const results = await this.client.xRange(sequence_number_key + stream_suffix, `${sequence_number}-0`, `+`, {});
        for(const result of results) {
            const encoded64 = result.message[`encoded64`];
            yield Payload.fromBinary(protoBase64.dec(encoded64));
        }
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.client.quit();
    }
}

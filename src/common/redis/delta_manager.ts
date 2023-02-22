import {RedisClientType} from "redis";
import {AsyncDisposable} from "@esfx/disposable";
import {TopicArray} from "../topic_array";
import {check_integer} from "../ksortable_length_delimiter";
import {name} from "ts-jest/dist/transformers/hoist-jest";

export class delta_manager {
    private constructor(
        private readonly client: RedisClientType,
        private readonly name: string,
    ) {
        client.on('error', err => console.log('Redis Client Error', err));
    }
    public static async create(client: RedisClientType, name: string) {
        const delta_manager_ = new delta_manager(client, name);
        await delta_manager_.client.connect();
        return delta_manager_;
    }
    private last_sequence_number = new Map<string /*seqno_path*/, number>();
    private async sync_sequence_number(key: string) {
        if(!this.last_sequence_number.has(key)) {
            const val = await this.client.get(key);
            let sequence_number = 0;
            if (val)
                sequence_number = Number.parseInt(val);
            this.last_sequence_number.set(key, sequence_number);
        }
    }
    private async increment_sequence_number(key: string) {
        await this.sync_sequence_number(key);
        const current = this.last_sequence_number.get(key);
        if(current) {
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
            await this.sync_sequence_number(key);
        else
            return val;
    }
    public async upsert(sequence_number_path: TopicArray, topic_path: TopicArray, payload: string) {
        if(!topic_path.contains_path(sequence_number_path))
            throw new Error(
                `topic_path does not contain sequence_number_path, ` +
                `topic_path: ${topic_path}, sequence_number_path: ${sequence_number_path}`);

        const sequence_number_key = sequence_number_path.serialize();
        await this.client.zAdd(this.name, [{score: 0, value: topic_path.serialize_zkey(payload)}]);
        await this.increment_sequence_number(sequence_number_key);
    }
    public async* fetch(sequence_number_path: TopicArray, sequence_number: number) {
        check_integer(sequence_number);

        const sequence_number_key = sequence_number_path.serialize();
        if(sequence_number == 0)
            yield* this.fetch_snapshot(sequence_number_path);
        yield* this.fetch_deltas(sequence_number_path, sequence_number);
    }
    private async* fetch_snapshot(sequence_number_path: TopicArray) {
        // todo
    }
    private async* fetch_deltas(sequence_number_path: TopicArray, sequence_number: number) {
        // todo
    }
    async[AsyncDisposable.asyncDispose]() {
        await this.client.disconnect();
    }
}

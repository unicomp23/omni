import {tag_val, TopicArray} from "../ksortable_length_delimiter";

export class delta_manager {
    private constructor() {
    }
    public static create() {
        return new delta_manager();
    }
    private last_seqno = new Map<string /*seqno_path*/, number>();
    public async upsert(sequence_number_path: TopicArray, topic_path: TopicArray, payload: string) {
        // todo
    }
    public async* fetch(sequence_number_path: TopicArray, seqno: number) {
        // todo
    }
}

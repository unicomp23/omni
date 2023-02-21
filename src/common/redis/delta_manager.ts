import {tag_val} from "../ksortable_length_delimiter";

export class delta_manager {
    private last_seqno = new Map<string /*seqno_path*/, number>();
    public async upsert(seqno_path: Array<tag_val>, topic_path: Array<tag_val>, payload: string) {
        // todo
    }
    public async* fetch(seqno_path: Array<tag_val>, seqno: number) {
        // todo
    }
}

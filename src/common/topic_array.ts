import {ksortable_length_delimiter, tag_val} from "./ksortable_length_delimiter";

export class TopicArray extends Array<tag_val> {
    public serialize() {
        return ksortable_length_delimiter.serialize(this);
    }

    public deserialize(payload: string) {
        this.length = 0;
        ksortable_length_delimiter.deserialize_tags(payload, this);
    }

    public serialize_zkey(payload: string) {
        const arr = this.clone();
        arr.push({tag: `payload`, val: payload});
        return arr.serialize();
    }

    public deserialize_zkey(payload: string) {
        this.length = 0;
        this.deserialize(payload);
        if (this[this.length - 1].tag != `payload`)
            throw new Error(`missing payload entry`);
        const payload_inner = this[this.length - 1].val;
        this.pop();
        return payload_inner;
    }

    public clone() {
        const arr = new TopicArray();
        for (const pair of this.entries())
            arr.push({tag: pair[1].tag, val: pair[1].val});
        return arr;
    }

    public contains_path(arr: TopicArray) {
        let index = 0;
        for (const pair of arr) {
            const pair_2 = this[index];
            if (pair.tag != pair_2.tag)
                return false;
            if (pair.val != pair_2.val)
                return false;
            index++;
        }
        return true;
    }
}

import {TopicArray} from "./topic_array";

const delimiter_encode_radix = 16;
const max_token_len = 1024;
const min_token_len = 0;

export interface tag_val {
    tag: string;
    val: string;
}

export function check_integer(val: number) {
    if (val != Math.floor(val))
        throw new Error(`not an integer: ${val}`);
}

export class ksortable_length_delimiter {
    private constructor() {
    }

    public static length_delimiter_to_string(len: number) {
        if (len < min_token_len) throw new Error(`cannot be negative`);
        if (len > max_token_len) throw new Error(`cannot be > ${max_token_len}`);
        check_integer(len);
        const body = len.toString(delimiter_encode_radix);
        const body_len = body.length.toString(delimiter_encode_radix);
        if (body.length > 0xf) throw new Error(`f is max prefix: ${body_len}`);
        return body_len + body;
    }

    public static token_to_string(tag: string) {
        return ksortable_length_delimiter.length_delimiter_to_string(tag.length) + tag;
    }

    public static length_delimiter_from_string(index: number, payload: string) {
        check_integer(index);
        const tmp = payload.at(index);
        if (tmp) {
            const body_len = parseInt(tmp, delimiter_encode_radix);
            if (body_len > 15) throw new Error(`invalid prefix`);
            if (body_len < 0) throw new Error(`invalid negative prefix`);
            const body = payload.substr(index + 1, body_len);
            return {
                val: parseInt(body, delimiter_encode_radix),
                next_offset: index + 1 + body_len,
            }
        }
        throw new Error(`invalid prefix`);
    }

    public static token_from_string(index: number, payload: string) {
        const next = this.length_delimiter_from_string(index, payload);
        return {
            val: payload.substr(next.next_offset, next.val),
            next_offset: next.next_offset + next.val,
        }
    }

    // topics which are length-delimited and serialized/deserialized as arrays of tag/value's, for use in redis sorted sets and kafka partition keys
    public static serialize(tags: TopicArray) {
        const arr = new Array<string>();
        for (const iter of tags) {
            arr.push(ksortable_length_delimiter.token_to_string(iter.tag));
            arr.push(ksortable_length_delimiter.token_to_string(iter.val));
        }
        return arr.join(``);
    }

    public static deserialize_tags(payload: string, tags: TopicArray) {
        let index = 0;
        while (index < payload.length) {
            const next_tag = ksortable_length_delimiter.token_from_string(index, payload);
            index = next_tag.next_offset;
            const next_val = ksortable_length_delimiter.token_from_string(index, payload);
            index = next_val.next_offset;
            tags.push({
                tag: next_tag.val,
                val: next_val.val,
            });
        }
    }
}

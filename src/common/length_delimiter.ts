const delimiter_encode_radix = 16;
const max_token_len = 255;
const min_token_len = 0;

export class tag_val {
    public tag: string = "";
    public val: string = "";
}

export class length_delimiter {
    private constructor() {
    }
    public static create() {
        return new length_delimiter();
    }
    public static length_delimiter_to_string(len: number) {
        if(len < min_token_len) throw new Error(`cannot be negative`);
        if(len > max_token_len) throw new Error(`cannot be > ${max_token_len}`);
        if(len != Math.floor(len)) throw new Error(`must be integer`);
        const body = len.toString(delimiter_encode_radix);
        const body_len = body.length.toString(delimiter_encode_radix);
        if(body.length > 0xf) throw new Error(`f is max prefix: ${body_len}`);
        return body_len + body;
    }
    public static token_to_string(tag: string) {
        return length_delimiter.length_delimiter_to_string(tag.length) + tag;
    }
    public static length_delimiter_from_string(index: number, payload: string) {
        if(index != Math.floor(index)) throw new Error(`must be integer`);
        const tmp = payload.at(index);
        if(tmp) {
            const body_len = parseInt(tmp, delimiter_encode_radix);
            if(body_len > 15) throw new Error(`invalid prefix`);
            if(body_len < 0) throw new Error(`invalid negative prefix`);
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
    public serialize(tags: Array<tag_val>) {
        const arr = new Array<string>();
        for(const iter of tags) {
            arr.push(length_delimiter.token_to_string(iter.tag));
            arr.push(length_delimiter.token_to_string(iter.val));
        }
        return arr.join();
    }
    public deserialize_tags(payload: string) {
        const tags = new Array<tag_val>();
        let index = 0;
        while(index < payload.length) {
            const next_tag = length_delimiter.token_from_string(index, payload);
            index = next_tag.next_offset;
            const next_val = length_delimiter.token_from_string(index, payload);
            index = next_val.next_offset;
            tags.push({
                tag: next_tag.val,
                val: next_val.val,
            });
        }
        return tags;
    }
}

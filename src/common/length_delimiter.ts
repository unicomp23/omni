const radix = 16;
const max_len = 255;
const min_len = 0;
export class length_delimiter {
    public static to_string(len: number) {
        if(len != Math.floor(len)) throw new Error(`must be integer`);
        if(len < min_len) throw new Error(`cannot be negative`);
        if(len > max_len) throw new Error(`cannot be > ${max_len}`);
        const body = len.toString(radix);
        const body_len = body.length.toString(radix);
        if(body.length > 1) throw new Error(`f is max prefix`);
        return body_len + body;
    }
    public static from_string(index: number, payload: string) {
        if(index != Math.floor(index)) throw new Error(`must be integer`);
        const tmp = payload.at(index);
        if(tmp) {
            const body_len = parseInt(tmp, radix);
            if(body_len > 15) throw new Error(`invalid prefix`);
            if(body_len < 0) throw new Error(`invalid negative prefix`);
            const body = payload.substr(index + 1, body_len);
            return {
                val: parseInt(body, radix),
                next_offset: index + 1 + body_len,
            }
        }
        throw new Error(`invalid prefix`);
    }
}

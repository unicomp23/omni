import {ksortable_length_delimiter, tag_val} from "./ksortable_length_delimiter";
import {Path, PathTypes, Tags} from "../../proto/gen/devinternal_pb";

export class TopicArray extends Array<tag_val> {
    private constructor() {
        super();
    }

    public static create() {
        return new TopicArray();
    }

    public static from_path(path: Path) {
        const topic_array = new TopicArray();
        for (const hop of path.hops) {
            switch (hop.x.case) {
                case "pathType":
                    topic_array.push({tag: Tags[hop.tag], val: PathTypes[hop.x.value]});
                    break;
                case "scopeType":
                    topic_array.push({tag: Tags[hop.tag], val: PathTypes[hop.x.value]});
                    break;
                case "text":
                    topic_array.push({tag: Tags[hop.tag], val: hop.x.value});
                    break;
                case "integer":
                    topic_array.push({tag: Tags[hop.tag], val: hop.x.value.toString()});
                    break;
                case "fraction":
                    topic_array.push({tag: Tags[hop.tag], val: hop.x.value.toString()});
                    break;
                default:
                    throw new Error(`unknown oneof: ${hop.x.case}`);
            }
        }
        return topic_array;
    }

    public serialize() {
        const readable = ksortable_length_delimiter.serialize(this);
        const unreadable = Buffer.from(readable).toString(`base64`);
        return unreadable;
    }

    public deserialize(payload: string) {
        this.length = 0;
        const unreadable = payload;
        const readable = Buffer.from(unreadable, 'base64').toString(`ascii`);
        ksortable_length_delimiter.deserialize_tags(readable, this);
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
        if (arr.length >= this.length)
            throw new Error(`must be a parent path`);
        for (let i = 1; i < arr.length; i++) { // skip PATH_TYPE
            const pair = arr[i];
            const pair_2 = this[i];
            if (pair.tag != pair_2.tag)
                return false;
            if (pair.val != pair_2.val)
                return false;
        }
        return true;
    }
}

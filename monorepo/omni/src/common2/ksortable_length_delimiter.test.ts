import {ksortable_length_delimiter} from "./ksortable_length_delimiter";
import {TopicArray} from "./topic_array";

describe(`length delimited tokens`, () => {
    test(`length delimiter serde`, () => {
        const val = 231;
        const serialized = ksortable_length_delimiter.length_delimiter_to_string(val);
        const val_2 = ksortable_length_delimiter.length_delimiter_from_string(0, serialized);
        expect(val_2.val).toBe(val);
    })
    test(`length delimited token serde`, () => {
        const val = `dog`;
        const serialized = ksortable_length_delimiter.token_to_string(val);
        const val_2 = ksortable_length_delimiter.token_from_string(0, serialized);
        expect(val_2.val).toBe(val);
    })
    test(`topic array serde`, () => {
        const arr = TopicArray.create();
        arr.push({tag: `type`, val: `dog`});
        const serialized = ksortable_length_delimiter.serialize(arr);
        const arr_2 = TopicArray.create();
        ksortable_length_delimiter.deserialize_tags(serialized, arr_2);
        expect(arr_2[0].tag).toBe(arr[0].tag);
        expect(arr_2[0].val).toBe(arr[0].val);
    })
})
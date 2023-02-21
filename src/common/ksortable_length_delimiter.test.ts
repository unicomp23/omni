import {ksortable_length_delimiter, tag_val} from "./ksortable_length_delimiter";

describe(`length delimited tokens`, () => {
    test(`todo remove`, () => {
        //expect(false).toBe(true);
    })
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
        const arr = new Array<tag_val>();
        arr.push({tag: `type`, val: `dog`});
        const serialized = ksortable_length_delimiter.serialize(arr);
        const arr_2 = ksortable_length_delimiter.deserialize_tags(serialized);
        expect(arr_2[0].tag).toBe(arr[0].tag);
        expect(arr_2[0].val).toBe(arr[0].val);
    })
})
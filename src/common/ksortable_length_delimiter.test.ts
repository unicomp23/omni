import {ksortable_length_delimiter} from "./ksortable_length_delimiter";

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
})
import {Path, PathTypes, Tags} from "../../../proto/gen/devinternal_pb";

export function make_paths(app_id: string) {
    const sequence_number_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.SEQ_APP_CHAN}},
            {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
        ]
    });
    const item_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.ITEM_APP_CHAN_USER}},
            {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
            {tag: Tags.APP_USER_ID, x: {case: "text", value: "user_id_123"}},
        ]
    });
    return {sequence_number_path, item_path};
}
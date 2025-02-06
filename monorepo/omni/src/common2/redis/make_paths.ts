import {Path, PathTypes, ScopeTypes, Tags} from "../../../proto/gen/devinternal_pb";

// Tags.PATH_TYPE allows us to validate the shape of a message and stop malformed message at the grpc call
// ie PathTypes.SEQ_APP_CHAN means Tags.APP_ID at hops[2], Tags.APP_CHANNEL_ID at hops[3] must both be present, and are "text" fields, etc.

// Tags.SCOPE_TYPE specifies whether message is SYSTEM or USER

export function make_user_paths(app_id: string) {
    const sequence_number_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.SEQ_APP_CHAN}},
            {tag: Tags.SCOPE_TYPE, x: {case: "scopeType", value: ScopeTypes.USER}},

            {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},
        ]
    });
    const item_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.ITEM_APP_CHAN_USER}},
            {tag: Tags.SCOPE_TYPE, x: {case: "scopeType", value: ScopeTypes.USER}},

            {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
            {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: "chan_id_123"}},

            {tag: Tags.APP_USER_ID, x: {case: "text", value: "user_id_123"}},
        ]
    });
    return {sequence_number_path, item_path};
}

export function make_system_paths(app_id: string) {
    const sequence_number_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.SEQ_RECORDING}},
            {tag: Tags.SCOPE_TYPE, x: {case: "scopeType", value: ScopeTypes.SYSTEM}},
        ]
    });
    const item_path = new Path({
        hops: [
            {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.ITEM_RECORDING}},
            {tag: Tags.SCOPE_TYPE, x: {case: "scopeType", value: ScopeTypes.SYSTEM}},
        ]
    });
    return {sequence_number_path, item_path};
}

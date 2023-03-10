// @generated by protoc-gen-es v1.0.0 with parameter "target=ts"
// @generated from file devinternal.proto (package aircore.media.omni.v1, syntax proto3)
/* eslint-disable */
// @ts-nocheck

import type {
  BinaryReadOptions,
  FieldList,
  JsonReadOptions,
  JsonValue,
  PartialMessage,
  PlainMessage
} from "@bufbuild/protobuf";
import {Any, Message, proto3, protoInt64, Timestamp} from "@bufbuild/protobuf";

/**
 * @generated from enum aircore.media.omni.v1.Tags
 */
export enum Tags {
    /**
     * @generated from enum value: UNKNOWN_TAG = 0;
     */
    UNKNOWN_TAG = 0,

    /**
     * PathTypes
     *
     * @generated from enum value: PATH_TYPE = 1;
     */
    PATH_TYPE = 1,

    /**
     * @generated from enum value: APP_ID = 5;
     */
    APP_ID = 5,

    /**
     * @generated from enum value: APP_CHANNEL_ID = 10;
     */
    APP_CHANNEL_ID = 10,

    /**
     * @generated from enum value: APP_GROUP_ID = 15;
     */
    APP_GROUP_ID = 15,

    /**
     * @generated from enum value: APP_SUB_GROUP_ID = 20;
     */
    APP_SUB_GROUP_ID = 20,

    /**
     * @generated from enum value: APP_ROOM_ID = 25;
     */
    APP_ROOM_ID = 25,

    /**
     * @generated from enum value: APP_USER_ID = 30;
     */
    APP_USER_ID = 30,

    /**
     * @generated from enum value: APP_SESSION_ID = 35;
     */
    APP_SESSION_ID = 35,

    /**
     * @generated from enum value: APP_BLAH_BLAH_ID = 40;
     */
    APP_BLAH_BLAH_ID = 40,

    /**
     * @generated from enum value: DB_NAME = 50;
     */
    DB_NAME = 50,

    /**
     * @generated from enum value: DB_TABLE = 55;
     */
    DB_TABLE = 55,

    /**
     * @generated from enum value: DB_ROW_ID = 60;
     */
    DB_ROW_ID = 60,

    /**
     * @generated from enum value: DB_COLUMN_ID = 65;
     */
    DB_COLUMN_ID = 65,

    /**
     * @generated from enum value: DB_BLAH_BLAH_ID = 70;
     */
    DB_BLAH_BLAH_ID = 70,

    /**
     * @generated from enum value: PK_PLANET = 100;
     */
    PK_PLANET = 100,

    /**
     * @generated from enum value: PK_REGION = 110;
     */
    PK_REGION = 110,

    /**
     * @generated from enum value: PK_SUB_REGION = 120;
     */
    PK_SUB_REGION = 120,
}

// Retrieve enum metadata with: proto3.getEnumType(Tags)
proto3.util.setEnumType(Tags, "aircore.media.omni.v1.Tags", [
    {no: 0, name: "UNKNOWN_TAG"},
    {no: 1, name: "PATH_TYPE"},
    {no: 5, name: "APP_ID"},
    {no: 10, name: "APP_CHANNEL_ID"},
    {no: 15, name: "APP_GROUP_ID"},
    {no: 20, name: "APP_SUB_GROUP_ID"},
    {no: 25, name: "APP_ROOM_ID"},
    {no: 30, name: "APP_USER_ID"},
    {no: 35, name: "APP_SESSION_ID"},
    {no: 40, name: "APP_BLAH_BLAH_ID"},
    {no: 50, name: "DB_NAME"},
    {no: 55, name: "DB_TABLE"},
    {no: 60, name: "DB_ROW_ID"},
    {no: 65, name: "DB_COLUMN_ID"},
    {no: 70, name: "DB_BLAH_BLAH_ID"},
    {no: 100, name: "PK_PLANET"},
    {no: 110, name: "PK_REGION"},
    {no: 120, name: "PK_SUB_REGION"},
]);

/**
 * ie PATH_TYPE tag, specific to a sequence_number_path format
 *
 * @generated from enum aircore.media.omni.v1.PathTypes
 */
export enum PathTypes {
    /**
     * @generated from enum value: UNKNOWN_PATH_TYPE = 0;
     */
    UNKNOWN_PATH_TYPE = 0,

    /**
     * @generated from enum value: SEQ_APP = 5;
     */
    SEQ_APP = 5,

    /**
     * @generated from enum value: SEQ_APP_CHAN = 10;
     */
    SEQ_APP_CHAN = 10,

    /**
     * @generated from enum value: SEQ_APP_ROOM = 15;
     */
    SEQ_APP_ROOM = 15,

    /**
     * @generated from enum value: SEQ_APP_ROOM_GROUP = 20;
     */
    SEQ_APP_ROOM_GROUP = 20,

    /**
     * ...
     *
     * @generated from enum value: ITEM_APP_CHAN_USER = 25;
     */
    ITEM_APP_CHAN_USER = 25,

    /**
     * @generated from enum value: SEQ_DB_NAME_TABLE = 30;
     */
    SEQ_DB_NAME_TABLE = 30,

    /**
     * @generated from enum value: ITEM_DB_NAME_TABLE_ROW_COLUMN = 50;
     */
    ITEM_DB_NAME_TABLE_ROW_COLUMN = 50,
}

// Retrieve enum metadata with: proto3.getEnumType(PathTypes)
proto3.util.setEnumType(PathTypes, "aircore.media.omni.v1.PathTypes", [
    {no: 0, name: "UNKNOWN_PATH_TYPE"},
    {no: 5, name: "SEQ_APP"},
    {no: 10, name: "SEQ_APP_CHAN"},
    {no: 15, name: "SEQ_APP_ROOM"},
    {no: 20, name: "SEQ_APP_ROOM_GROUP"},
    {no: 25, name: "ITEM_APP_CHAN_USER"},
    {no: 30, name: "SEQ_DB_NAME_TABLE"},
    {no: 50, name: "ITEM_DB_NAME_TABLE_ROW_COLUMN"},
]);

/**
 * @generated from enum aircore.media.omni.v1.Commands
 */
export enum Commands {
    /**
     * @generated from enum value: UNKNOWN_COMMAND = 0;
     */
    UNKNOWN_COMMAND = 0,

    /**
     * aka PUBLISH
     *
     * @generated from enum value: UPSERT = 10;
     */
    UPSERT = 10,

    /**
     * @generated from enum value: DELETE = 20;
     */
    DELETE = 20,

    /**
     * kafka client
     *
     * @generated from enum value: SUBSCRIBE = 30;
     */
    SUBSCRIBE = 30,

    /**
     * grpc request/response
     *
     * @generated from enum value: FETCH_DELTAS = 40;
     */
    FETCH_DELTAS = 40,
}

// Retrieve enum metadata with: proto3.getEnumType(Commands)
proto3.util.setEnumType(Commands, "aircore.media.omni.v1.Commands", [
    {no: 0, name: "UNKNOWN_COMMAND"},
    {no: 10, name: "UPSERT"},
    {no: 20, name: "DELETE"},
    {no: 30, name: "SUBSCRIBE"},
    {no: 40, name: "FETCH_DELTAS"},
]);

/**
 * @generated from message aircore.media.omni.v1.PathElement
 */
export class PathElement extends Message<PathElement> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.PathElement";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "tag", kind: "enum", T: proto3.getEnumType(Tags)},
        {no: 15, name: "path_type", kind: "enum", T: proto3.getEnumType(PathTypes), oneof: "x"},
        {no: 20, name: "text", kind: "scalar", T: 9 /* ScalarType.STRING */, oneof: "x"},
        {no: 30, name: "integer", kind: "scalar", T: 5 /* ScalarType.INT32 */, oneof: "x"},
        {no: 40, name: "fraction", kind: "scalar", T: 2 /* ScalarType.FLOAT */, oneof: "x"},
    ]);
    /**
     * @generated from field: aircore.media.omni.v1.Tags tag = 10;
     */
    tag = Tags.UNKNOWN_TAG;
    /**
     * @generated from oneof aircore.media.omni.v1.PathElement.x
     */
    x: {
        /**
         * @generated from field: aircore.media.omni.v1.PathTypes path_type = 15;
         */
        value: PathTypes;
        case: "pathType";
    } | {
        /**
         * @generated from field: string text = 20;
         */
        value: string;
        case: "text";
    } | {
        /**
         * @generated from field: int32 integer = 30;
         */
        value: number;
        case: "integer";
    } | {
        /**
         * @generated from field: float fraction = 40;
         */
        value: number;
        case: "fraction";
    } | { case: undefined; value?: undefined } = {case: undefined};

    constructor(data?: PartialMessage<PathElement>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): PathElement {
        return new PathElement().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): PathElement {
        return new PathElement().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): PathElement {
        return new PathElement().fromJsonString(jsonString, options);
    }

    static equals(a: PathElement | PlainMessage<PathElement> | undefined, b: PathElement | PlainMessage<PathElement> | undefined): boolean {
        return proto3.util.equals(PathElement, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.Path
 */
export class Path extends Message<Path> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.Path";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "hops", kind: "message", T: PathElement, repeated: true},
    ]);
    /**
     * first hop is always a PATH_TYPE:PathTypes.xxx
     *
     * @generated from field: repeated aircore.media.omni.v1.PathElement hops = 10;
     */
    hops: PathElement[] = [];

    constructor(data?: PartialMessage<Path>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Path {
        return new Path().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Path {
        return new Path().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Path {
        return new Path().fromJsonString(jsonString, options);
    }

    static equals(a: Path | PlainMessage<Path> | undefined, b: Path | PlainMessage<Path> | undefined): boolean {
        return proto3.util.equals(Path, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.KafkaParitionKey
 */
export class KafkaParitionKey extends Message<KafkaParitionKey> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.KafkaParitionKey";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "sequence_number_path", kind: "message", T: Path, oneof: "x"},
        {no: 20, name: "partition_integer", kind: "scalar", T: 5 /* ScalarType.INT32 */, oneof: "x"},
    ]);
    /**
     * @generated from oneof aircore.media.omni.v1.KafkaParitionKey.x
     */
    x: {
        /**
         * deterministic serialize // https://github.com/bufbuild/protobuf-es/issues/251
         *
         * @generated from field: aircore.media.omni.v1.Path sequence_number_path = 10;
         */
        value: Path;
        case: "sequenceNumberPath";
    } | {
        /**
         * @generated from field: int32 partition_integer = 20;
         */
        value: number;
        case: "partitionInteger";
    } | { case: undefined; value?: undefined } = {case: undefined};

    constructor(data?: PartialMessage<KafkaParitionKey>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): KafkaParitionKey {
        return new KafkaParitionKey().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): KafkaParitionKey {
        return new KafkaParitionKey().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): KafkaParitionKey {
        return new KafkaParitionKey().fromJsonString(jsonString, options);
    }

    static equals(a: KafkaParitionKey | PlainMessage<KafkaParitionKey> | undefined, b: KafkaParitionKey | PlainMessage<KafkaParitionKey> | undefined): boolean {
        return proto3.util.equals(KafkaParitionKey, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.KafkaKey
 */
export class KafkaKey extends Message<KafkaKey> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.KafkaKey";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 30, name: "kafka_partition_key", kind: "message", T: KafkaParitionKey},
    ]);
    /**
     * string kafka_topic = 20;
     *
     * @generated from field: aircore.media.omni.v1.KafkaParitionKey kafka_partition_key = 30;
     */
    kafkaPartitionKey?: KafkaParitionKey;

    constructor(data?: PartialMessage<KafkaKey>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): KafkaKey {
        return new KafkaKey().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): KafkaKey {
        return new KafkaKey().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): KafkaKey {
        return new KafkaKey().fromJsonString(jsonString, options);
    }

    static equals(a: KafkaKey | PlainMessage<KafkaKey> | undefined, b: KafkaKey | PlainMessage<KafkaKey> | undefined): boolean {
        return proto3.util.equals(KafkaKey, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.Coordinates
 */
export class Coordinates extends Message<Coordinates> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.Coordinates";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 40, name: "kafka_key", kind: "message", T: KafkaKey},
        {no: 50, name: "correlation_id", kind: "scalar", T: 9 /* ScalarType.STRING */},
    ]);
    /**
     * in-mem hash, redis, aurora, etc.
     *
     * @generated from field: aircore.media.omni.v1.KafkaKey kafka_key = 40;
     */
    kafkaKey?: KafkaKey;
    /**
     * @generated from field: string correlation_id = 50;
     */
    correlationId = "";

    constructor(data?: PartialMessage<Coordinates>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Coordinates {
        return new Coordinates().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Coordinates {
        return new Coordinates().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Coordinates {
        return new Coordinates().fromJsonString(jsonString, options);
    }

    static equals(a: Coordinates | PlainMessage<Coordinates> | undefined, b: Coordinates | PlainMessage<Coordinates> | undefined): boolean {
        return proto3.util.equals(Coordinates, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.Sequencing
 */
export class Sequencing extends Message<Sequencing> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.Sequencing";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "epoc", kind: "message", T: Timestamp},
        {no: 20, name: "sequence_number", kind: "scalar", T: 3 /* ScalarType.INT64 */},
    ]);
    /**
     * @generated from field: google.protobuf.Timestamp epoc = 10;
     */
    epoc?: Timestamp;
    /**
     * @generated from field: int64 sequence_number = 20;
     */
    sequenceNumber = protoInt64.zero;

    constructor(data?: PartialMessage<Sequencing>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Sequencing {
        return new Sequencing().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Sequencing {
        return new Sequencing().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Sequencing {
        return new Sequencing().fromJsonString(jsonString, options);
    }

    static equals(a: Sequencing | PlainMessage<Sequencing> | undefined, b: Sequencing | PlainMessage<Sequencing> | undefined): boolean {
        return proto3.util.equals(Sequencing, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.Payload
 */
export class Payload extends Message<Payload> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.Payload";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 50, name: "buffer", kind: "scalar", T: 12 /* ScalarType.BYTES */, oneof: "x"},
        {no: 60, name: "text", kind: "scalar", T: 9 /* ScalarType.STRING */, oneof: "x"},
        {no: 70, name: "val", kind: "message", T: Any, oneof: "x"},
        {no: 90, name: "sequencing", kind: "message", T: Sequencing},
        {no: 100, name: "item_path", kind: "message", T: Path},
    ]);
    /**
     * @generated from oneof aircore.media.omni.v1.Payload.x
     */
    x: {
        /**
         * @generated from field: bytes buffer = 50;
         */
        value: Uint8Array;
        case: "buffer";
    } | {
        /**
         * @generated from field: string text = 60;
         */
        value: string;
        case: "text";
    } | {
        /**
         * @generated from field: google.protobuf.Any val = 70;
         */
        value: Any;
        case: "val";
    } | { case: undefined; value?: undefined } = {case: undefined};
    /**
     * @generated from field: aircore.media.omni.v1.Sequencing sequencing = 90;
     */
    sequencing?: Sequencing;
    /**
     * @generated from field: aircore.media.omni.v1.Path item_path = 100;
     */
    itemPath?: Path;

    constructor(data?: PartialMessage<Payload>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Payload {
        return new Payload().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Payload {
        return new Payload().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Payload {
        return new Payload().fromJsonString(jsonString, options);
    }

    static equals(a: Payload | PlainMessage<Payload> | undefined, b: Payload | PlainMessage<Payload> | undefined): boolean {
        return proto3.util.equals(Payload, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.AirCoreFrame
 */
export class AirCoreFrame extends Message<AirCoreFrame> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.AirCoreFrame";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "command", kind: "enum", T: proto3.getEnumType(Commands)},
        {no: 20, name: "send_to", kind: "message", T: Coordinates},
        {no: 30, name: "reply_to", kind: "message", T: Coordinates},
        {no: 50, name: "payloads", kind: "message", T: Payload, repeated: true},
    ]);
    /**
     * @generated from field: aircore.media.omni.v1.Commands command = 10;
     */
    command = Commands.UNKNOWN_COMMAND;
    /**
     * global addressing
     *
     * @generated from field: aircore.media.omni.v1.Coordinates send_to = 20;
     */
    sendTo?: Coordinates;
    /**
     * correlation of response(s) 1:1, 1:n
     *
     * @generated from field: aircore.media.omni.v1.Coordinates reply_to = 30;
     */
    replyTo?: Coordinates;
    /**
     * the value, scalar, blob, etc.
     *
     * @generated from field: repeated aircore.media.omni.v1.Payload payloads = 50;
     */
    payloads: Payload[] = [];

    constructor(data?: PartialMessage<AirCoreFrame>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): AirCoreFrame {
        return new AirCoreFrame().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): AirCoreFrame {
        return new AirCoreFrame().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): AirCoreFrame {
        return new AirCoreFrame().fromJsonString(jsonString, options);
    }

    static equals(a: AirCoreFrame | PlainMessage<AirCoreFrame> | undefined, b: AirCoreFrame | PlainMessage<AirCoreFrame> | undefined): boolean {
        return proto3.util.equals(AirCoreFrame, a, b);
    }
}

/**
 * / in-mem tracking data structures
 *
 * @generated from message aircore.media.omni.v1.Subscriptions
 */
export class Subscriptions extends Message<Subscriptions> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.Subscriptions";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "callbacks", kind: "map", K: 9 /* ScalarType.STRING */, V: {kind: "message", T: KafkaKey}},
    ]);
    /**
     * @generated from field: map<string, aircore.media.omni.v1.KafkaKey> callbacks = 10;
     */
    callbacks: { [key: string]: KafkaKey } = {};

    constructor(data?: PartialMessage<Subscriptions>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Subscriptions {
        return new Subscriptions().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Subscriptions {
        return new Subscriptions().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Subscriptions {
        return new Subscriptions().fromJsonString(jsonString, options);
    }

    static equals(a: Subscriptions | PlainMessage<Subscriptions> | undefined, b: Subscriptions | PlainMessage<Subscriptions> | undefined): boolean {
        return proto3.util.equals(Subscriptions, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.UpsertRequest
 */
export class UpsertRequest extends Message<UpsertRequest> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.UpsertRequest";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "sequence_number_path", kind: "message", T: Path},
        {no: 30, name: "payload", kind: "message", T: Payload},
    ]);
    /**
     * @generated from field: aircore.media.omni.v1.Path sequence_number_path = 10;
     */
    sequenceNumberPath?: Path;
    /**
     * @generated from field: aircore.media.omni.v1.Payload payload = 30;
     */
    payload?: Payload;

    constructor(data?: PartialMessage<UpsertRequest>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpsertRequest {
        return new UpsertRequest().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpsertRequest {
        return new UpsertRequest().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpsertRequest {
        return new UpsertRequest().fromJsonString(jsonString, options);
    }

    static equals(a: UpsertRequest | PlainMessage<UpsertRequest> | undefined, b: UpsertRequest | PlainMessage<UpsertRequest> | undefined): boolean {
        return proto3.util.equals(UpsertRequest, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.DelayedUpsertRequest
 */
export class DelayedUpsertRequest extends Message<DelayedUpsertRequest> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.DelayedUpsertRequest";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "sequence_number_path", kind: "message", T: Path},
        {no: 30, name: "inital", kind: "message", T: Payload},
        {no: 40, name: "delayed", kind: "message", T: Payload},
    ]);
    /**
     * @generated from field: aircore.media.omni.v1.Path sequence_number_path = 10;
     */
    sequenceNumberPath?: Path;
    /**
     * @generated from field: aircore.media.omni.v1.Payload inital = 30;
     */
    inital?: Payload;
    /**
     * timeout is system setting
     *
     * @generated from field: aircore.media.omni.v1.Payload delayed = 40;
     */
    delayed?: Payload;

    constructor(data?: PartialMessage<DelayedUpsertRequest>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DelayedUpsertRequest {
        return new DelayedUpsertRequest().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DelayedUpsertRequest {
        return new DelayedUpsertRequest().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DelayedUpsertRequest {
        return new DelayedUpsertRequest().fromJsonString(jsonString, options);
    }

    static equals(a: DelayedUpsertRequest | PlainMessage<DelayedUpsertRequest> | undefined, b: DelayedUpsertRequest | PlainMessage<DelayedUpsertRequest> | undefined): boolean {
        return proto3.util.equals(DelayedUpsertRequest, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.DelayedUpsertResponse
 */
export class DelayedUpsertResponse extends Message<DelayedUpsertResponse> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.DelayedUpsertResponse";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "heartbeat_id", kind: "scalar", T: 9 /* ScalarType.STRING */},
    ]);
    /**
     * @generated from field: string heartbeat_id = 10;
     */
    heartbeatId = "";

    constructor(data?: PartialMessage<DelayedUpsertResponse>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DelayedUpsertResponse {
        return new DelayedUpsertResponse().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DelayedUpsertResponse {
        return new DelayedUpsertResponse().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DelayedUpsertResponse {
        return new DelayedUpsertResponse().fromJsonString(jsonString, options);
    }

    static equals(a: DelayedUpsertResponse | PlainMessage<DelayedUpsertResponse> | undefined, b: DelayedUpsertResponse | PlainMessage<DelayedUpsertResponse> | undefined): boolean {
        return proto3.util.equals(DelayedUpsertResponse, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.KeepAlives
 */
export class KeepAlives extends Message<KeepAlives> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.KeepAlives";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "keep_alives", kind: "message", T: DelayedUpsertResponse, repeated: true},
    ]);
    /**
     * @generated from field: repeated aircore.media.omni.v1.DelayedUpsertResponse keep_alives = 10;
     */
    keepAlives: DelayedUpsertResponse[] = [];

    constructor(data?: PartialMessage<KeepAlives>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): KeepAlives {
        return new KeepAlives().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): KeepAlives {
        return new KeepAlives().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): KeepAlives {
        return new KeepAlives().fromJsonString(jsonString, options);
    }

    static equals(a: KeepAlives | PlainMessage<KeepAlives> | undefined, b: KeepAlives | PlainMessage<KeepAlives> | undefined): boolean {
        return proto3.util.equals(KeepAlives, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.GetSnapshotResponse
 */
export class GetSnapshotResponse extends Message<GetSnapshotResponse> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.GetSnapshotResponse";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "payloads", kind: "message", T: Payload, repeated: true},
        {no: 20, name: "deltas_start_sequence_number", kind: "scalar", T: 3 /* ScalarType.INT64 */},
    ]);
    /**
     * map<item_path, payload>
     *
     * @generated from field: repeated aircore.media.omni.v1.Payload payloads = 10;
     */
    payloads: Payload[] = [];
    /**
     * @generated from field: int64 deltas_start_sequence_number = 20;
     */
    deltasStartSequenceNumber = protoInt64.zero;

    constructor(data?: PartialMessage<GetSnapshotResponse>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetSnapshotResponse {
        return new GetSnapshotResponse().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetSnapshotResponse {
        return new GetSnapshotResponse().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetSnapshotResponse {
        return new GetSnapshotResponse().fromJsonString(jsonString, options);
    }

    static equals(a: GetSnapshotResponse | PlainMessage<GetSnapshotResponse> | undefined, b: GetSnapshotResponse | PlainMessage<GetSnapshotResponse> | undefined): boolean {
        return proto3.util.equals(GetSnapshotResponse, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.GetDeltasRequest
 */
export class GetDeltasRequest extends Message<GetDeltasRequest> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.GetDeltasRequest";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "sequence_number_path", kind: "message", T: Path},
        {no: 20, name: "sequence_number", kind: "scalar", T: 3 /* ScalarType.INT64 */},
    ]);
    /**
     * @generated from field: aircore.media.omni.v1.Path sequence_number_path = 10;
     */
    sequenceNumberPath?: Path;
    /**
     * @generated from field: int64 sequence_number = 20;
     */
    sequenceNumber = protoInt64.zero;

    constructor(data?: PartialMessage<GetDeltasRequest>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetDeltasRequest {
        return new GetDeltasRequest().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetDeltasRequest {
        return new GetDeltasRequest().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetDeltasRequest {
        return new GetDeltasRequest().fromJsonString(jsonString, options);
    }

    static equals(a: GetDeltasRequest | PlainMessage<GetDeltasRequest> | undefined, b: GetDeltasRequest | PlainMessage<GetDeltasRequest> | undefined): boolean {
        return proto3.util.equals(GetDeltasRequest, a, b);
    }
}

/**
 * @generated from message aircore.media.omni.v1.GetDeltasResponse
 */
export class GetDeltasResponse extends Message<GetDeltasResponse> {
    static readonly runtime = proto3;
    static readonly typeName = "aircore.media.omni.v1.GetDeltasResponse";
    static readonly fields: FieldList = proto3.util.newFieldList(() => [
        {no: 10, name: "payloads", kind: "message", T: Payload, repeated: true},
    ]);
    /**
     * @generated from field: repeated aircore.media.omni.v1.Payload payloads = 10;
     */
    payloads: Payload[] = [];

    constructor(data?: PartialMessage<GetDeltasResponse>) {
        super();
        proto3.util.initPartial(data, this);
    }

    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetDeltasResponse {
        return new GetDeltasResponse().fromBinary(bytes, options);
    }

    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetDeltasResponse {
        return new GetDeltasResponse().fromJson(jsonValue, options);
    }

    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetDeltasResponse {
        return new GetDeltasResponse().fromJsonString(jsonString, options);
    }

    static equals(a: GetDeltasResponse | PlainMessage<GetDeltasResponse> | undefined, b: GetDeltasResponse | PlainMessage<GetDeltasResponse> | undefined): boolean {
        return proto3.util.equals(GetDeltasResponse, a, b);
    }
}


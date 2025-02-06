import { ServiceImpl } from "@bufbuild/connect";
import { Omni } from "../../proto/gen/devinternal_connect";
import {
    AirCoreFrame,
    Commands,
    DelayedUpsertRequest,
    DelayedUpsertResponse,
    GetDeltasRequest,
    GetDeltasResponse,
    GetSnapshotResponse,
    KeepAlives,
    Path,
    Payload,
    UpsertRequest,
} from "../../proto/gen/devinternal_pb";
import { Empty } from "@bufbuild/protobuf";
import { AsyncDisposableStack } from "@esfx/disposable";
import { Deferred } from "@esfx/async";
import { anydb } from "../common2/redis/anydb";
import { pubsub } from "../easy_pubsub/pubsub";
import { createClient } from "redis";
import { config } from "../config";
import crypto from "crypto";
import { prettySpaces } from "../common2/constants";

// Custom error class
class MissingFieldError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MissingFieldError";
    }
}

// Implementing the Omni service with the following methods:
// - create
// - publish
// - getSnapshot
// - getDeltas
// - publishWithTimeout
// - publishWithTimeoutHeartbeats
// - ping
export class OmniImpl implements ServiceImpl<typeof Omni> {
    // Private constructor for the class
    private constructor(
        private readonly config_: config,
        private readonly disposable_stack: AsyncDisposableStack,
        private readonly shutdown: Deferred<boolean>,
        private readonly anydb_: anydb,
        private readonly pubsub_: pubsub,
    ) {}

    // Static method to create an instance of OmniImpl, requires config, disposable_stack, and shutdown parameters
    public static async create(
        config_: config,
        disposable_stack: AsyncDisposableStack,
        shutdown: Deferred<boolean>,
    ): Promise<OmniImpl> {
        const anydb_ = await anydb.create(createClient({ url: config_.easy_pubsub.get_redis_uri() }));
        disposable_stack.use(anydb_);
        const pubsub_ = await pubsub.create(config_);
        disposable_stack.use(pubsub_);
        const omni = new OmniImpl(config_, disposable_stack, shutdown, anydb_, pubsub_);
        return omni;
    }

    // publish() method takes an UpsertRequest, sends it to the pubsub system, and returns an Empty response
    async publish(request: UpsertRequest): Promise<Empty> {
        if (!request.sequenceNumberPath) throw new MissingFieldError(`missing request.sequenceNumberPath`);
        if (!request.payload) throw new MissingFieldError(`missing request.payload`);
        if (!request.payload.itemPath) throw new MissingFieldError(`missing request.payload.itemPath`)
        const frame = new AirCoreFrame({
            command: Commands.UPSERT,
            sendTo: {
                kafkaKey: {
                    kafkaPartitionKey: {
                        x: {
                            case: "sequenceNumberPath",
                            value: request.sequenceNumberPath,
                        },
                    },
                },
            },
            payloads: [request.payload.clone()],
        });
        await this.pubsub_.publish(frame);
        return new Empty();
    }

    // getSnapshot() method retrieves snapshot data from anydb for a given sequence_number_path
    async getSnapshot(sequence_number_path: Path): Promise<GetSnapshotResponse> {
        const result = await this.anydb_.fetch_snapshot(sequence_number_path);
        const payloads = new Array<Payload>();
        let deltasStartSequenceNumber = BigInt(0);
        for (const item of result) {
            payloads.push(item.payload);
            if (!item.payload.sequencing?.sequenceNumber) throw new MissingFieldError(`missing item.payload.sequencing?.sequenceNumber`);
            const sequenceNumber = item.payload.sequencing.sequenceNumber;
            if (sequenceNumber > deltasStartSequenceNumber) deltasStartSequenceNumber = sequenceNumber;
        }
        deltasStartSequenceNumber++;
        return new GetSnapshotResponse({
            payloads,
            deltasStartSequenceNumber,
        });
    }

    // getDeltas() method fetches deltas for the given sequence_number_path and sequence number
    async getDeltas(request: GetDeltasRequest): Promise<GetDeltasResponse> {
        if (!request.sequenceNumberPath) throw new MissingFieldError(`missing request.sequenceNumberPath`);
        if (!request.sequenceNumber) throw new MissingFieldError(`missing request.sequenceNumber`);
        const payloads = await this.anydb_.fetch_deltas(request.sequenceNumberPath, request.sequenceNumber);
        const response = new GetDeltasResponse({
            payloads,
        });
        return response;
    }

    // publishWithTimeout() method sends an UpsertRequest with a timeout for a delayed UpsertRequest
    async publishWithTimeout(request: DelayedUpsertRequest): Promise<DelayedUpsertResponse> {
        if (!request.sequenceNumberPath) throw new MissingFieldError(`missing request.sequenceNumberPath`);
        if (!request.inital) throw new MissingFieldError(`missing request.initial`);
        if (!request.inital.itemPath) throw new MissingFieldError(`missing request.initial.itemPath`)
        if (!request.delayed) throw new MissingFieldError(`missing request.delayed`);
        if (!request.delayed.itemPath) throw new MissingFieldError(`missing request.delayed.itemPath`)
        if (!request.delayed.itemPath.equals(request.inital.itemPath)) throw new Error(`delayed.itemPath != initial.itemPath`);
        const heartbeat_id = crypto.randomUUID();
        const frame = new AirCoreFrame({
            command: Commands.UPSERT,
            sendTo: {
                kafkaKey: {
                    kafkaPartitionKey: {
                        x: {
                            case: "sequenceNumberPath",
                            value: request.sequenceNumberPath,
                        },
                    },
                },
            },
            payloads: [request.inital.clone()],
            timeoutPayloads: [request.delayed.clone()],
            heartbeatId: heartbeat_id,
        });
        await this.pubsub_.publish(frame);
        return new DelayedUpsertResponse({
            heartbeatId: heartbeat_id,
            sequenceNumberPath: request.sequenceNumberPath.clone(),
            itemPath: request.inital.itemPath.clone(),
        });
    }

    // publishWithTimeoutHeartbeats() method is used to keep timeout heartbeats alive by republishing AirCoreFrames
    async publishWithTimeoutHeartbeats(request: KeepAlives): Promise<Empty> {
        for (const keep_alive of request.keepAlives) {
            if (!keep_alive.sequenceNumberPath) throw new MissingFieldError(`missing keep_alive.sequenceNumberPath`);
            const frame = new AirCoreFrame({
                command: Commands.KEEP_ALIVE,
                sendTo: {
                    kafkaKey: {
                        kafkaPartitionKey: {
                            x: {
                                case: "sequenceNumberPath",
                                value: keep_alive.sequenceNumberPath?.clone(),
                            },
                        },
                    },
                },
                timeoutPayloads: [{ itemPath: keep_alive.itemPath?.clone() }],
                heartbeatId: keep_alive.heartbeatId,
            });
            await this.pubsub_.publish(frame);
        }
        return new Empty();
    }

    // ping() method, sends an empty request and gets an empty response in return
    async ping(request: Empty): Promise<Empty> {
        return new Empty();
    }
}

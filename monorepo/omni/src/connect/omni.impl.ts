import {ServiceImpl} from "@bufbuild/connect";
import {Omni} from "../../proto/gen/devinternal_connect";
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
    UpsertRequest
} from "../../proto/gen/devinternal_pb";
import {Empty} from "@bufbuild/protobuf";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Deferred} from "@esfx/async";
import {anydb} from "../common/redis/anydb";
import {pubsub} from "../easy/pubsub";
import {createClient} from "redis";
import {config} from "../config_easy";

export class OmniImpl implements ServiceImpl<typeof Omni> {
    private constructor(
        private readonly config_: config,
        private readonly disposable_stack: AsyncDisposableStack,
        private readonly shutdown: Deferred<boolean>,
        private readonly anydb_: anydb,
        private readonly pubsub_: pubsub,
    ) {
    }

    public static async create(config_: config, disposable_stack: AsyncDisposableStack, shutdown: Deferred<boolean>) {
        const anydb_ = await anydb.create(createClient({url: config_.easy_pubsub.get_redis_uri()}));
        disposable_stack.use(anydb_);
        const pubsub_ = await pubsub.create(config_);
        disposable_stack.use(pubsub_);
        const omni = new OmniImpl(config_, disposable_stack, shutdown, anydb_, pubsub_);
        return omni;
    }

    async upsert(request: UpsertRequest) {
        if (!request.sequenceNumberPath) throw new Error(`missing request.sequenceNumberPath`);
        if (!request.payload) throw new Error(`missing request.payload`);
        if (!request.payload.itemPath) throw new Error(`missing request.payload.itemPath`)
        const frame = new AirCoreFrame({
            command: Commands.UPSERT,
            sendTo: {
                kafkaKey: {
                    kafkaPartitionKey: {
                        x: {
                            case: "sequenceNumberPath",
                            value: request.sequenceNumberPath,
                        }
                    }
                }
            },
            payloads: [request.payload.clone()]
        });
        //console.log(`omni.upsert: `, frame.toJsonString({prettySpaces}));
        await this.pubsub_.publish(frame);
        return new Empty();
    }

    async getSnapshot(sequence_number_path: Path) {
        const result = await this.anydb_.fetch_snapshot(sequence_number_path);
        const payloads = new Array<Payload>();
        let deltasStartSequenceNumber = BigInt(0);
        for (const item of result) {
            payloads.push(item.payload);
            if (!item.payload.sequencing?.sequenceNumber) throw new Error(`missing item.payload.sequencing?.sequenceNumber`);
            const sequenceNumber = item.payload.sequencing.sequenceNumber;
            if (sequenceNumber > deltasStartSequenceNumber) deltasStartSequenceNumber = sequenceNumber;
        }
        deltasStartSequenceNumber++;
        //console.log(`omni.getSnapshot: `, payloads);
        return new GetSnapshotResponse({
            payloads,
            deltasStartSequenceNumber,
        });
    }

    async getDeltas(request: GetDeltasRequest) {
        if (!request.sequenceNumberPath) throw new Error(`missing request.sequenceNumberPath`);
        if (!request.sequenceNumber) throw new Error(`missing request.sequenceNumber`);
        const payloads = await this.anydb_.fetch_deltas(request.sequenceNumberPath, request.sequenceNumber);
        return new GetDeltasResponse({
            payloads,
        });
    }

    async delayedUpsert(request: DelayedUpsertRequest) {
        // todo
        return new DelayedUpsertResponse();
    }

    async delayedUpsertKeepAlives(request: KeepAlives) {
        return new Empty();
    }

    async ping(request: Empty) {
        return new Empty();
    }
}

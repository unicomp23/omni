import {ServiceImpl} from "@bufbuild/connect";
import {Omni} from "../../proto/gen/devinternal_connect";
import {
    AirCoreFrame,
    Commands,
    GetDeltasRequest,
    GetDeltasResponse,
    GetSnapshotResponse,
    Path, Payload,
    UpsertRequest
} from "../../proto/gen/devinternal_pb";
import {Empty} from "@bufbuild/protobuf";
import {config} from "../config";
import {AsyncDisposableStack} from "@esfx/disposable";
import {Deferred} from "@esfx/async";
import {anydb} from "../common/redis/anydb";
import {pubsub} from "../easy/pubsub";
import {createClient} from "redis";

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
        const anydb_ = await anydb.create(createClient({url: config_.get_redis_uri()}));
        disposable_stack.use(anydb_);
        const pubsub_ = await pubsub.create(config_);
        disposable_stack.use(pubsub_);
        const omni = new OmniImpl(config_, disposable_stack, shutdown, anydb_, pubsub_);
        return omni;
    }

    async upsert(request: UpsertRequest) {
        if(!request.sequenceNumberPath) throw new Error(`missing request.sequenceNumberPath`);
        if(!request.payload) throw new Error(`missing request.payload`);
        await this.pubsub_.publish(new AirCoreFrame({
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
        }));
        return new Empty();
    }

    async getSnapshot(sequence_number_path: Path) {
        const result = await this.anydb_.fetch_snapshot(sequence_number_path);
        const payloads = new Array<Payload>();
        for(const item of result)
            payloads.push(item.payload);
        return new GetSnapshotResponse({
            payloads,
        });
    }

    async getDeltas(request: GetDeltasRequest) {
        if(!request.sequenceNumberPath) throw new Error(`missing request.sequenceNumberPath`);
        if(!request.sequenceNumber) throw new Error(`missing request.sequenceNumber`);
        const payloads = await this.anydb_.fetch_deltas(request.sequenceNumberPath, request.sequenceNumber);
        return new GetDeltasResponse({
            payloads,
        });
    }
}

import {ServiceImpl} from "@bufbuild/connect";
import {Omni} from "../../proto/gen/devinternal_connect";
import {
    GetDeltasRequest,
    GetDeltasResponse,
    GetSnapshotResponse,
    Path,
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
        console.log(`got upsert request`);
        return new Empty();
    }

    async getSnapshot(sequence_number_path: Path) {
        return new GetSnapshotResponse();
    }

    async getDeltas(request: GetDeltasRequest) {
        return new GetDeltasResponse();
    }
}

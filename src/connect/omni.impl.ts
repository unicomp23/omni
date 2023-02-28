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

export class OmniImpl implements ServiceImpl<typeof Omni> {
    async upsert(request: UpsertRequest) {
        return new Empty();
    }

    async getSnapshot(path: Path) {
        return new GetSnapshotResponse();
    }

    async getDeltas(request: GetDeltasRequest) {
        return new GetDeltasResponse();
    }
}

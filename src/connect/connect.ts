import {ConnectRouter, ServiceImpl} from "@bufbuild/connect";
import {Omni} from "../../proto/gen/devinternal_connect";
import {
    GetDeltasRequest,
    GetDeltasResponse,
    GetSnapshotResponse,
    Path,
    UpsertRequest
} from "../../proto/gen/devinternal_pb";
import {Empty} from "@bufbuild/protobuf";

export default (router: ConnectRouter) => {
    return router.service(Omni, {
        async upsert(request: UpsertRequest) {
            return new Empty();
        },
        async getSnapshot(path: Path) {
            return new GetSnapshotResponse();
        },
        getDeltas: async (request: GetDeltasRequest) => {
            return new GetDeltasResponse();
        },
    } as unknown as ServiceImpl<typeof Omni>);
};

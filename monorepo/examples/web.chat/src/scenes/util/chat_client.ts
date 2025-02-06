import {createConnectTransport, createPromiseClient} from "@bufbuild/connect-web";
import {Omni} from "../../../proto/gen/devinternal_connect";
import {
    GetDeltasRequest,
    GetDeltasResponse,
    Path,
    PathTypes,
    Payload,
    Tags,
    UpsertRequest
} from "../../../proto/gen/devinternal_pb";
import {protoBase64, Timestamp} from "@bufbuild/protobuf";

export class chat_client {
    private constructor(
        public readonly app_id: string,
        public readonly channel_id: string,
        public user_id: string,
        private readonly transport = createConnectTransport({
            baseUrl: `https://${location.host}/`,
            useBinaryFormat: false,
        }),
        private readonly client = createPromiseClient(Omni, transport),
    ) {
        this.taskRunSubscription = this.run_subscription()
    }

    private readonly taskRunSubscription: Promise<void>;
    
    public static create(app_id: string, channel_id: string, user_id: string) {
        return new chat_client(app_id, channel_id, user_id);
    }

    private make_paths(app_id: string, channel_id: string, user_id: string) {
        return {
            sequenceNumberPath: new Path({
                hops: [
                    {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.SEQ_APP_CHAN}},
                    {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
                    {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: channel_id}},
                ]
            }),
            itemPath: new Path({
                hops: [
                    {tag: Tags.PATH_TYPE, x: {case: "pathType", value: PathTypes.ITEM_APP_CHAN_USER}},
                    {tag: Tags.APP_ID, x: {case: "text", value: app_id}},
                    {tag: Tags.APP_CHANNEL_ID, x: {case: "text", value: channel_id}},

                    {tag: Tags.APP_USER_ID, x: {case: "text", value: "678"}},
                ]
            })
        };
    }

    public async publish(app_id: string, channel_id: string, user_id: string, chat_message: string) {
        const paths = this.make_paths(this.app_id, this.channel_id, this.user_id);
        try {
            await this.client.publish(new UpsertRequest({
                payload: {
                    itemPath: paths.itemPath,
                    x: {
                        case: "text",
                        value: chat_message,
                    },
                    sequencing: {
                        epoc: Timestamp.now(),
                        sequenceNumber: BigInt(0)
                    }
                },
                sequenceNumberPath: paths.sequenceNumberPath,
            })); // todo
        } catch (e) {
            console.log(`error, omni.upsert`, e);
        }
    }

    private async run_subscription() {
        const paths = this.make_paths(this.app_id, this.channel_id, this.user_id);
        const snapshot = await this.client.getSnapshot(paths.sequenceNumberPath);
        for (const payload of snapshot.payloads) {
            if (payload.itemPath) {
                const key = protoBase64.enc(payload.itemPath.toBinary());
                console.log(`snapshot: `, payload.toJsonString({prettySpaces: 2}));
                this.snapshot.set(key, payload);
            }
        }
        let nextSequenceNumber: bigint | undefined = BigInt(0);
        nextSequenceNumber = snapshot.deltasStartSequenceNumber;
        while (nextSequenceNumber) {
            const delta: GetDeltasResponse = await this.client.getDeltas(new GetDeltasRequest({
                sequenceNumberPath: paths.sequenceNumberPath,
                sequenceNumber: nextSequenceNumber,
            }));
            const payload = delta.payloads.at(0);
            if (!payload?.itemPath) continue;
            const key = protoBase64.enc(payload.itemPath.toBinary());
            console.log(`delta: `, payload.toJsonString({prettySpaces: 2}));
            this.snapshot.set(key, payload);
            const nextSequenceNumber_ = delta.payloads.at(0)?.sequencing?.sequenceNumber;
            if (!nextSequenceNumber_) continue;
            nextSequenceNumber = nextSequenceNumber_;
        }
    }

    public readonly snapshot = new Map<string/*Path*/, Payload>();
}
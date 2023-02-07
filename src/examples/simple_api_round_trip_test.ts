import {DisposableStack} from "@esfx/disposable";
import {worker} from "../easy/worker";
import {config} from "../config";
import {Commands, DbSnapshot, Subscriptions} from "../../proto/generated/devinternal_pb";
import {Deferred} from "@esfx/async";
import {pubsub} from "../easy/pubsub";

const main = async() => {
    const stack = new DisposableStack();
    try {
        const config_ = config.create();
        const db_snapshot = new DbSnapshot();
        const subscriptions = new Subscriptions();
        const quit = new Deferred<boolean>();

        stack.use(new worker(config_, async(stream) => {
            for(;;) {
                const frame = await stream.get();
                switch(frame.command) {
                    case Commands.SUBSCRIBE:
                        const correlationId = frame.replyTo?.correlationId;
                        const dbKey = frame.sendTo?.dbKey;
                        if(correlationId && dbKey) {
                            subscriptions.callbacks[correlationId] = dbKey;
                            // todo, send snapshot
                        } else throw new Error(`missing correlationId or dbKey`);
                        break;
                    case Commands.UPSERT:
                        const buffer = frame.sendTo?.dbKey?.path?.toBinary();
                        const payload = frame.payload;
                        if(buffer && payload) {
                            db_snapshot.entries[Buffer.from(buffer).toString("base64")] = payload;
                        } else throw new Error(`missing buffer or payload`);
                        break;
                    default:
                        throw new Error(`unhandled: ${Commands[frame.command].toString()}`);
                }
            }
            return true;
        }));

        const pubsub_ = await pubsub.create(config_);
        stack.use(pubsub_);

        await quit.promise;
    } finally {
        stack.dispose();
    }
}
main().then(() => { console.log("exit main"); });

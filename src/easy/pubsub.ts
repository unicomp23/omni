import {config} from "../config";
import {publisher} from "../kafka/publisher";
import {reply_to_subscriber} from "../kafka/reply_to_subscriber";
import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame} from "../../proto/generated/devinternal_pb";

export class pubsub {
    private constructor(
        private readonly config_: config,
        private readonly publisher_ = publisher.create(config_),
        private readonly reply_to_subscriber_ = reply_to_subscriber.create(config_),
    ) {
    }
    public static create(config_: config) {
        return new pubsub(config_);
    }
    public async publish(frame: AirCoreFrame) {
        // todo
    }
    public async subscribe(frame: AirCoreFrame): Promise<AsyncQueue<AirCoreFrame>> {
        // todo
        return new AsyncQueue<AirCoreFrame>();
    }
    private async request_response(frame: AirCoreFrame): Promise<AirCoreFrame> {
        // todo
        return new AirCoreFrame();
    }
}

import {config} from "./common";

export class reply_to_subscriber {
    private constructor(
        private readonly config_ = config.create(),
        readonly topic = config_.get_reply_to_topic()
    ) {
    }

    public static create() {
        return new reply_to_subscriber();
    }
}
import {config} from "./common";

class worker_subscriber {
    private constructor(
        private readonly config_ = config.create(),
        readonly topic = config_.get_worker_topic()
    ) {
    }

    public static create() {
        return new worker_subscriber();
    }
}

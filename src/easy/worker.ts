import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame} from "../../proto/generated/devinternal_pb";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";
import {Disposable, DisposableStack} from "@esfx/disposable";

export class worker {
    constructor(
        private readonly config_: config,
        private readonly run_worker: (stream: AsyncQueue<AirCoreFrame>) => Promise<boolean>,
    ) {
        this.worker_subscriber_ = worker_subscriber.create(config_);
        this.stack.use(this.worker_subscriber_);
    }
    private readonly stack = new DisposableStack();
    private readonly worker_subscriber_: worker_subscriber;

    [Disposable.dispose]() {
        this.stack.dispose();
    }
}
import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame} from "../../proto/generated/devinternal_pb";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";
import {Disposable, DisposableStack} from "@esfx/disposable";
import {publisher} from "../kafka/publisher";

export class worker {
    constructor(
        private readonly config_: config,
        private readonly run_worker: (stream: AsyncQueue<AirCoreFrame>, publisher_: publisher) => Promise<boolean>,
    ) {
        this.worker_subscriber_ = worker_subscriber.create(config_);
        this.worker_publisher_ = publisher.create(config_);
        this.disposable_stack.use(this.worker_subscriber_);
        this.run_worker(this.worker_subscriber_.frames, this.worker_publisher_).then(() => { console.log(`worker.run_worker.exit`); });
    }
    private readonly disposable_stack = new DisposableStack();
    private readonly worker_subscriber_: worker_subscriber;
    private readonly worker_publisher_: publisher;

    [Disposable.dispose]() {
        this.disposable_stack.dispose();
    }
}

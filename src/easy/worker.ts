import {AsyncQueue} from "@esfx/async";
import {AirCoreFrame} from "../../proto/generated/devinternal_pb";
import {worker_subscriber} from "../kafka/worker_subscriber";
import {config} from "../config";

export class worker {
    constructor(
        private readonly config_: config,
        private readonly run_worker: (stream: AsyncQueue<AirCoreFrame>) => Promise<boolean> | null,
        private readonly worker_subscriber_ = run_worker != null ? worker_subscriber.create(config_) : null,
    ) {
    }
}

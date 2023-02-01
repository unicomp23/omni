import {Kafka} from "kafkajs";
import {config} from "./common";

export class publisher {
    private constructor(
        private readonly config_ = config.create(),
        private readonly topic = config_.get_worker_topic(),
    ) {
        const kafka = new Kafka({
            clientId: 'my-app',
            brokers: ['kafka1:9092', 'kafka2:9092']
        })
    }

    public static create() {
        return new publisher();
    }
}
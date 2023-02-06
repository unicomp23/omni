import {Kafka, Partitioners, ProducerRecord} from "kafkajs";
import {config} from "../config";
import * as crypto from "crypto";
import {AirCoreFrame, DbKey, KafkaParitionKey, Path, PlanetKey} from "../../proto/generated/devinternal_pb";
import {Disposable} from "@esfx/disposable";

export enum topic_type {
    unknown,
    worker,
    reply_to,
}

export class publisher {
    private readonly topic_worker: string;
    private readonly topic_reply_to: string;

    private constructor(
        private readonly config_: config,
        private readonly kafka = new Kafka({
            clientId: config_.get_app_id() + '/' + crypto.randomUUID(),
            brokers: config_.get_kafka_brokers()
        }),
        private readonly producer = kafka.producer({
            allowAutoTopicCreation: true,
            createPartitioner: Partitioners.DefaultPartitioner,
        })
    ){
        this.topic_worker = config_.get_worker_topic();
        this.topic_reply_to = config_.get_reply_to_topic();
    }

    private connected = false;

    public get_topic(topic_type_: topic_type) {
        switch (topic_type_) {
            case topic_type.reply_to:
                return this.topic_reply_to;
            case topic_type.worker:
                return this.topic_worker;
            default:
                throw new Error(`unhandled topic_type: ${topic_type_}`);
        }
    }

    public async send(topic_type_: topic_type, frame: AirCoreFrame) {
        console.log("send");
        if(!this.connected) {
            await this.producer.connect();
            console.log("send.connect")
            this.connected = true;
        }
        const send_to = frame.sendTo;
        const topic = this.get_topic(topic_type_);
        if(send_to) {
            if(!send_to.dbKey) send_to.dbKey = new DbKey();
            send_to.dbKey.kafkaTopic = topic;
            const partitioning = send_to.dbKey.kafkaPartitionKey?.partitioning;
            if(partitioning) {
                const record = {
                    topic: topic,
                    messages: [{
                        value: Buffer.from(frame.toBinary())
                    }]
                } as ProducerRecord;
                console.log("producing:", this.topic_worker);
                switch (topic_type_) {
                    case topic_type.worker:
                        if (partitioning.case == "partitionKey")
                            record.messages[0].key = Buffer.from(partitioning.value.toBinary());
                        else
                            throw new Error(`missing ${partitioning.case} value`);
                        break;
                    case topic_type.reply_to:
                        if (partitioning.case == "partitionInteger")
                            record.messages[0].partition = partitioning.value;
                        else
                            throw new Error(`missing ${partitioning.case} value`);
                        break;
                    default:
                        throw new Error(`unhandled: ${topic_type_}`);
                }
                await this.producer.send(record);
                console.log("send.produce")
            } else {
                console.log("producer.send, missing partitioning info");
            }
        } else {
            console.log("producer.send, missing send_to info");
        }
    }

    [Disposable.dispose]() {
    }

    public close() {
        this.producer.disconnect();
    }

    public static create(config_: config) {
        return new publisher(config_);
    }
}

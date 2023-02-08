import {Kafka, Partitioners, ProducerRecord} from "kafkajs";
import {config} from "../config";
import * as crypto from "crypto";
import {AirCoreFrame} from "../../proto/generated/devinternal_pb";
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
        if (!this.connected) {
            await this.producer.connect();
            console.log("send.connect")
            this.connected = true;
        }
        const topic = this.get_topic(topic_type_);
        const record = {
            topic: topic,
            messages: [{
                value: Buffer.from("")
            }]
        } as ProducerRecord;
        console.log("producing:", frame.toJsonString({prettySpaces: 2}));
        switch (topic_type_) {
            case topic_type.worker: {
                if (frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionKey")
                    record.messages[0].key = Buffer.from(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value.toBinary());
                else
                    throw new Error(`missing partitionKey`);
                if(frame.sendTo?.kafkaKey) frame.sendTo.kafkaKey.kafkaTopic = topic;
                break;
            }
            case topic_type.reply_to: {
                if (frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionInteger")
                    record.messages[0].partition = frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x.value | 0; // protobuf serialize drops zero val's
                else throw new Error(`missing partitionKey`);
                if(frame.replyTo?.kafkaKey) frame.replyTo.kafkaKey.kafkaTopic = topic;
                break;
            }
            default:
                throw new Error(`unhandled: ${topic_type_}`);
        }
        record.messages[0].value = Buffer.from(frame.toBinary());
        await this.producer.send(record);
        console.log("send.produce")
    }

    [Disposable.dispose]() {
        this.producer.disconnect();
    }

    public static create(config_: config) {
        return new publisher(config_);
    }
}

import {Kafka, Partitioners, ProducerRecord} from "kafkajs";
import * as crypto from "crypto";
import {AirCoreFrame} from "../../proto/gen/devinternal_pb";
import {AsyncDisposable} from "@esfx/disposable";
import {kafkaLogLevel} from "./constants";
import {config} from "../config";
import {createKafka} from "../common2/createKafka";

export enum topic_type {
    unknown,
    worker,
    reply_to,
}

export class publisher {
    private readonly topic_worker: string;
    private readonly topic_reply_to: string;
    private connected = false;

    private constructor(
        private readonly config_: config,
        private readonly kafka = createKafka(config_.easy_pubsub.get_app_id() + '/' + crypto.randomUUID()),
        private readonly producer = kafka.producer({
            allowAutoTopicCreation: true,
            createPartitioner: Partitioners.DefaultPartitioner,
        })
    ) {
        this.topic_worker = config_.easy_pubsub.get_worker_topic();
        this.topic_reply_to = config_.easy_pubsub.get_reply_to_topic();
    }

    public static create(config_: config) {
        return new publisher(config_);
    }

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
        if (!this.connected) {
            await this.producer.connect();
            //console.log("send.connect")
            this.connected = true;
        }
        const topic = this.get_topic(topic_type_);
        const record = {
            topic: topic,
            messages: [{
                value: Buffer.from("")
            }]
        } as ProducerRecord;
        //console.log("producing:", frame.toJsonString({prettySpaces}));
        switch (topic_type_) {
            case topic_type.worker: {
                if (frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "sequenceNumberPath")
                    record.messages[0].key = Buffer.from(frame.sendTo?.kafkaKey?.kafkaPartitionKey?.x.value.toBinary());
                else
                    throw new Error(`missing frame.sendTo?.kafkaKey?.kafkaPartitionKey?x.case:"sequenceNumberPath"`);
                break;
            }
            case topic_type.reply_to: {
                if (frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionInteger")
                    record.messages[0].partition = frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x.value | 0; // protobuf serialize drops zero val's
                else throw new Error(`missing frame.replyTo?.kafkaKey?.kafkaPartitionKey?.x.case:"partitionInteger"`);
                break;
            }
            default:
                throw new Error(`unhandled: ${topic_type_}`);
        }
        record.messages[0].value = Buffer.from(frame.toBinary());
        await this.producer.send(record);
        //console.log("publisher.send: ", frame.toJsonString({prettySpaces}));
    }

    async [AsyncDisposable.asyncDispose]() {
        await this.producer.disconnect();
    }
}
